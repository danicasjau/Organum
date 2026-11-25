from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import OpenEXR
import OpenImageIO
import tifffile
from numpy.typing import NDArray
from PIL import Image, ImageDraw
from psd_tools import PSDImage

from app.formats.base import FormatRegistry
from app.formats.handlers.exr_handler import _extract_exr_rgba, _group_exr_channels
from app.formats.handlers.float_buffer import float_rgba_to_pil
from app.formats.handlers.psd_handler import _walk_layers
from app.formats.handlers.tiff_handler import _array_to_float_rgba
from app.models.project_db import FileEntry
from app.services.udim_service import resolve_udim_tile_path, resolve_udim_tiles
from app.storage.base import StorageBackend

THUMB_SIZE = 128
ATLAS_COLS = 8
DEFAULT_PAGE_SIZE = 64


def _make_square_thumb(img: Image.Image, size: int = THUMB_SIZE) -> Image.Image:
    rgba = img.convert("RGBA")
    copy = rgba.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (15, 23, 42, 0))
    ox = (size - copy.width) // 2
    oy = (size - copy.height) // 2
    canvas.paste(copy, (ox, oy), copy)
    return canvas


def _percentile_normalize_rgba(
    rgba: NDArray[np.float32],
    *,
    force_check: bool = False,
) -> tuple[Image.Image, bool]:
    """Normalize float/depth/normal buffers via 2..98th percentiles when out of [0,1]."""
    rgb = rgba[:, :, :3].astype(np.float32, copy=True)
    finite = np.isfinite(rgb)
    if not np.any(finite):
        return Image.new("RGBA", (rgba.shape[1], rgba.shape[0]), (30, 41, 59, 255)), False

    valid_vals = rgb[finite]
    vmin = float(np.min(valid_vals))
    vmax = float(np.max(valid_vals))

    needs_norm = (
        vmin < -0.001
        or vmax > 1.001
        or (
            force_check
            and (vmax - vmin) > 1e-5
            and vmax <= 1.0
            and vmin >= 0.0
            and (vmin > 0.05 or vmax < 0.85)
        )
    )
    if not needs_norm:
        pil = float_rgba_to_pil(rgba, tonemap=False)
        return pil, False

    p2, p98 = np.percentile(valid_vals, [2.0, 98.0])
    span = float(p98 - p2)
    if span <= 1e-6:
        span = max(vmax - vmin, 1e-6)
        low = vmin
    else:
        low = float(p2)

    normed = np.where(finite, (rgb - low) / span, 0.0)
    normed = np.clip(normed, 0.0, 1.0)
    alpha = np.where(np.isfinite(rgba[:, :, 3:4]), np.clip(rgba[:, :, 3:4], 0.0, 1.0), 1.0)
    out = np.concatenate([normed, alpha], axis=2)
    img = Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), mode="RGBA")
    return img, True


def _load_image_for_thumb(path: Path) -> tuple[Image.Image, bool]:
    ext = path.suffix.lower()
    if ext == ".exr":
        rgba = _extract_exr_rgba(path, aov=None)
        return _percentile_normalize_rgba(rgba, force_check=False)
    if ext in (".tif", ".tiff"):
        with tifffile.TiffFile(path) as tif:
            arr = tif.pages[0].asarray()
            is_float = np.issubdtype(arr.dtype, np.floating)
        rgba = _array_to_float_rgba(arr)
        return _percentile_normalize_rgba(rgba, force_check=is_float)
    if ext in (".hdr", ".pic", ".dpx", ".tx", ".tex", ".tga"):
        inp = OpenImageIO.ImageInput.open(str(path))
        if inp is not None:
            try:
                pixels = inp.read_image(format=OpenImageIO.FLOAT)
            finally:
                inp.close()
            if pixels is not None:
                arr_f = np.asarray(pixels, dtype=np.float32)
                if arr_f.ndim == 2:
                    h, w = arr_f.shape
                    out = np.ones((h, w, 4), dtype=np.float32)
                    out[:, :, :3] = arr_f[:, :, None]
                else:
                    h, w, c = arr_f.shape
                    out = np.ones((h, w, 4), dtype=np.float32)
                    copy_c = min(3, c)
                    out[:, :, :copy_c] = arr_f[:, :, :copy_c]
                    if c >= 4:
                        out[:, :, 3] = arr_f[:, :, 3]
                return _percentile_normalize_rgba(out, force_check=(ext in (".hdr", ".pic")))
    with Image.open(path) as im:
        return im.convert("RGBA"), False


def _render_folder_badge_thumb(size: int = THUMB_SIZE) -> Image.Image:
    img = Image.new("RGBA", (size, size), (23, 32, 51, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 34, 60, 48], fill=(100, 116, 139, 255))
    draw.rectangle([20, 44, 108, 98], fill=(59, 74, 99, 255), outline=(148, 163, 184, 255), width=2)
    return img


