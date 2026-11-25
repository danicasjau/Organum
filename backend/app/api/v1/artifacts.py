from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_cache_storage, get_db, get_format_registry, get_storage
from app.core.errors import NotFoundError
from app.formats.base import FormatRegistry
from app.models.artifact import Artifact
from app.schemas.api import ArtifactOut, ArtifactRequest
from app.services.artifact_service import get_or_create_artifact
from app.services.streaming import build_ranged_file_response
from app.storage.base import StorageBackend

router = APIRouter(tags=["artifacts"])


def _to_out(project_uuid: str, art: Artifact) -> ArtifactOut:
    return ArtifactOut(
        id=art.id,
        file_id=art.file_id,
        kind=art.kind,
        handler_id=art.handler_id,
        handler_version=art.handler_version,
        cache_key=art.cache_key,
        mime_type=art.mime_type,
        size=art.size,
        status=art.status,
        content_url=f"/api/v1/projects/{project_uuid}/artifacts/{art.id}/content",
    )


@router.post("/files/{file_id}/artifacts/{kind}", response_model=ArtifactOut)
async def create_or_get_file_artifact(
    project_uuid: str,
    file_id: UUID,
    kind: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
    cache_storage: Annotated[StorageBackend, Depends(get_cache_storage)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
    body: ArtifactRequest | None = None,
) -> ArtifactOut:
    params = body.params if body is not None else {}
    art = await get_or_create_artifact(db, storage, cache_storage, registry, file_id, kind, params)
    return _to_out(project_uuid, art)


@router.get("/artifacts/{artifact_id}/content")
async def stream_artifact_content(
    artifact_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    cache_storage: Annotated[StorageBackend, Depends(get_cache_storage)],
) -> Response:
    art = await db.get(Artifact, artifact_id)
    if art is None or not cache_storage.exists(art.storage_key):
        raise NotFoundError("artifact", str(artifact_id))
    return build_ranged_file_response(
        request,
        cache_storage,
        art.storage_key,
        etag_token=art.cache_key,
        media_type=art.mime_type,
        immutable=True,
    )


@router.get("/artifacts/{artifact_id}/atlas")
async def stream_artifact_atlas(
    artifact_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    cache_storage: Annotated[StorageBackend, Depends(get_cache_storage)],
) -> Response:
    art = await db.get(Artifact, artifact_id)
    if art is None:
        raise NotFoundError("artifact", str(artifact_id))
    base_prefix = art.storage_key.rsplit("/", 1)[0]
    atlas_key = f"{base_prefix}/atlas.png"
    if not cache_storage.exists(atlas_key):
        raise NotFoundError("artifact_atlas", atlas_key)
    return build_ranged_file_response(
        request,
        cache_storage,
        atlas_key,
        etag_token=f"{art.cache_key}-atlas",
        media_type="image/png",
        immutable=True,
    )


@router.get("/artifacts/{artifact_id}/tiles/{level}/{tile_name}")
async def stream_artifact_tile(
    artifact_id: UUID,
    level: int,
    tile_name: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    cache_storage: Annotated[StorageBackend, Depends(get_cache_storage)],
) -> Response:
    art = await db.get(Artifact, artifact_id)
    if art is None:
        raise NotFoundError("artifact", str(artifact_id))
    base_prefix = art.storage_key.rsplit("/", 1)[0]
    clean_tile = tile_name if tile_name.endswith(".png") else f"{tile_name}.png"
    tile_key = f"{base_prefix}/{level}/{clean_tile}"
    if not cache_storage.exists(tile_key):
        raise NotFoundError("tile", tile_key)
    return build_ranged_file_response(
        request,
        cache_storage,
        tile_key,
        etag_token=f"{art.cache_key}-{level}-{clean_tile}",
        media_type="image/png",
        immutable=True,
    )

