from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.formats.base import FormatRegistry, InspectionDocument
from app.models.project_db import FileEntry
from app.services.artifact_service import resolve_source_path
from app.services.udim_service import (
    check_uniform_image_dimensions,
    resolve_udim_tiles,
    score_udim_vs_frames,
)
from app.storage.base import StorageBackend


async def inspect_file(
    db: AsyncSession,
    storage: StorageBackend,
    registry: FormatRegistry,
    file_id: UUID,
    *,
    udim_keywords: list[str] | None = None,
) -> InspectionDocument:
    entry = await db.get(FileEntry, file_id)
    if entry is None:
        raise NotFoundError("file", str(file_id))

    disk_path = resolve_source_path(entry, storage)
    if not disk_path.is_file():
        raise NotFoundError("file_on_disk", entry.relative_path)

    handler = registry.resolve(disk_path)
    probe = await handler.probe(disk_path)
    doc = await handler.inspect(disk_path, probe)
    doc.summary.setdefault("sha256", entry.sha256)
    doc.summary.setdefault("size", entry.size)
    doc.summary.setdefault("colorspace_override", entry.colorspace_override)
    doc.summary.setdefault("handler_id", handler.handler_id)

    if entry.is_sequence:
        udim_tiles = await asyncio.to_thread(resolve_udim_tiles, entry, storage)
        rel_dir = entry.relative_path.rsplit("/", 1)[0] if "/" in entry.relative_path else ""
        stem = Path(entry.filename).stem.split(".")[0]
        if udim_tiles:
            same_sz = check_uniform_image_dimensions([t.disk_path for t in udim_tiles])
            scored = score_udim_vs_frames(
                [t.udim for t in udim_tiles],
                rel_dir=rel_dir,
                stem=stem,
                mari_style=any(t.mari_style for t in udim_tiles),
                same_size=same_sz,
                extra_keywords=udim_keywords,
            )
        else:
            scored = score_udim_vs_frames([], rel_dir=rel_dir, stem=stem)

        if entry.sequence_kind in ("udim", "frames"):
            effective_kind = entry.sequence_kind
        else:
            effective_kind = scored.kind

        doc.summary["sequence_kind"] = effective_kind
        doc.summary["sequence_kind_user_override"] = bool(entry.sequence_kind_user_override)
        doc.summary["udim_auto_kind"] = scored.kind
        doc.summary["udim_score"] = scored.score
        doc.summary["udim_reasons"] = scored.reasons
        doc.summary["can_override_udim"] = bool(scored.can_be_udim and len(udim_tiles) >= 1)

        if effective_kind == "udim":
            doc.timeline = None
            doc.capabilities["time_based"] = False
            doc.capabilities["udim"] = True
            doc.capabilities["annotations_2d"] = True
            doc.capabilities["color_pipeline"] = True
            doc.capabilities["pixel_zoom"] = True
            doc.summary["udim_tile_count"] = len(udim_tiles)
            doc.summary["udim_tiles"] = [
                {
                    "udim": t.udim,
                    "u": t.u,
                    "v": t.v,
                    "filename": t.filename,
                    "width": t.width,
                    "height": t.height,
                    "size": t.size,
                }
                for t in udim_tiles
            ]
        else:
            f_start = entry.frame_start if entry.frame_start is not None else 1
            f_end = entry.frame_end if entry.frame_end is not None else f_start
            fps = float((doc.timeline or {}).get("fps") or 24.0)
            doc.timeline = {
                "start": f_start,
                "end": f_end,
                "fps": fps,
                "is_sequence": True,
                "pattern": entry.sequence_pattern,
            }
            doc.capabilities["time_based"] = True
            doc.capabilities["udim"] = False
            doc.summary["frame_start"] = f_start
            doc.summary["frame_end"] = f_end
            doc.summary["frame_count"] = entry.frame_count or max(1, f_end - f_start + 1)

    return doc
