from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.api import AnnotationCreate, AnnotationOut, AnnotationUpdate
from app.services.annotations import (
    create_annotation,
    delete_annotation,
    list_annotations,
    update_annotation,
)

router = APIRouter(prefix="/files/{file_id}/annotations", tags=["annotations"])


@router.get("", response_model=list[AnnotationOut])
async def get_annotations(
    file_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AnnotationOut]:
    return await list_annotations(db, file_id)


@router.post("", response_model=AnnotationOut, status_code=201)
async def post_annotation(
    file_id: UUID,
    payload: AnnotationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> AnnotationOut:
    return await create_annotation(db, file_id, user.id, payload)


@router.patch("/{annotation_id}", response_model=AnnotationOut)
async def patch_annotation(
    file_id: UUID,
    annotation_id: UUID,
    payload: AnnotationUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AnnotationOut:
    return await update_annotation(db, file_id, annotation_id, payload)


@router.delete("/{annotation_id}", status_code=204)
async def remove_annotation(
    file_id: UUID,
    annotation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await delete_annotation(db, file_id, annotation_id)
    return Response(status_code=204)


@router.get("/export", response_model=list[AnnotationOut])
async def export_annotations(
    file_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AnnotationOut]:
    return await list_annotations(db, file_id)

