from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models.annotation import Annotation
from app.models.project_db import FileEntry
from app.models.user import User
from app.schemas.api import AnnotationCreate, AnnotationOut, AnnotationUpdate


async def _authors(db: AsyncSession, anns: list[Annotation]) -> dict[UUID, User]:
    ids = {a.author_id for a in anns if a.author_id is not None}
    if not ids:
        return {}
    res = await db.execute(select(User).where(User.id.in_(ids)))
    return {u.id: u for u in res.scalars().all()}


def _to_out(ann: Annotation, authors: dict[UUID, User] | None = None) -> AnnotationOut:
    author = (authors or {}).get(ann.author_id) if ann.author_id else None
    return AnnotationOut(
        id=ann.id,
        file_id=ann.file_id,
        kind=ann.kind,
        coord_space=ann.coord_space,
        frame_in=ann.frame_in,
        frame_out=ann.frame_out,
        time_base=ann.time_base,
        note_text=ann.note_text,
        vector_json=ann.vector_json,
        plane_json=ann.plane_json,
        camera_json=ann.camera_json,
        author_id=ann.author_id,
        author_username=author.username if author else None,
        author_full_name=author.full_name if author else None,
        visibility=ann.visibility,
        created_at=ann.created_at,
        updated_at=ann.updated_at,
    )


async def list_annotations(
    db: AsyncSession,
    file_id: UUID,
    *,
    allowed_visibilities: tuple[str, ...] = ("internal",),
) -> list[AnnotationOut]:
    file_entry = await db.get(FileEntry, file_id)
    if file_entry is None:
        raise NotFoundError("file", str(file_id))
    res = await db.execute(
        select(Annotation)
        .where(
            Annotation.file_id == file_id,
            Annotation.deleted_at.is_(None),
            Annotation.visibility.in_(allowed_visibilities),
        )
        .order_by(Annotation.frame_in, Annotation.created_at)
    )
    anns = list(res.scalars().all())
    authors = await _authors(db, anns)
    return [_to_out(a, authors) for a in anns]


async def create_annotation(
    db: AsyncSession,
    file_id: UUID,
    author_id: UUID,
    payload: AnnotationCreate,
    *,
    forced_visibility: str | None = None,
) -> AnnotationOut:
    file_entry = await db.get(FileEntry, file_id)
    if file_entry is None:
        raise NotFoundError("file", str(file_id))
    vis = forced_visibility if forced_visibility is not None else payload.visibility
    ann = Annotation(
        file_id=file_id,
        kind=payload.kind,
        coord_space=payload.coord_space,
        frame_in=payload.frame_in,
        frame_out=payload.frame_out,
        time_base=payload.time_base,
        note_text=payload.note_text,
        vector_json=payload.vector_json,
        plane_json=payload.plane_json,
        camera_json=payload.camera_json,
        author_id=author_id,
        visibility=vis,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    return _to_out(ann, await _authors(db, [ann]))


async def update_annotation(
    db: AsyncSession,
    file_id: UUID,
    annotation_id: UUID,
    payload: AnnotationUpdate,
) -> AnnotationOut:
    res = await db.execute(
        select(Annotation).where(Annotation.id == annotation_id, Annotation.file_id == file_id)
    )
    ann = res.scalar_one_or_none()
    if ann is None:
        raise NotFoundError("annotation", str(annotation_id))
    data = payload.model_dump(exclude_unset=True)
    for field_name, value in data.items():
        setattr(ann, field_name, value)
    await db.commit()
    await db.refresh(ann)
    return _to_out(ann, await _authors(db, [ann]))


async def delete_annotation(db: AsyncSession, file_id: UUID, annotation_id: UUID) -> None:
    res = await db.execute(
        select(Annotation).where(Annotation.id == annotation_id, Annotation.file_id == file_id)
    )
    ann = res.scalar_one_or_none()
    if ann is None:
        raise NotFoundError("annotation", str(annotation_id))
    await db.delete(ann)
    await db.commit()
