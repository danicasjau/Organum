from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import numpy as np
import tifffile
from numpy.typing import NDArray
from PIL import Image

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.float_buffer import (
    float_rgba_to_pil,
    save_thumbnail_from_pil,
    write_orgf_float32,
)


def _array_to_float_rgba(arr: NDArray[Any]) -> NDArray[np.float32]:
    if np.issubdtype(arr.dtype, np.integer):
        max_val = float(np.iinfo(arr.dtype).max)
        f = arr.astype(np.float32) / (max_val if max_val > 0 else 1.0)
    else:
        f = arr.astype(np.float32)

    if f.ndim == 2:
        h, w = f.shape
        out = np.empty((h, w, 4), dtype=np.float32)
        out[:, :, 0] = f
        out[:, :, 1] = f
        out[:, :, 2] = f
        out[:, :, 3] = 1.0
        return out
    h, w, c = f.shape
    if c == 4:
        return np.ascontiguousarray(f, dtype=np.float32)
    out = np.ones((h, w, 4), dtype=np.float32)
    copy_c = min(3, c)
    out[:, :, :copy_c] = f[:, :, :copy_c]
    return out


def _probe_sync(path: Path) -> ProbeResult:
    with tifffile.TiffFile(path) as tif:
        p0 = tif.pages[0]
        h, w = int(p0.shape[0]), int(p0.shape[1])
        dtype_str = str(p0.dtype)
        is_float = np.issubdtype(p0.dtype, np.floating)
        details = {
            "pages": len(tif.pages),
            "dtype": dtype_str,
            "compression": str(getattr(p0, "compression", "")),
            "photometric": str(getattr(p0, "photometric", "")),
        }
    return ProbeResult(
        format_id="tiff",
        media_kind="image2d",
        detected_colorspace="Linear sRGB" if is_float else "sRGB",
        width=w,
        height=h,
        details=details,
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    layers: list[dict[str, Any]] = []
    tags: dict[str, Any] = {}
    with tifffile.TiffFile(path) as tif:
        for idx, page in enumerate(tif.pages):
            layers.append(
                {
                    "id": f"page_{idx}",
                    "name": f"Page {idx}",
                    "page": idx,
                    "width": int(page.shape[1]),
                    "height": int(page.shape[0]),
                    "dtype": str(page.dtype),
                    "visible": idx == 0,
                }
            )
        p0 = tif.pages[0]
        raw_tags = getattr(p0, "tags", None)
        if raw_tags is not None:
            for tag in raw_tags.values():
                val = tag.value
                tags[str(tag.name)] = (
                    val if isinstance(val, (str, int, float, bool)) else str(val)[:80]
                )

    return InspectionDocument(
        kind="image2d",
        summary={
            "name": path.name,
            "format": "tiff",
            "width": probe.width,
            "height": probe.height,
            "colorspace": probe.detected_colorspace or "sRGB",
            "pages": len(layers),
        },
        layers=layers,
        metadata=tags,
        capabilities={
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
            "layers": len(layers) > 1,
        },
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    page_idx = int(params.get("page", 0))
    with tifffile.TiffFile(path) as tif:
        idx = max(0, min(len(tif.pages) - 1, page_idx))
        arr = tif.pages[idx].asarray()
        is_float = np.issubdtype(arr.dtype, np.floating)

    rgba = _array_to_float_rgba(arr)
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind == "float_rgba":
        dest = out_dir / f"page_{idx}.orgf"
        size = write_orgf_float32(rgba, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="application/octet-stream",
            size=size,
        )
    pil: Image.Image = float_rgba_to_pil(rgba, tonemap=is_float)
    if kind == "thumbnail":
        dest = out_dir / "thumb.png"
        size = save_thumbnail_from_pil(pil, dest)
        return DerivedResult(kind=kind, storage_key=dest.name, mime_type="image/png", size=size)
    if kind == "layer_png":
        dest = out_dir / f"page_{idx}.png"
        pil.save(dest, format="PNG")
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="image/png",
            size=dest.stat().st_size,
        )
    raise NotImplementedError(f"Unsupported TIFF derive kind '{kind}'")


class TiffHandler(FormatHandler):
    handler_id = "tiff"
    handler_version = "1.0.0"
    media_kind = "image2d"
    extensions = (".tif", ".tiff")
    magic_signatures = (b"II*\x00", b"MM\x00*")

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
