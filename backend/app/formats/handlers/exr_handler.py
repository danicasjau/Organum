from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import numpy as np
import OpenEXR
from numpy.typing import NDArray

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.float_buffer import (
    build_tile_pyramid_from_pil,
    float_rgba_to_pil,
    save_thumbnail_from_pil,
    write_orgf_float32,
)


def _group_exr_channels(channels: dict[str, Any]) -> list[dict[str, Any]]:
    aovs: list[dict[str, Any]] = []
    for key, ch in channels.items():
        pix = ch.pixels
        ch_count = int(pix.shape[2]) if pix.ndim == 3 else 1
        aovs.append(
            {
                "name": key,
                "channels": ch_count,
                "dtype": str(pix.dtype),
                "width": int(pix.shape[1]),
                "height": int(pix.shape[0]),
            }
        )
    return aovs


def _extract_exr_rgba(path: Path, aov: str | None = None) -> NDArray[np.float32]:
    with OpenEXR.File(str(path)) as exr:
        channels = exr.channels()
        if not channels:
            raise ValueError("EXR contains no channels")
        target = aov if (aov and aov in channels) else next(iter(channels.keys()))
        if not aov and "RGBA" in channels:
            target = "RGBA"
        elif not aov and "RGB" in channels:
            target = "RGB"
        pix = np.asarray(channels[target].pixels, dtype=np.float32)

    if pix.ndim == 2:
        h, w = pix.shape
        out = np.empty((h, w, 4), dtype=np.float32)
        out[:, :, 0] = pix
        out[:, :, 1] = pix
        out[:, :, 2] = pix
        out[:, :, 3] = 1.0
        return out
    h, w, c = pix.shape
    if c == 4:
        return np.ascontiguousarray(pix, dtype=np.float32)
    out = np.ones((h, w, 4), dtype=np.float32)
    copy_c = min(3, c)
    out[:, :, :copy_c] = pix[:, :, :copy_c]
    return out


def _serialize_header(header: dict[str, Any]) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    for k, v in header.items():
        if k == "channels":
            continue
        meta[str(k)] = repr(v) if not isinstance(v, (str, int, float, bool)) else v
    return meta


def _probe_sync(path: Path) -> ProbeResult:
    with OpenEXR.File(str(path)) as exr:
        channels = exr.channels()
        header = exr.header()
        first = next(iter(channels.values())).pixels if channels else None
        h = int(first.shape[0]) if first is not None else None
        w = int(first.shape[1]) if first is not None else None
        aovs = _group_exr_channels(channels)
        meta = _serialize_header(header)
        meta["part_count"] = len(exr.parts)
        meta["aovs"] = aovs
    return ProbeResult(
        format_id="exr",
        media_kind="image2d",
        detected_colorspace="Linear sRGB",
        width=w,
        height=h,
        details=meta,
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    with OpenEXR.File(str(path)) as exr:
        aovs = _group_exr_channels(exr.channels())
        header_meta = _serialize_header(exr.header())
        part_count = len(exr.parts)
    return InspectionDocument(
        kind="image2d",
        summary={
            "name": path.name,
            "format": "exr",
            "width": probe.width,
            "height": probe.height,
            "colorspace": probe.detected_colorspace or "Linear sRGB",
            "parts": part_count,
            "aov_count": len(aovs),
        },
        aovs=aovs,
        metadata=header_meta,
        capabilities={
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
            "aovs": True,
            "float_buffer": True,
        },
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    aov = str(params.get("aov")) if params.get("aov") else None
    rgba = _extract_exr_rgba(path, aov=aov)
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind == "float_rgba":
        dest = out_dir / "buffer.orgf"
        size = write_orgf_float32(rgba, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="application/octet-stream",
            size=size,
        )
    pil = float_rgba_to_pil(rgba, tonemap=True)
    if kind == "thumbnail":
        dest = out_dir / "thumb.png"
        size = save_thumbnail_from_pil(pil, dest)
        return DerivedResult(kind=kind, storage_key=dest.name, mime_type="image/png", size=size)
    if kind == "tiles":
        tile_size = int(params.get("tile_size", 512))
        manifest_path, size = build_tile_pyramid_from_pil(pil, out_dir / "tiles", tile_size)
        return DerivedResult(
            kind=kind,
            storage_key=f"tiles/{manifest_path.name}",
            mime_type="application/json",
            size=size,
        )
    raise NotImplementedError(f"Unsupported EXR derive kind '{kind}'")


class ExrHandler(FormatHandler):
    handler_id = "exr"
    handler_version = "1.0.0"
    media_kind = "image2d"
    extensions = (".exr",)
    magic_signatures = (b"\x76\x2f\x31\x01",)

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
            "aovs": True,
            "float_buffer": True,
        }

