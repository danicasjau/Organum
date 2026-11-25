from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError
from app.formats.base import FormatRegistry
from app.models.artifact import Artifact
from app.models.project_db import FileEntry
from app.services.layer_thumbs import generate_layer_thumbs_sync
from app.services.udim_service import resolve_udim_tile_path, resolve_udim_tiles
from app.storage.base import StorageBackend


def compute_params_hash(params: dict[str, Any]) -> str:
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def compute_cache_key(
    sha256: str,
    handler_id: str,
    handler_version: str,
    kind: str,
    params_hash: str,
) -> str:
    raw = f"{sha256}:{handler_id}:{handler_version}:{kind}:{params_hash}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def resolve_sequence_frame_key(entry: FileEntry, frame: int) -> str | None:
    """Resolve storage-relative path for a specific frame in a sequence."""
    if not entry.sequence_pattern:
        return None
    import re

    rel_dir = entry.relative_path.rsplit("/", 1)[0] if "/" in entry.relative_path else ""
    m = re.search(r"#+", entry.sequence_pattern)
    if not m:
        return None
    pad = len(m.group(0))
    prefix = entry.sequence_pattern[: m.start()]
    suffix = entry.sequence_pattern[m.end() :]
    frame_name = f"{prefix}{frame:0{pad}d}{suffix}"
    return f"{rel_dir}/{frame_name}" if rel_dir else frame_name


def resolve_source_path(
    entry: FileEntry,
    storage: StorageBackend,
    params: dict[str, Any] | None = None,
) -> Path:
    if entry.is_sequence and entry.sequence_pattern:
        if params and params.get("udim") is not None:
            udim_path = resolve_udim_tile_path(entry, storage, int(params["udim"]))
            if udim_path is not None and udim_path.is_file():
                return udim_path
        if "<UDIM>" in entry.sequence_pattern:
            tiles = resolve_udim_tiles(entry, storage)
            if tiles:
                return tiles[0].disk_path
        frame_num = entry.frame_start if entry.frame_start is not None else 1
        frame_key = resolve_sequence_frame_key(entry, frame_num)
        if frame_key and storage.exists(frame_key):
            return storage.resolve_safe(frame_key)
        tiles = resolve_udim_tiles(entry, storage)
        if tiles:
            return tiles[0].disk_path
        rel_dir = entry.relative_path.rsplit("/", 1)[0] if "/" in entry.relative_path else ""
        folder = storage.resolve_safe(rel_dir) if rel_dir else storage.root
        candidates = sorted(p for p in folder.iterdir() if p.is_file()) if folder.is_dir() else []
        if candidates:
            return candidates[0]
    return storage.resolve_safe(entry.relative_path)


def _artifact_to_out(art: Artifact) -> dict[str, Any]:
    return {
        "id": art.id,
        "file_id": art.file_id,
        "kind": art.kind,
        "handler_id": art.handler_id,
        "handler_version": art.handler_version,
        "cache_key": art.cache_key,
        "mime_type": art.mime_type,
        "size": art.size,
        "status": art.status,
        "content_url": f"/api/v1/artifacts/{art.id}/content",
    }


async def get_or_create_artifact(
    db: AsyncSession,
    storage: StorageBackend,
    cache_storage: StorageBackend,
    registry: FormatRegistry,
    file_id: UUID,
    kind: str,
    params: dict[str, Any],
) -> Artifact:
    entry = await db.get(FileEntry, file_id)
    if entry is None:
        raise NotFoundError("file", str(file_id))

    disk_path = resolve_source_path(entry, storage, params)
    if not disk_path.is_file():
        raise NotFoundError("file_on_disk", entry.relative_path)

    handler = registry.resolve(disk_path)
    params_hash = compute_params_hash(params)
    cache_key = compute_cache_key(
        entry.sha256,
        handler.handler_id,
        handler.handler_version,
        kind,
        params_hash,
    )

    existing_res = await db.execute(select(Artifact).where(Artifact.cache_key == cache_key))
    existing = existing_res.scalar_one_or_none()
    if (
        existing is not None
        and existing.status == "ready"
        and cache_storage.exists(existing.storage_key)
    ):
        return existing

    cache_prefix = f"{cache_key[:2]}/{cache_key}"
    out_dir = cache_storage.resolve_safe(cache_prefix)
    try:
        if kind in ("layer_thumbs", "udim_tiles"):
            import asyncio

            manifest_path, size = await asyncio.to_thread(
                generate_layer_thumbs_sync,
                entry,
                storage,
                registry,
                disk_path,
                kind,
                params,
                out_dir,
            )
            full_storage_key = f"{cache_prefix}/{manifest_path.name}"
            derived_mime = "application/json"
            derived_size = size
        else:
            derived = await handler.derive(disk_path, kind, params, out_dir)
            full_storage_key = f"{cache_prefix}/{derived.storage_key}"
            derived_mime = derived.mime_type
            derived_size = derived.size
    except NotImplementedError as exc:
        raise AppError("unsupported_artifact", str(exc), status_code=400) from exc

    if existing is None:
        artifact = Artifact(
            file_id=entry.id,
            kind=kind,
            handler_id=handler.handler_id,
            handler_version=handler.handler_version,
            params_hash=params_hash,
            cache_key=cache_key,
            storage_key=full_storage_key,
            mime_type=derived_mime,
            size=derived_size,
            status="ready",
        )
        db.add(artifact)
    else:
        artifact = existing
        artifact.storage_key = full_storage_key
        artifact.mime_type = derived_mime
        artifact.size = derived_size
        artifact.status = "ready"

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        winner_res = await db.execute(select(Artifact).where(Artifact.cache_key == cache_key))
        winner = winner_res.scalar_one_or_none()
        if winner is not None:
            return winner
        raise
    await db.refresh(artifact)
    return artifact
