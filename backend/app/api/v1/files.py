from __future__ import annotations

import mimetypes
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_db, get_cache_storage, get_db, get_format_registry, get_storage
from app.core.errors import AppError, NotFoundError
from app.formats.base import FormatRegistry, InspectionDocument
from app.models.app_db import UiPref
from app.models.project_db import FileEntry
from app.schemas.api import FilePatchRequest, FileSummaryOut
from app.services.artifact_service import get_or_create_artifact, resolve_sequence_frame_key
from app.services.inspect_service import inspect_file
from app.services.streaming import build_ranged_file_response
from app.services.udim_service import resolve_udim_tile_path
from app.storage.base import StorageBackend

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{file_id}/inspect", response_model=InspectionDocument)
async def get_file_inspection(
    file_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> InspectionDocument:
    pref = await app_db.get(UiPref, "udim_keywords")
    kw = (
        [str(x) for x in pref.value_json]
        if pref and isinstance(pref.value_json, list)
        else None
    )
    return await inspect_file(db, storage, registry, file_id, udim_keywords=kw)


@router.patch("/{file_id}", response_model=FileSummaryOut)
async def patch_file(
    file_id: UUID,
    payload: FilePatchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileSummaryOut:
    entry = await db.get(FileEntry, file_id)
    if entry is None:
        raise NotFoundError("file", str(file_id))
    fields = payload.model_fields_set
    if "colorspace_override" in fields:
        entry.colorspace_override = payload.colorspace_override
    if "sequence_kind" in fields and payload.sequence_kind is not None:
        entry.sequence_kind = payload.sequence_kind
    if "sequence_kind_user_override" in fields and payload.sequence_kind_user_override is not None:
        entry.sequence_kind_user_override = payload.sequence_kind_user_override
    await db.commit()
    await db.refresh(entry)
    return FileSummaryOut(
        id=entry.id,
        filename=entry.filename,
        relative_path=entry.relative_path,
        size=entry.size,
        sha256=entry.sha256,
        detected_format=entry.detected_format,
        media_kind=entry.media_kind,
        colorspace_override=entry.colorspace_override,
        is_sequence=entry.is_sequence,
        sequence_pattern=entry.sequence_pattern,
        sequence_kind=entry.sequence_kind,
        sequence_kind_user_override=entry.sequence_kind_user_override,
        frame_start=entry.frame_start,
        frame_end=entry.frame_end,
        frame_count=entry.frame_count,
        is_missing=entry.is_missing,
    )


@router.get("/{file_id}/content")
async def get_file_content(
    file_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
) -> Response:
    entry = await db.get(FileEntry, file_id)
    if entry is None or not storage.exists(entry.relative_path):
        raise NotFoundError("file", str(file_id))
    mime, _ = mimetypes.guess_type(entry.filename)
    return build_ranged_file_response(
        request,
        storage,
        entry.relative_path,
        etag_token=entry.sha256,
        media_type=mime or "application/octet-stream",
        immutable=False,
    )


@router.get("/{file_id}/thumbnail")
async def get_file_thumbnail(
    file_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
    cache_storage: Annotated[StorageBackend, Depends(get_cache_storage)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> Response:
    art = await get_or_create_artifact(
        db, storage, cache_storage, registry, file_id, "thumbnail", {}
    )
    return build_ranged_file_response(
        request,
        cache_storage,
        art.storage_key,
        etag_token=art.cache_key,
        media_type="image/png",
        immutable=True,
    )


@router.get("/{file_id}/sequence/{frame}")
async def get_sequence_frame(
    file_id: UUID,
    frame: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
) -> Response:
    entry = await db.get(FileEntry, file_id)
    if entry is None:
        raise NotFoundError("file", str(file_id))
    if not entry.is_sequence or not entry.sequence_pattern:
        raise AppError("not_sequence", "File is not an image sequence", status_code=400)
    f_start = entry.frame_start if entry.frame_start is not None else 0
    f_end = entry.frame_end if entry.frame_end is not None else f_start
    if frame < f_start or frame > f_end:
        raise NotFoundError("sequence_frame", str(frame))
    frame_key = resolve_sequence_frame_key(entry, frame)
    if not frame_key or not storage.exists(frame_key):
        raise NotFoundError("sequence_frame", str(frame))
    mime, _ = mimetypes.guess_type(frame_key)
    return build_ranged_file_response(
        request,
        storage,
        frame_key,
        etag_token=f"{entry.sha256}-f{frame}",
        media_type=mime or "image/png",
        immutable=False,
    )


@router.get("/{file_id}/udim/{udim}/content")
async def get_udim_tile_content(
    file_id: UUID,
    udim: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
) -> Response:
    entry = await db.get(FileEntry, file_id)
    if entry is None:
        raise NotFoundError("file", str(file_id))
    tile_path = resolve_udim_tile_path(entry, storage, udim)
    if tile_path is None or not tile_path.is_file():
        raise NotFoundError("udim_tile", str(udim))
    rel_key = tile_path.relative_to(storage.root.resolve()).as_posix()
    mime, _ = mimetypes.guess_type(tile_path.name)
    return build_ranged_file_response(
        request,
        storage,
        rel_key,
        etag_token=f"{entry.sha256}-u{udim}",
        media_type=mime or "application/octet-stream",
        immutable=False,
    )
