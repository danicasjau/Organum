from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast

import av
import numpy as np
from PIL import Image

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult


def _safe_fps(stream: Any) -> float:
    rate = getattr(stream, "average_rate", None) or getattr(stream, "guessed_rate", None)
    if rate:
        val = float(rate)
        if val > 0:
            return round(val, 3)
    return 24.0


def _probe_sync(path: Path) -> ProbeResult:
    ext = path.suffix.lower().lstrip(".")
    with av.open(str(path)) as container:
        v_streams = list(container.streams.video)
        a_streams = list(container.streams.audio)
        v0: av.VideoStream | None = v_streams[0] if v_streams else None

        fps = _safe_fps(v0) if v0 is not None else 24.0
        width = int(v0.width) if v0 is not None and v0.width else None
        height = int(v0.height) if v0 is not None and v0.height else None
        duration_s: float | None = None
        if container.duration is not None and container.duration > 0:
            duration_s = float(container.duration) / float(av.time_base)
        elif v0 is not None and v0.duration and v0.time_base:
            duration_s = float(v0.duration * v0.time_base)

        frame_count = int(v0.frames) if v0 is not None and v0.frames else 0
        if frame_count <= 0 and duration_s is not None:
            frame_count = max(1, round(duration_s * fps))
        if frame_count <= 0 and v0 is not None:
            frame_count = max(1, sum(1 for _ in container.demux(v0)))

        pix_fmt = str(getattr(v0.codec_context, "pix_fmt", "") or "") if v0 is not None else ""
        color_trc = str(getattr(v0.codec_context, "color_trc", "") or "") if v0 is not None else ""
        if "2020" in color_trc:
            colorspace = "Rec.2020"
        elif "rgb" in pix_fmt:
            colorspace = "sRGB"
        else:
            colorspace = "Rec.709"

        streams_info: list[dict[str, Any]] = []
        for s in container.streams:
            cc = s.codec_context
            if isinstance(s, av.VideoStream):
                streams_info.append(
                    {
                        "index": s.index,
                        "type": "video",
                        "codec": str(getattr(cc, "name", "")),
                        "width": s.width,
                        "height": s.height,
                        "fps": _safe_fps(s),
                        "pix_fmt": str(getattr(cc, "pix_fmt", "")),
                    }
                )
            elif isinstance(s, av.AudioStream):
                streams_info.append(
                    {
                        "index": s.index,
                        "type": "audio",
                        "codec": str(getattr(cc, "name", "")),
                        "sample_rate": getattr(s, "rate", 48000),
                        "channels": getattr(s, "channels", 2),
                    }
                )
            else:
                streams_info.append(
                    {
                        "index": s.index,
                        "type": str(s.type),
                        "codec": str(getattr(cc, "name", "")),
                    }
                )

        return ProbeResult(
            format_id=ext,
            media_kind="video",
            detected_colorspace=colorspace,
            width=width,
            height=height,
            fps=fps,
            duration_seconds=duration_s,
            details={
                "frame_count": frame_count,
                "has_audio": len(a_streams) > 0,
                "codec": str(getattr(v0.codec_context, "name", "")) if v0 is not None else "",
                "pix_fmt": pix_fmt,
                "streams": streams_info,
                "container_metadata": dict(container.metadata or {}),
            },
        )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    fps = float(probe.fps or 24.0)
    frame_count = int(probe.details.get("frame_count", 1) or 1)
    has_audio = bool(probe.details.get("has_audio", False))
    streams = list(probe.details.get("streams", []))
    duration_s = float(probe.duration_seconds or (frame_count / max(1.0, fps)))
    return InspectionDocument(
        kind="video",
        summary={
            "name": path.name,
            "format": probe.format_id,
            "width": probe.width,
            "height": probe.height,
            "fps": fps,
            "frame_count": frame_count,
            "duration_seconds": round(duration_s, 3),
            "colorspace": probe.detected_colorspace,
            "codec": probe.details.get("codec", ""),
            "has_audio": has_audio,
        },
        streams=streams,
        timeline={
            "start": 0,
            "end": max(0, frame_count - 1),
            "fps": fps,
            "duration": duration_s,
        },
        metadata={
            "width": probe.width,
            "height": probe.height,
            "fps": fps,
            "frame_count": frame_count,
            "duration_seconds": round(duration_s, 3),
            "has_audio": has_audio,
            "pix_fmt": probe.details.get("pix_fmt", ""),
            **(probe.details.get("container_metadata") or {}),
        },
        capabilities={
            "time_based": True,
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
            "has_audio": has_audio,
        },
    )


