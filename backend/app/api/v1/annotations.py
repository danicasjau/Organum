from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.errors import AppError, NotFoundError
from app.core.security import get_project_auth, require_not_archived
from app.models.annotation import Annotation
from app.schemas.api import AnnotationCreate, AnnotationOut, AnnotationUpdate
from app.services.annotations import (
    create_annotation,
    delete_annotation,
    list_annotations,
    update_annotation,
)
from app.services.permissions import (
    AuthContext,
    assert_can,
    can_access_annotation_visibility,
    can_access_file,
    can_see_client_comments,
)

router = APIRouter(prefix="/files/{file_id}/annotations", tags=["annotations"])


def _allowed_visibilities(auth: AuthContext) -> tuple[str, ...]:
    if auth.role.name == "client":
        return ("client",)
    if can_see_client_comments(auth):
        return ("internal", "client")
    return ("internal",)


@router.get("", response_model=list[AnnotationOut])
async def get_annotations(
    file_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AnnotationOut]:
    await can_access_file(db, auth, file_id)
    return await list_annotations(db, file_id, allowed_visibilities=_allowed_visibilities(auth))


@router.post("", response_model=AnnotationOut, status_code=201)
async def post_annotation(
    file_id: UUID,
    payload: AnnotationCreate,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AnnotationOut:
    await require_not_archived(auth)
    _, task = await can_access_file(db, auth, file_id)
    await assert_can(db, auth, "task.comment", task)
    forced_vis: str | None = None
    if auth.role.name == "client":
        forced_vis = "client"
    elif payload.visibility == "client" and not can_see_client_comments(auth):
        raise AppError(
            "forbidden",
            "Only client, Production, Direction, or admin can create client-visible annotations",
            status_code=403,
        )
    return await create_annotation(db, file_id, auth.user.id, payload, forced_visibility=forced_vis)


@router.patch("/{annotation_id}", response_model=AnnotationOut)
async def patch_annotation(
    file_id: UUID,
    annotation_id: UUID,
    payload: AnnotationUpdate,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AnnotationOut:
    await require_not_archived(auth)
    await can_access_file(db, auth, file_id)
    ann = await db.get(Annotation, annotation_id)
    if (
        ann is None
        or ann.file_id != file_id
        or not can_access_annotation_visibility(auth, ann.visibility)
    ):
        raise NotFoundError("annotation", str(annotation_id))
    if ann.author_id != auth.user.id and not auth.has_any_scope("entity.manage"):
        raise AppError("forbidden", "You can only edit your own annotations", status_code=403)
    return await update_annotation(db, file_id, annotation_id, payload)


@router.delete("/{annotation_id}", status_code=204)
async def remove_annotation(
    file_id: UUID,
    annotation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await require_not_archived(auth)
    await can_access_file(db, auth, file_id)
    ann = await db.get(Annotation, annotation_id)
    if (
        ann is None
        or ann.file_id != file_id
        or not can_access_annotation_visibility(auth, ann.visibility)
    ):
        raise NotFoundError("annotation", str(annotation_id))
    if ann.author_id != auth.user.id and not auth.has_any_scope("entity.manage"):
        raise AppError("forbidden", "You can only delete your own annotations", status_code=403)
    await delete_annotation(db, file_id, annotation_id)
    return Response(status_code=204)


@router.get("/export", response_model=list[AnnotationOut])
async def export_annotations(
    file_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AnnotationOut]:
    await can_access_file(db, auth, file_id)
    return await list_annotations(db, file_id, allowed_visibilities=_allowed_visibilities(auth))
