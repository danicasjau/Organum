from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import numpy as np
from PIL import ExifTags, Image

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.float_buffer import (
    build_tile_pyramid_from_pil,
    save_thumbnail_from_pil,
    write_orgf_float32,
)


def _probe_sync(path: Path) -> ProbeResult:
    ext = path.suffix.lower().lstrip(".")
    with Image.open(path) as img:
        w, h = img.size
        frames = int(getattr(img, "n_frames", 1))
        details: dict[str, Any] = {
            "mode": img.mode,
            "format": img.format,
            "frames": frames,
            "frame_count": frames,
            "animated": frames > 1,
            "has_icc": "icc_profile" in img.info,
        }
    return ProbeResult(
        format_id=ext or "image",
        media_kind="image2d",
        detected_colorspace="sRGB",
        width=w,
        height=h,
        details=details,
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    meta: dict[str, Any] = dict(probe.details)
    with Image.open(path) as img:
        exif = img.getexif()
        for tag_id, val in exif.items():
            tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
            meta[f"exif.{tag_name}"] = val if isinstance(val, (str, int, float)) else str(val)[:80]

    frames = int(probe.details.get("frames", 1))
    return InspectionDocument(
        kind="image2d",
        summary={
            "name": path.name,
            "format": probe.format_id,
            "width": probe.width,
            "height": probe.height,
            "frame_count": frames,
            "colorspace": "sRGB",
        },
        metadata=meta,
        capabilities={
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
            "tiled": True,
        },
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    page_idx = max(0, int(params.get("page", 0)))
    with Image.open(path) as img:
        n_frames = int(getattr(img, "n_frames", 1))
        if n_frames > 1 and page_idx < n_frames:
            img.seek(page_idx)
        rgba_pil = img.convert("RGBA")

    if kind == "thumbnail":
        dest = out_dir / "thumb.png"
        size = save_thumbnail_from_pil(rgba_pil, dest)
        return DerivedResult(kind=kind, storage_key=dest.name, mime_type="image/png", size=size)
    if kind == "float_rgba":
        arr = np.asarray(rgba_pil, dtype=np.float32) / 255.0
        dest = out_dir / f"image_f{page_idx}.orgf"
        size = write_orgf_float32(arr, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="application/octet-stream",
            size=size,
        )
    if kind == "tiles":
        tile_size = int(params.get("tile_size", 512))
        manifest_path, size = build_tile_pyramid_from_pil(rgba_pil, out_dir / "tiles", tile_size)
        return DerivedResult(
            kind=kind,
            storage_key=f"tiles/{manifest_path.name}",
            mime_type="application/json",
            size=size,
        )
    raise NotImplementedError(f"Unsupported image derive kind '{kind}'")


class StandardImageHandler(FormatHandler):
    handler_id = "image_std"
    handler_version = "1.0.0"
    media_kind = "image2d"
    extensions = (".png", ".jpg", ".jpeg", ".webp", ".gif")

    async def probe(self, path: Path) -> ProbeResult:
        return await asyncio.to_thread(_probe_sync, path)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return await asyncio.to_thread(_inspect_sync, path, probe)

    async def derive(
        self, path: Path, kind: str, params: dict[str, Any], out_dir: Path
    ) -> DerivedResult:
        return await asyncio.to_thread(_derive_sync, path, kind, params, out_dir)

    def capabilities(self) -> dict[str, bool]:
        return {
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
        }
