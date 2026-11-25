from __future__ import annotations

import asyncio
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import opentimelineio as otio

from app.formats.base import FormatHandler, InspectionDocument, ProbeResult

_EDL_EVENT_RE = re.compile(
    r"^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\S+)?\s+"
    r"(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+"
    r"(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})"
)


def _tc_to_frames(tc: str, fps: float = 24.0) -> int:
    parts = [int(p) for p in tc.replace(";", ":").split(":")]
    if len(parts) != 4:
        return 0
    hh, mm, ss, ff = parts
    return round(((hh * 3600) + (mm * 60) + ss) * fps) + ff


def _parse_edl_to_otio(path: Path, fps: float = 24.0) -> otio.schema.Timeline:
    text = path.read_text(encoding="utf-8", errors="replace")
    tl = otio.schema.Timeline(name=path.stem)
    tracks_map: dict[str, otio.schema.Track] = {}
    last_clip: otio.schema.Clip | None = None

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("TITLE:"):
            tl.name = line.split(":", 1)[1].strip() or path.stem
            continue
        m = _EDL_EVENT_RE.match(line)
        if m:
            _evt, reel, track_code, _cut, src_in, src_out, rec_in, rec_out = m.groups()
            track_kind = (
                otio.schema.TrackKind.Audio
                if track_code.upper().startswith("A")
                else otio.schema.TrackKind.Video
            )
            if track_code not in tracks_map:
                tr = otio.schema.Track(name=track_code, kind=track_kind)
                tracks_map[track_code] = tr
                tl.tracks.append(tr)

            s_in = _tc_to_frames(src_in, fps)
            s_out = _tc_to_frames(src_out, fps)
            r_in = _tc_to_frames(rec_in, fps)
            r_out = _tc_to_frames(rec_out, fps)
            dur = max(1, r_out - r_in or s_out - s_in)

            clip = otio.schema.Clip(
                name=reel,
                source_range=otio.opentime.TimeRange(
                    start_time=otio.opentime.RationalTime(s_in, fps),
                    duration=otio.opentime.RationalTime(dur, fps),
                ),
            )
            tracks_map[track_code].append(clip)
            last_clip = clip
            continue

        if last_clip is not None and "FROM CLIP NAME:" in line.upper():
            clip_name = line.split(":", 1)[1].strip()
            if clip_name:
                last_clip.name = clip_name
                last_clip.media_reference = otio.schema.ExternalReference(target_url=clip_name)

    if not tl.tracks:
        tl.tracks.append(otio.schema.Track(name="V", kind=otio.schema.TrackKind.Video))
    return tl


def _parse_xml_to_otio(path: Path, fps: float = 24.0) -> otio.schema.Timeline:
    tl = otio.schema.Timeline(name=path.stem)
    track = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
    tl.tracks.append(track)
    try:
        tree = ET.parse(path)
        root = tree.getroot()
        for idx, elem in enumerate(root.iter()):
            tag = elem.tag.split("}")[-1].lower()
            if tag in ("clipitem", "asset-clip", "clip"):
                name = (
                    elem.get("name") or (elem.findtext("name") or "").strip() or f"Clip_{idx + 1}"
                )
                dur_txt = elem.get("duration") or elem.findtext("duration") or "24"
                dur_frames = 24
                if dur_txt.isdigit():
                    dur_frames = max(1, int(dur_txt))
                clip = otio.schema.Clip(
                    name=name,
                    source_range=otio.opentime.TimeRange(
                        start_time=otio.opentime.RationalTime(0, fps),
                        duration=otio.opentime.RationalTime(dur_frames, fps),
                    ),
                )
                track.append(clip)
    except ET.ParseError:
        pass
    return tl


def _parse_otio(path: Path) -> tuple[float, int, list[dict[str, Any]], list[dict[str, Any]]]:
    ext = path.suffix.lower()
    tl: otio.schema.Timeline | None = None
    try:
        loaded = otio.adapters.read_from_file(str(path))
        if isinstance(loaded, otio.schema.Timeline):
            tl = loaded
    except Exception:
        tl = None

    if tl is None:
        tl = _parse_xml_to_otio(path) if ext == ".xml" else _parse_edl_to_otio(path)

    fps = 24.0
    tracks_out: list[dict[str, Any]] = []
    flat_clips: list[dict[str, Any]] = []
    max_end = 1

    for t_idx, track in enumerate(tl.tracks):
        clips_out: list[dict[str, Any]] = []
        cursor = 0
        for item in track:
            sr = item.source_range
            dur_val = round(float(sr.duration.value)) if sr else 24
            rate_val = float(sr.duration.rate) if sr and sr.duration.rate else 24.0
            fps = rate_val
            start_in_track = cursor
            cursor += max(1, dur_val)
            max_end = max(max_end, cursor)

            if isinstance(item, otio.schema.Clip):
                src_start = round(float(sr.start_time.value)) if sr else 0
                target_url = ""
                ref = item.media_reference
                if isinstance(ref, otio.schema.ExternalReference) and ref.target_url:
                    target_url = str(ref.target_url)
                clip_doc: dict[str, Any] = {
                    "name": item.name or f"Clip {len(flat_clips) + 1}",
                    "track": track.name or f"Track {t_idx + 1}",
                    "kind": str(track.kind),
                    "start_frame": start_in_track,
                    "duration_frames": max(1, dur_val),
                    "end_frame": start_in_track + max(1, dur_val) - 1,
                    "source_start_frame": src_start,
                    "media_target": target_url,
                }
                clips_out.append(clip_doc)
                flat_clips.append(clip_doc)

        tracks_out.append(
            {
                "name": track.name or f"Track {t_idx + 1}",
                "kind": str(track.kind),
                "clips": clips_out,
            }
        )

    return fps, max_end, tracks_out, flat_clips


def _probe_sync(path: Path) -> ProbeResult:
    ext = path.suffix.lower().lstrip(".")
    fps, total_frames, tracks, clips = _parse_otio(path)
    return ProbeResult(
        format_id=ext,
        media_kind="timeline",
        fps=fps,
        duration_seconds=round(total_frames / max(1.0, fps), 3),
        details={
            "tracks": tracks,
            "clips": clips,
            "total_frames": total_frames,
        },
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    fps = float(probe.fps or 24.0)
    total_frames = int(probe.details.get("total_frames", 1) or 1)
    tracks = list(probe.details.get("tracks", []))
    clips = list(probe.details.get("clips", []))
    duration_s = float(probe.duration_seconds or (total_frames / max(1.0, fps)))

    return InspectionDocument(
        kind="timeline",
        summary={
            "name": path.name,
            "format": probe.format_id,
            "fps": fps,
            "tracks": len(tracks),
            "clips": len(clips),
            "duration_seconds": round(duration_s, 3),
        },
        timeline={
            "start": 0,
            "end": max(0, total_frames - 1),
            "fps": fps,
            "duration": duration_s,
        },
        metadata={
            "fps": fps,
            "total_frames": total_frames,
            "tracks": tracks,
            "clips": clips,
        },
        capabilities={"time_based": True, "timeline_view": True},
    )


class TimelineHandler(FormatHandler):
    handler_id = "timeline_otio"
    handler_version = "1.0.0"
    media_kind = "timeline"
    extensions = (".edl", ".xml")

    async def probe(self, path: Path) -> ProbeResult:
        return await asyncio.to_thread(_probe_sync, path)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return await asyncio.to_thread(_inspect_sync, path, probe)

    def capabilities(self) -> dict[str, bool]:
        return {"time_based": True, "timeline_view": True}
