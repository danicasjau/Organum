from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import numpy as np
import OpenImageIO
from numpy.typing import NDArray

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.float_buffer import (
    build_tile_pyramid_from_pil,
    float_rgba_to_pil,
    save_thumbnail_from_pil,
    write_orgf_float32,
)

_HDR_EXTS = {"hdr", "pic", "exr"}


def _serialize_oiio_value(val: Any) -> str | int | float | bool:
    if isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, (list, tuple)):
        return ", ".join(str(x) for x in val[:16])
    return str(val)[:120]


def _detect_colorspace(ext: str, spec: Any) -> str:
    attr = spec.getattribute("oiio:ColorSpace")
    if isinstance(attr, str) and attr.strip():
        low = attr.lower()
        if "linear" in low:
            return "Linear sRGB"
        if "rec709" in low or "rec.709" in low:
            return "Rec.709"
        if "acescg" in low:
            return "ACEScg"
        if "srgb" in low:
            return "sRGB"
        return attr.strip()
    if ext in _HDR_EXTS:
        return "Linear sRGB"
    basetype = spec.format.basetype
    if basetype in (OpenImageIO.FLOAT, OpenImageIO.HALF, OpenImageIO.DOUBLE):
        return "Linear sRGB"
    if ext == "dpx":
        transfer = spec.getattribute("dpx:Transfer")
        if isinstance(transfer, str) and "linear" in transfer.lower():
            return "Linear sRGB"
        return "Rec.709"
    return "sRGB"


def _read_mips(inp: Any) -> list[dict[str, int]]:
    mips: list[dict[str, int]] = []
    mip = 0
    while True:
        if mip > 0 and not inp.seek_subimage(0, mip):
            break
        spec = inp.spec()
        mips.append({"level": mip, "width": int(spec.width), "height": int(spec.height)})
        mip += 1
        if mip > 32:
            break
    inp.seek_subimage(0, 0)
    return mips


def _normalize_float_rgba(arr: NDArray[np.float32]) -> NDArray[np.float32]:
    if arr.ndim == 2:
        h, w = arr.shape
        out = np.ones((h, w, 4), dtype=np.float32)
        out[:, :, 0] = arr
        out[:, :, 1] = arr
        out[:, :, 2] = arr
        return out
    h, w, c = arr.shape
    if c == 4:
        return np.ascontiguousarray(arr, dtype=np.float32)
    out = np.ones((h, w, 4), dtype=np.float32)
    if c == 1:
        out[:, :, 0] = arr[:, :, 0]
        out[:, :, 1] = arr[:, :, 0]
        out[:, :, 2] = arr[:, :, 0]
    else:
        copy_c = min(3, c)
        out[:, :, :copy_c] = arr[:, :, :copy_c]
    return out


def _probe_sync(path: Path) -> ProbeResult:
    ext = path.suffix.lower().lstrip(".")
    inp = OpenImageIO.ImageInput.open(str(path))
    if inp is None:
        err = str(OpenImageIO.geterror() or "Unreadable image stream")
        return ProbeResult(
            format_id=ext,
            media_kind="image2d",
            detected_colorspace="sRGB",
            details={
                "partial_support": True,
                "notice": f"Could not decode {ext.upper()} variant via OpenImageIO: {err}",
            },
        )
    try:
        spec = inp.spec()
        mips = _read_mips(inp)
        cs = _detect_colorspace(ext, spec)
        details: dict[str, Any] = {
            "channels": int(spec.nchannels),
            "channel_names": [str(n) for n in spec.channelnames],
            "pixel_format": str(spec.format),
            "tile_width": int(spec.tile_width),
            "tile_height": int(spec.tile_height),
            "mip_levels": len(mips),
            "mips": mips,
        }
        return ProbeResult(
            format_id=ext,
            media_kind="image2d",
            detected_colorspace=cs,
            width=int(spec.width),
            height=int(spec.height),
            details=details,
        )
    finally:
        inp.close()


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    ext = path.suffix.lower().lstrip(".")
    if probe.details.get("partial_support"):
        return InspectionDocument(
            kind="image2d",
            summary={
                "name": path.name,
                "format": ext,
                "notice": probe.details.get("notice"),
            },
            metadata=dict(probe.details),
            capabilities={"supported": False},
        )

    meta: dict[str, Any] = dict(probe.details)
    inp = OpenImageIO.ImageInput.open(str(path))
    if inp is not None:
        try:
            spec = inp.spec()
            for attrib in spec.extra_attribs:
                meta[str(attrib.name)] = _serialize_oiio_value(attrib.value)
        finally:
            inp.close()

    return InspectionDocument(
        kind="image2d",
        summary={
            "name": path.name,
            "format": ext,
            "width": probe.width,
            "height": probe.height,
            "channels": probe.details.get("channels"),
            "pixel_format": probe.details.get("pixel_format"),
            "mip_levels": probe.details.get("mip_levels", 1),
            "colorspace": probe.detected_colorspace or "sRGB",
        },
        metadata=meta,
        capabilities={
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
            "float_buffer": True,
            "tiled": True,
        },
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    ext = path.suffix.lower().lstrip(".")
    mip = max(0, int(params.get("mip", 0)))
    inp = OpenImageIO.ImageInput.open(str(path))
    if inp is None:
        err = OpenImageIO.geterror()
        raise ValueError(f"Could not decode {ext.upper()} via OpenImageIO: {err}")
    try:
        if mip > 0 and not inp.seek_subimage(0, mip):
            inp.seek_subimage(0, 0)
            mip = 0
        raw = inp.read_image(0, mip, "float")
        if raw is None:
            raw = inp.read_image("float")
        if raw is None:
            raise ValueError(f"OpenImageIO returned empty pixels for {path.name}")
        arr = np.asarray(raw, dtype=np.float32)
        spec = inp.spec()
        is_hdr = ext in _HDR_EXTS or spec.format.basetype in (
            OpenImageIO.FLOAT,
            OpenImageIO.HALF,
            OpenImageIO.DOUBLE,
        )
    finally:
        inp.close()

    rgba = _normalize_float_rgba(arr)
    out_dir.mkdir(parents=True, exist_ok=True)

    if kind == "float_rgba":
        dest = out_dir / f"mip_{mip}.orgf"
        size = write_orgf_float32(rgba, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="application/octet-stream",
            size=size,
        )

    pil = float_rgba_to_pil(rgba, tonemap=is_hdr)
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

    raise NotImplementedError(f"Unsupported OIIO image derive kind '{kind}'")


class OiioImageHandler(FormatHandler):
    handler_id = "oiio_image"
    handler_version = "1.0.0"
    media_kind = "image2d"
    extensions = (".dpx", ".hdr", ".pic", ".tx", ".tex", ".tga")

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
            "float_buffer": True,
            "tiled": True,
        }
