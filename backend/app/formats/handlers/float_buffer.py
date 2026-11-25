from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

ORGF_MAGIC = b"ORGF"


def write_orgf_float32(rgba: NDArray[np.float32], dest: Path) -> int:
    """Write an RGBA float32 array with an ORGF binary header (16 bytes + raw f32)."""
    if rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError(f"Expected (H, W, 4) float32 array, got {rgba.shape}")
    h, w, _ = rgba.shape
    contig = np.ascontiguousarray(rgba, dtype="<f4")
    dest.parent.mkdir(parents=True, exist_ok=True)
    header = struct.pack("<4sIII", ORGF_MAGIC, w, h, 4)
    with dest.open("wb") as fh:
        fh.write(header)
        fh.write(contig.tobytes())
    return dest.stat().st_size


def float_rgba_to_pil(rgba: NDArray[np.float32], tonemap: bool = True) -> Image.Image:
    """Convert linear/float RGBA array to 8-bit sRGB PIL Image."""
    rgb = rgba[:, :, :3].astype(np.float32, copy=True)
    if tonemap:
        rgb = np.maximum(rgb, 0.0)
        rgb = rgb / (1.0 + rgb)
        rgb = np.power(np.clip(rgb, 0.0, 1.0), 1.0 / 2.2)
    else:
        rgb = np.clip(rgb, 0.0, 1.0)
    alpha = np.clip(rgba[:, :, 3:4], 0.0, 1.0)
    out = np.concatenate([rgb, alpha], axis=2)
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), mode="RGBA")


def save_thumbnail_from_pil(img: Image.Image, dest: Path, max_dim: int = 256) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    copy = img.copy()
    copy.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    copy.save(dest, format="PNG")
    return dest.stat().st_size


def build_tile_pyramid_from_pil(
    img: Image.Image,
    out_dir: Path,
    tile_size: int = 512,
) -> tuple[Path, int]:
    """Generate PNG tile pyramid levels (0 = 1x1 grid up to full res) and manifest.json."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rgba = img.convert("RGBA")
    w, h = rgba.size
    max_side = max(w, h)
    levels = 1
    while (tile_size * (1 << (levels - 1))) < max_side:
        levels += 1

    manifest_levels: list[dict[str, int]] = []
    total_size = 0
    for lvl in range(levels):
        scale = 1 << (levels - 1 - lvl)
        lw = max(1, (w + scale - 1) // scale)
        lh = max(1, (h + scale - 1) // scale)
        resized = rgba if scale == 1 else rgba.resize((lw, lh), Image.Resampling.BILINEAR)
        cols = (lw + tile_size - 1) // tile_size
        rows = (lh + tile_size - 1) // tile_size
        lvl_dir = out_dir / str(lvl)
        lvl_dir.mkdir(parents=True, exist_ok=True)
        for ty in range(rows):
            for tx in range(cols):
                x0 = tx * tile_size
                y0 = ty * tile_size
                x1 = min(lw, x0 + tile_size)
                y1 = min(lh, y0 + tile_size)
                tile = resized.crop((x0, y0, x1, y1))
                tile_path = lvl_dir / f"{tx}_{ty}.png"
                tile.save(tile_path, format="PNG")
                total_size += tile_path.stat().st_size
        manifest_levels.append(
            {"level": lvl, "width": lw, "height": lh, "cols": cols, "rows": rows}
        )

    manifest = {
        "width": w,
        "height": h,
        "tile_size": tile_size,
        "levels": manifest_levels,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    total_size += manifest_path.stat().st_size
    return manifest_path, total_size