def _flatten_psd_layers(
    container: Any,
    prefix: str = "",
    parent_id: str | None = None,
) -> list[tuple[str, Any, dict[str, Any]]]:
    entries: list[tuple[str, Any, dict[str, Any]]] = []
    for idx, layer in enumerate(container):
        lid = f"{prefix}{idx}"
        is_group = bool(layer.is_group())
        meta = {
            "id": lid,
            "name": str(layer.name),
            "label": str(layer.name),
            "kind": "group" if is_group else "layer",
            "parent_id": parent_id,
            "is_group": is_group,
            "visible": bool(layer.visible),
            "blend_mode": str(getattr(layer.blend_mode, "name", layer.blend_mode)).lower(),
            "opacity": round(float(layer.opacity) / 255.0, 3),
            "auto_normalized": False,
        }
        entries.append((lid, layer, meta))
        if is_group:
            entries.extend(_flatten_psd_layers(layer, f"{lid}.", lid))
    return entries


def _write_atlas_and_manifest(
    thumbs: list[Image.Image],
    items_meta: list[dict[str, Any]],
    out_dir: Path,
    *,
    mode: str,
    page: int,
    page_size: int,
    total_count: int,
) -> tuple[Path, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    count = len(thumbs)
    cols = min(ATLAS_COLS, max(1, count))
    rows = max(1, math.ceil(count / ATLAS_COLS))
    atlas = Image.new("RGBA", (cols * THUMB_SIZE, rows * THUMB_SIZE), (0, 0, 0, 0))

    for i, thumb in enumerate(thumbs):
        col = i % ATLAS_COLS
        row = i // ATLAS_COLS
        px = col * THUMB_SIZE
        py = row * THUMB_SIZE
        atlas.paste(thumb, (px, py))
        items_meta[i]["x"] = px
        items_meta[i]["y"] = py
        items_meta[i]["width"] = THUMB_SIZE
        items_meta[i]["height"] = THUMB_SIZE

    atlas_path = out_dir / "atlas.png"
    atlas.save(atlas_path, format="PNG")

    manifest = {
        "mode": mode,
        "tile_size": THUMB_SIZE,
        "atlas_width": atlas.width,
        "atlas_height": atlas.height,
        "atlas_path": "atlas.png",
        "page": page,
        "page_size": page_size,
        "total": total_count,
        "items": items_meta,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    total_size = atlas_path.stat().st_size + manifest_path.stat().st_size
    return manifest_path, total_size


def _generate_udim_atlas(
    entry: FileEntry,
    storage: StorageBackend,
    out_dir: Path,
    *,
    page: int,
    page_size: int,
) -> tuple[Path, int]:
    tiles = resolve_udim_tiles(entry, storage)
    # Index 0: UV Mosaic overview composite tile
    max_u = max((t.u for t in tiles), default=0) + 1
    max_v = max((t.v for t in tiles), default=0) + 1
    grid_n = max(2, max_u, max_v)
    mosaic = Image.new("RGBA", (THUMB_SIZE, THUMB_SIZE), (15, 23, 42, 255))
    cell = max(8, THUMB_SIZE // grid_n)

    tile_entries: list[tuple[Image.Image, dict[str, Any]]] = []
    for t in tiles:
        img, auto_norm = _load_image_for_thumb(t.disk_path)
        thumb = _make_square_thumb(img, THUMB_SIZE)
        mini = thumb.resize((cell, cell), Image.Resampling.BILINEAR)
        mx = t.u * cell
        my = THUMB_SIZE - (t.v + 1) * cell
        if 0 <= mx < THUMB_SIZE and 0 <= my < THUMB_SIZE:
            mosaic.paste(mini, (mx, max(0, my)))
        tile_entries.append(
            (
                thumb,
                {
                    "id": str(t.udim),
                    "udim": t.udim,
                    "u": t.u,
                    "v": t.v,
                    "label": str(t.udim),
                    "kind": "udim",
                    "width_px": t.width,
                    "height_px": t.height,
                    "auto_normalized": auto_norm,
                },
            )
        )

    all_pairs: list[tuple[Image.Image, dict[str, Any]]] = [
        (
            mosaic,
            {
                "id": "mosaic",
                "udim": None,
                "label": f"Mosaic ({len(tiles)})",
                "kind": "mosaic",
                "auto_normalized": False,
            },
        ),
        *tile_entries,
    ]
    total = len(all_pairs)
    start = page * page_size
    page_pairs = all_pairs[start : start + page_size]
    thumbs = [p[0] for p in page_pairs]
    metas = [p[1] for p in page_pairs]
    return _write_atlas_and_manifest(
        thumbs, metas, out_dir, mode="udim", page=page, page_size=page_size, total_count=total
    )


def _generate_exr_atlas(
    disk_path: Path,
    out_dir: Path,
    *,
    page: int,
    page_size: int,
) -> tuple[Path, int]:
    with OpenEXR.File(str(disk_path)) as exr:
        aovs = _group_exr_channels(exr.channels())

    total = len(aovs)
    start = page * page_size
    slice_aovs = aovs[start : start + page_size]
    thumbs: list[Image.Image] = []
    metas: list[dict[str, Any]] = []
    for aov in slice_aovs:
        name = str(aov["name"])
        rgba = _extract_exr_rgba(disk_path, aov=name)
        is_non_color = name not in ("RGBA", "RGB")
        pil, auto_norm = _percentile_normalize_rgba(rgba, force_check=is_non_color)
        thumbs.append(_make_square_thumb(pil, THUMB_SIZE))
        metas.append(
            {
                "id": name,
                "label": name,
                "kind": "aov",
                "channels": aov.get("channels"),
                "dtype": aov.get("dtype"),
                "auto_normalized": auto_norm,
            }
        )
    return _write_atlas_and_manifest(
        thumbs, metas, out_dir, mode="exr_aovs", page=page, page_size=page_size, total_count=total
    )


def _generate_psd_atlas(
    disk_path: Path,
    out_dir: Path,
    *,
    page: int,
    page_size: int,
) -> tuple[Path, int]:
    psd = PSDImage.open(disk_path)
    flat = _flatten_psd_layers(psd)
    total = len(flat)
    start = page * page_size
    page_slice = flat[start : start + page_size]
    thumbs: list[Image.Image] = []
    metas: list[dict[str, Any]] = []

    for _, layer, meta in page_slice:
        if meta["is_group"]:
            comp = layer.composite()
            thumb = (
                _make_square_thumb(comp, THUMB_SIZE)
                if comp is not None
                else _render_folder_badge_thumb()
            )
        else:
            comp = layer.composite()
            thumb = (
                _make_square_thumb(comp, THUMB_SIZE)
                if comp is not None
                else Image.new("RGBA", (THUMB_SIZE, THUMB_SIZE), (30, 41, 59, 255))
            )
        thumbs.append(thumb)
        metas.append(meta)

    # Include tree structure summary cleanly in manifest items via parent_id
    _ = _walk_layers(psd)
    return _write_atlas_and_manifest(
        thumbs, metas, out_dir, mode="psd_layers", page=page, page_size=page_size, total_count=total
    )


def _generate_tiff_atlas(
    disk_path: Path,
    out_dir: Path,
    *,
    page: int,
    page_size: int,
) -> tuple[Path, int]:
    with tifffile.TiffFile(disk_path) as tif:
        total = len(tif.pages)
        start = page * page_size
        end = min(total, start + page_size)
        thumbs: list[Image.Image] = []
        metas: list[dict[str, Any]] = []
        for idx in range(start, end):
            pg = tif.pages[idx]
            arr = pg.asarray()
            is_float = bool(np.issubdtype(arr.dtype, np.floating))
            rgba = _array_to_float_rgba(arr)
            pil, auto_norm = _percentile_normalize_rgba(rgba, force_check=is_float)
            thumbs.append(_make_square_thumb(pil, THUMB_SIZE))
            metas.append(
                {
                    "id": f"page_{idx}",
                    "page": idx,
                    "label": f"Page {idx}",
                    "kind": "tiff_page",
                    "width_px": int(pg.shape[1]),
                    "height_px": int(pg.shape[0]),
                    "dtype": str(pg.dtype),
                    "auto_normalized": auto_norm,
                }
            )
    return _write_atlas_and_manifest(
        thumbs, metas, out_dir, mode="tiff_pages", page=page, page_size=page_size, total_count=total
    )


def generate_layer_thumbs_sync(
    entry: FileEntry,
    storage: StorageBackend,
    registry: FormatRegistry,
    disk_path: Path,
    kind: str,
    params: dict[str, Any],
    out_dir: Path,
) -> tuple[Path, int]:
    """Build a 128px square thumbnail sprite atlas + manifest.json for layers/AOVs/pages/UDIMs."""
    page = max(0, int(params.get("page", 0)))
    page_size = max(1, min(128, int(params.get("page_size", DEFAULT_PAGE_SIZE))))
    mode = str(params.get("mode", "")).lower()

    if kind == "udim_tiles" or mode == "udim":
        return _generate_udim_atlas(entry, storage, out_dir, page=page, page_size=page_size)

    target_path = disk_path
    if params.get("udim") is not None:
        resolved = resolve_udim_tile_path(entry, storage, int(params["udim"]))
        if resolved is not None:
            target_path = resolved

    fmt = entry.detected_format.lower()
    handler = registry.resolve(target_path)
    if fmt == "exr" or handler.handler_id == "exr":
        return _generate_exr_atlas(target_path, out_dir, page=page, page_size=page_size)
    if fmt in ("psd", "psb") or handler.handler_id == "psd":
        return _generate_psd_atlas(target_path, out_dir, page=page, page_size=page_size)
    if fmt in ("tif", "tiff") or handler.handler_id == "tiff":
        return _generate_tiff_atlas(target_path, out_dir, page=page, page_size=page_size)

    # Single-image fallback
    img, auto_norm = _load_image_for_thumb(target_path)
    thumb = _make_square_thumb(img, THUMB_SIZE)
    return _write_atlas_and_manifest(
        [thumb],
        [{"id": "default", "label": entry.filename, "kind": "image", "auto_normalized": auto_norm}],
        out_dir,
        mode="single",
        page=0,
        page_size=page_size,
        total_count=1,
    )