def _encode_proxy(path: Path, out_dir: Path) -> tuple[Path, str]:
    use_openh264 = "libopenh264" in av.codecs_available
    if use_openh264:
        dest = out_dir / "proxy.mp4"
        mime = "video/mp4"
        v_codec = "libopenh264"
        a_codec = "aac"
        v_opts: dict[str, str] = {"g": "1"}
    else:
        dest = out_dir / "proxy.webm"
        mime = "video/webm"
        v_codec = "libvpx-vp9"
        a_codec = "libopus"
        v_opts = {"g": "1", "deadline": "realtime", "cpu-used": "6"}

    with av.open(str(path)) as in_c, av.open(str(dest), mode="w") as out_c:
        in_v_list = list(in_c.streams.video)
        if not in_v_list:
            raise ValueError("Video file contains no video stream")
        in_v = in_v_list[0]
        in_a_list = list(in_c.streams.audio)
        in_a = in_a_list[0] if in_a_list else None

        fps = max(1, round(_safe_fps(in_v)))
        out_v = cast(av.VideoStream, out_c.add_stream(v_codec, rate=fps))
        out_v.width = in_v.width - (in_v.width % 2)
        out_v.height = in_v.height - (in_v.height % 2)
        out_v.pix_fmt = "yuv420p"
        out_v.options = cast(Any, v_opts)

        out_a: av.AudioStream | None = None
        resampler: av.AudioResampler | None = None
        if in_a is not None and a_codec in av.codecs_available:
            try:
                out_a = cast(av.AudioStream, out_c.add_stream(a_codec, rate=48000))
                resampler = av.AudioResampler(format="fltp", layout="stereo", rate=48000)
            except Exception:
                out_a = None
                resampler = None

        demux_targets: list[Any] = [in_v]
        if in_a is not None:
            demux_targets.append(in_a)

        for packet in in_c.demux(demux_targets):
            for frame in packet.decode():
                if isinstance(frame, av.VideoFrame):
                    vf = frame.reformat(
                        width=out_v.width, height=out_v.height, format="yuv420p"
                    )
                    vf.pict_type = 0
                    for out_pkt in out_v.encode(vf):
                        out_c.mux(out_pkt)
                elif (
                    isinstance(frame, av.AudioFrame)
                    and out_a is not None
                    and resampler is not None
                ):
                    for rf in resampler.resample(frame):
                        for out_pkt in out_a.encode(rf):
                            out_c.mux(out_pkt)

        for out_pkt in out_v.encode():
            out_c.mux(out_pkt)
        if out_a is not None and resampler is not None:
            for rf in resampler.resample(None):
                for out_pkt in out_a.encode(rf):
                    out_c.mux(out_pkt)
            for out_pkt in out_a.encode():
                out_c.mux(out_pkt)

    return dest, mime


def _extract_frame_png(path: Path, frame_idx: int, dest: Path) -> Path:
    with av.open(str(path)) as container:
        in_v_list = list(container.streams.video)
        if not in_v_list:
            raise ValueError("Video file contains no video stream")
        in_v = in_v_list[0]
        target = max(0, frame_idx)
        last_img: Image.Image | None = None
        v_idx = 0
        for frame in container.decode(in_v):
            if isinstance(frame, av.VideoFrame):
                last_img = Image.fromarray(frame.to_ndarray(format="rgb24"))
                if v_idx >= target:
                    break
                v_idx += 1
        if last_img is None:
            raise ValueError("Unable to decode any video frame")
        last_img.convert("RGBA").save(dest, format="PNG")
    return dest


def _extract_video_peaks(path: Path, buckets: int, dest: Path) -> Path:
    buckets = max(16, min(4000, buckets))
    with av.open(str(path)) as container:
        in_a_list = list(container.streams.audio)
        if not in_a_list:
            payload = {
                "sampleRate": 0,
                "channels": 0,
                "duration": 0.0,
                "buckets": 0,
                "peaks": [],
            }
            dest.write_text(json.dumps(payload), encoding="utf-8")
            return dest
        in_a = in_a_list[0]

        resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
        chunks: list[np.ndarray[Any, np.dtype[np.float32]]] = []
        for frame in container.decode(in_a):
            if not isinstance(frame, av.AudioFrame):
                continue
            for rf in resampler.resample(frame):
                arr = rf.to_ndarray().astype(np.float32).reshape(-1)
                if arr.size:
                    chunks.append(arr)

        mono = np.zeros((16,), dtype=np.float32) if not chunks else np.concatenate(chunks)

        total = len(mono)
        actual_buckets = min(buckets, max(1, total))
        edges = np.linspace(0, total, actual_buckets + 1, dtype=np.int64)
        peaks: list[list[float]] = []
        for i in range(actual_buckets):
            sl = mono[edges[i] : edges[i + 1]]
            if sl.size == 0:
                peaks.append([0.0, 0.0])
            else:
                peaks.append([round(float(sl.min()), 4), round(float(sl.max()), 4)])

        payload = {
            "sampleRate": 16000,
            "channels": int(getattr(in_a, "channels", 1) or 1),
            "duration": round(total / 16000.0, 4),
            "buckets": actual_buckets,
            "peaks": peaks,
        }
        dest.write_text(json.dumps(payload), encoding="utf-8")
        return dest


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind in ("proxy_video", "proxy_mp4"):
        dest, mime = _encode_proxy(path, out_dir)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type=mime,
            size=dest.stat().st_size,
        )
    if kind == "frame_png":
        frame_idx = int(params.get("frame", 0))
        dest = out_dir / f"frame_{frame_idx}.png"
        _extract_frame_png(path, frame_idx, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="image/png",
            size=dest.stat().st_size,
        )
    if kind == "waveform_peaks":
        buckets = int(params.get("buckets", 400))
        dest = out_dir / f"peaks_{buckets}.json"
        _extract_video_peaks(path, buckets, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="application/json",
            size=dest.stat().st_size,
        )
    if kind == "thumbnail":
        dest = out_dir / "thumb.png"
        _extract_frame_png(path, 0, dest)
        with Image.open(dest) as img:
            img.thumbnail((256, 256))
            img.save(dest, format="PNG")
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="image/png",
            size=dest.stat().st_size,
        )
    raise NotImplementedError(f"VideoHandler cannot derive '{kind}'")


class VideoHandler(FormatHandler):
    handler_id = "video_av"
    handler_version = "1.0.0"
    media_kind = "video"
    extensions = (".mp4", ".mov", ".mkv", ".avi")

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
            "time_based": True,
            "color_pipeline": True,
            "pixel_zoom": True,
            "annotations_2d": True,
        }
