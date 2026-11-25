from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from PIL import Image
from psd_tools import PSDImage

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.float_buffer import save_thumbnail_from_pil


def _walk_layers(container: Any, prefix: str = "") -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for idx, layer in enumerate(container):
        lid = f"{prefix}{idx}"
        is_group = bool(layer.is_group())
        entry: dict[str, Any] = {
            "id": lid,
            "name": str(layer.name),
            "is_group": is_group,
            "visible": bool(layer.visible),
            "blend_mode": str(getattr(layer.blend_mode, "name", layer.blend_mode)).lower(),
            "opacity": round(float(layer.opacity) / 255.0, 3),
            "has_mask": bool(getattr(layer, "mask", None) is not None),
        }
        if is_group:
            entry["children"] = _walk_layers(layer, f"{lid}.")
        rows.append(entry)
    return rows


def _find_layer(container: Any, target_id: str, prefix: str = "") -> Any | None:
    for idx, layer in enumerate(container):
        lid = f"{prefix}{idx}"
        if lid == target_id:
            return layer
        if layer.is_group():
            found = _find_layer(layer, target_id, f"{lid}.")
            if found is not None:
                return found
    return None


def _compose_layers(psd: PSDImage, hidden_ids: set[str], isolate_id: str | None) -> Image.Image:
    if isolate_id is not None:
        target = _find_layer(psd, isolate_id)
        canvas = Image.new("RGBA", (psd.width, psd.height), (0, 0, 0, 0))
        if target is not None:
            comp = target.composite()
            if comp is not None:
                canvas.paste(comp.convert("RGBA"), (target.left, target.top), comp.convert("RGBA"))
        return canvas

    if not hidden_ids:
        return psd.composite().convert("RGBA")

    canvas = Image.new("RGBA", (psd.width, psd.height), (0, 0, 0, 0))

    def _draw_container(container: Any, prefix: str = "") -> None:
        for idx, layer in enumerate(container):
            lid = f"{prefix}{idx}"
            if lid in hidden_ids:
                continue
            if layer.is_group():
                _draw_container(layer, f"{lid}.")
            else:
                comp = layer.composite()
                if comp is not None:
                    rgba = comp.convert("RGBA")
                    canvas.alpha_composite(rgba, (max(0, layer.left), max(0, layer.top)))

    _draw_container(psd)
    return canvas


def _probe_sync(path: Path) -> ProbeResult:
    psd = PSDImage.open(path)
    return ProbeResult(
        format_id=path.suffix.lower().lstrip(".") or "psd",
        media_kind="image2d",
        detected_colorspace="sRGB",
        width=int(psd.width),
        height=int(psd.height),
        details={
            "color_mode": str(getattr(psd.color_mode, "name", psd.color_mode)),
            "depth": int(psd.depth),
            "layer_count": len(list(psd.descendants())),
        },
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    psd = PSDImage.open(path)
    layers = _walk_layers(psd)
    return InspectionDocument(
        kind="image2d",
        summary={
            "name": path.name,
            "format": probe.format_id,
            "width": psd.width,
            "height": psd.height,
            "colorspace": "sRGB",
            "layer_count": len(layers),
        },
        layers=layers,
        metadata={
            "color_mode": str(getattr(psd.color_mode, "name", psd.color_mode)),
            "depth": int(psd.depth),
            "channels": int(psd.channels),
        },
        capabilities={
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
            "layers": True,
        },
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    psd = PSDImage.open(path)
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind == "thumbnail":
        dest = out_dir / "thumb.png"
        size = save_thumbnail_from_pil(psd.composite().convert("RGBA"), dest)
        return DerivedResult(kind=kind, storage_key=dest.name, mime_type="image/png", size=size)
    if kind == "layer_png":
        isolate_id = str(params["isolate"]) if params.get("isolate") else None
        hidden_ids = {str(x) for x in params.get("hidden_ids", [])}
        img = _compose_layers(psd, hidden_ids=hidden_ids, isolate_id=isolate_id)
        dest = out_dir / "composite.png"
        img.save(dest, format="PNG")
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="image/png",
            size=dest.stat().st_size,
        )
    raise NotImplementedError(f"Unsupported PSD derive kind '{kind}'")


class PsdHandler(FormatHandler):
    handler_id = "psd"
    handler_version = "1.0.0"
    media_kind = "image2d"
    extensions = (".psd", ".psb")
    magic_signatures = (b"8BPS",)

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
            "layers": True,
        }

