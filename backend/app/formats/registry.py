from __future__ import annotations

import asyncio
import csv
import json
import wave
from pathlib import Path
from typing import Any

import yaml
from PIL import Image

from app.formats.base import FormatHandler, FormatRegistry, InspectionDocument, ProbeResult
from app.formats.handlers.audio_handler import AudioHandler
from app.formats.handlers.data_handler import DataHandler
from app.formats.handlers.exr_handler import ExrHandler
from app.formats.handlers.gltf_handler import GltfHandler
from app.formats.handlers.obj_handler import ObjHandler
from app.formats.handlers.oiio_image_handler import OiioImageHandler
from app.formats.handlers.pdf_handler import PdfHandler
from app.formats.handlers.psd_handler import PsdHandler
from app.formats.handlers.standard_image_handler import StandardImageHandler
from app.formats.handlers.tiff_handler import TiffHandler
from app.formats.handlers.timeline_handler import TimelineHandler
from app.formats.handlers.usd_handler import UsdHandler
from app.formats.handlers.video_handler import VideoHandler


class UnsupportedHandler(FormatHandler):
    handler_id = "unsupported"
    handler_version = "1.0.0"
    media_kind = "unsupported"
    extensions = ()

    async def probe(self, path: Path) -> ProbeResult:
        return ProbeResult(format_id="unsupported", media_kind="unsupported")

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        stat = await asyncio.to_thread(path.stat)
        return InspectionDocument(
            kind="unsupported",
            summary={
                "name": path.name,
                "size": stat.st_size,
                "notice": "Unsupported format — preview unavailable",
            },
            capabilities={"supported": False},
        )


class BaselineImageHandler(FormatHandler):
    handler_id = "image_baseline"
    handler_version = "1.0.0"
    media_kind = "image2d"
    extensions = (
        ".png",
        ".jpg",
        ".jpeg",
        ".tif",
        ".tiff",
        ".tga",
        ".webp",
        ".gif",
        ".exr",
        ".psd",
        ".psb",
        ".hdr",
        ".pic",
        ".dpx",
        ".tx",
        ".tex",
    )

    async def probe(self, path: Path) -> ProbeResult:
        ext = path.suffix.lower().lstrip(".")
        width: int | None = None
        height: int | None = None
        details: dict[str, Any] = {}
        colorspace = "Linear sRGB" if ext in ("exr", "hdr", "pic") else "sRGB"
        try:
            with Image.open(path) as img:
                width, height = img.size
                details = {"mode": img.mode, "format": img.format}
        except Exception:
            details = {"note": "Deep handler inspection pending"}
        return ProbeResult(
            format_id=ext or "image",
            media_kind="image2d",
            detected_colorspace=colorspace,
            width=width,
            height=height,
            details=details,
        )

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return InspectionDocument(
            kind="image2d",
            summary={
                "name": path.name,
                "format": probe.format_id,
                "width": probe.width,
                "height": probe.height,
                "colorspace": probe.detected_colorspace,
            },
            metadata=probe.details,
            capabilities=self.capabilities(),
        )

    def capabilities(self) -> dict[str, bool]:
        return {"color_pipeline": True, "pixel_zoom": True, "annotations_2d": True}


class BaselineVideoHandler(FormatHandler):
    handler_id = "video_baseline"
    handler_version = "1.0.0"
    media_kind = "video"
    extensions = (".mp4", ".mov", ".mkv", ".avi")

    async def probe(self, path: Path) -> ProbeResult:
        ext = path.suffix.lower().lstrip(".")
        return ProbeResult(
            format_id=ext,
            media_kind="video",
            detected_colorspace="Rec.709",
            fps=24.0,
        )

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return InspectionDocument(
            kind="video",
            summary={"name": path.name, "format": probe.format_id, "fps": probe.fps},
            capabilities={"time_based": True, "annotations_2d": True},
        )


class BaselineAudioHandler(FormatHandler):
    handler_id = "audio_baseline"
    handler_version = "1.0.0"
    media_kind = "audio"
    extensions = (".wav", ".aiff", ".aif", ".mp3", ".aac", ".m4a", ".flac")

    async def probe(self, path: Path) -> ProbeResult:
        ext = path.suffix.lower().lstrip(".")
        details: dict[str, Any] = {}
        duration: float | None = None
        if ext == "wav":
            try:
                with wave.open(str(path), "rb") as wf:
                    frames = wf.getnframes()
                    rate = wf.getframerate()
                    channels = wf.getnchannels()
                    width = wf.getsampwidth() * 8
                    duration = frames / rate if rate else None
                    details = {
                        "channels": channels,
                        "sample_rate": rate,
                        "bit_depth": width,
                        "frames": frames,
                    }
            except Exception:
                pass
        return ProbeResult(
            format_id=ext,
            media_kind="audio",
            duration_seconds=duration,
            details=details,
        )

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return InspectionDocument(
            kind="audio",
            summary={
                "name": path.name,
                "format": probe.format_id,
                "duration_seconds": probe.duration_seconds,
            },
            metadata=probe.details,
            capabilities={"time_based": True, "annotations_audio": True},
        )


class BaselineScene3DHandler(FormatHandler):
    handler_id = "scene3d_baseline"
    handler_version = "1.0.0"
    media_kind = "scene3d"
    extensions = (".gltf", ".glb", ".obj", ".usd", ".usda", ".usdc", ".usdz")

    async def probe(self, path: Path) -> ProbeResult:
        ext = path.suffix.lower().lstrip(".")
        return ProbeResult(format_id=ext, media_kind="scene3d")

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return InspectionDocument(
            kind="scene3d",
            summary={"name": path.name, "format": probe.format_id},
            capabilities={"scene_3d": True, "freeze_2d": True, "annotations_3d": True},
        )


class BaselineDocumentHandler(FormatHandler):
    handler_id = "document_baseline"
    handler_version = "1.0.0"
    media_kind = "document"
    extensions = (".pdf",)

    async def probe(self, path: Path) -> ProbeResult:
        return ProbeResult(format_id="pdf", media_kind="document")

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return InspectionDocument(
            kind="document",
            summary={"name": path.name, "format": "pdf"},
            capabilities={"document": True},
        )


class BaselineTimelineHandler(FormatHandler):
    handler_id = "timeline_baseline"
    handler_version = "1.0.0"
    media_kind = "timeline"
    extensions = (".edl", ".xml")

    async def probe(self, path: Path) -> ProbeResult:
        ext = path.suffix.lower().lstrip(".")
        return ProbeResult(format_id=ext, media_kind="timeline", fps=24.0)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return InspectionDocument(
            kind="timeline",
            summary={"name": path.name, "format": probe.format_id},
            capabilities={"time_based": True},
        )


class BaselineDataHandler(FormatHandler):
    handler_id = "data_baseline"
    handler_version = "1.0.0"
    media_kind = "data"
    extensions = (".json", ".yaml", ".yml", ".csv")

    async def probe(self, path: Path) -> ProbeResult:
        ext = path.suffix.lower().lstrip(".")
        details: dict[str, Any] = {}
        try:
            text = await asyncio.to_thread(path.read_text, encoding="utf-8", errors="replace")
            if ext == "json":
                parsed = json.loads(text)
                details["root_type"] = type(parsed).__name__
            elif ext in ("yaml", "yml"):
                parsed = yaml.safe_load(text)
                details["root_type"] = type(parsed).__name__
            elif ext == "csv":
                rows = list(csv.reader(text.splitlines()))
                details["row_count"] = max(0, len(rows) - 1)
                details["column_count"] = len(rows[0]) if rows else 0
        except Exception:
            pass
        return ProbeResult(format_id=ext, media_kind="data", details=details)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return InspectionDocument(
            kind="data",
            summary={"name": path.name, "format": probe.format_id},
            metadata=probe.details,
            capabilities={"data_table": probe.format_id == "csv"},
        )


def build_default_registry() -> FormatRegistry:
    registry = FormatRegistry()
    registry.register(ExrHandler())
    registry.register(PsdHandler())
    registry.register(TiffHandler())
    registry.register(StandardImageHandler())
    registry.register(GltfHandler())
    registry.register(ObjHandler())
    registry.register(UsdHandler())
    registry.register(VideoHandler())
    registry.register(AudioHandler())
    registry.register(TimelineHandler())
    registry.register(OiioImageHandler())
    registry.register(PdfHandler())
    registry.register(DataHandler())
    registry.register(BaselineImageHandler())
    registry.register(BaselineVideoHandler())
    registry.register(BaselineAudioHandler())
    registry.register(BaselineScene3DHandler())
    registry.register(BaselineDocumentHandler())
    registry.register(BaselineTimelineHandler())
    registry.register(BaselineDataHandler())
    registry.set_fallback(UnsupportedHandler())
    return registry
