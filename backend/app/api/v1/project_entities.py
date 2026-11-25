from __future__ import annotations

import asyncio
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    get_cache_storage,
    get_db,
    get_format_registry,
    get_project_context,
    get_storage,
)
from app.core.errors import AppError, NotFoundError
from app.core.project_registry import ProjectContext
from app.formats.base import FormatRegistry
from app.models.project_db import (
    Entity,
    EntityData,
    EntityDepartment,
    EntityTag,
    FileEntry,
    Product,
    ProductVersion,
    Tag,
    Task,
)
from app.schemas.api import (
    EntityCreateRequest,
    EntityDataItem,
    EntityDataPutRequest,
    EntityDepartmentAddRequest,
    EntityDepartmentOut,
    EntityOut,
    EntityTagsPutRequest,
    EntityThumbnailPutRequest,
    EntityTreeOut,
    EntityUpdateRequest,
    FileSummaryOut,
    FolderCreateRequest,
    FolderPromoteRequest,
    ProductOut,
    ProductVersionOut,
    ReconcileReportOut,
    TaskCreateRequest,
    TaskOut,
    TaskUpdateRequest,
)
from app.services.artifact_service import get_or_create_artifact
from app.services.entity_service import (
    attach_department_to_entity,
    create_entity_atomic,
    create_plain_folder,
    create_task_for_ed,
    detach_entity_department,
    promote_folder_to_entity,
    rename_task,
    replace_entity_data,
    resolve_entity_thumbnail_file_id,
    set_entity_tags,
    soft_delete_entity,
    soft_delete_task,
    update_entity,
)
from app.services.reconcile_service import _discover_production_tree, reconcile_project
from app.services.streaming import build_ranged_file_response
from app.storage.base import StorageBackend

router = APIRouter(tags=["entities"])


def _file_summary_out(f: FileEntry) -> FileSummaryOut:
    return FileSummaryOut(
        id=f.id,
        filename=f.filename,
        relative_path=f.relative_path,
        size=f.size,
        sha256=f.sha256,
        detected_format=f.detected_format,
        media_kind=f.media_kind,
        colorspace_override=f.colorspace_override,
        is_sequence=f.is_sequence,
        sequence_pattern=f.sequence_pattern,
        sequence_kind=f.sequence_kind,
        sequence_kind_user_override=f.sequence_kind_user_override,
        frame_start=f.frame_start,
        frame_end=f.frame_end,
        frame_count=f.frame_count,
        is_missing=f.is_missing,
    )


def _product_version_out(v: ProductVersion) -> ProductVersionOut:
    return ProductVersionOut(
        id=v.id,
        version_number=v.version_number,
        label=v.label,
        rel_path=v.rel_path,
        comment=v.comment,
        source_json=list(v.source_json or []),
        author_name="artist",
        created_at=v.created_at,
        files=[_file_summary_out(f) for f in sorted(v.files, key=lambda x: x.filename)],
    )


def _product_out(t: Task) -> ProductOut | None:
    if t.product is None:
        return None
    return ProductOut(
        id=t.product.id,
        task_id=t.id,
        name=t.product.name,
        master_version_id=t.product.master_version_id,
        versions=[
            _product_version_out(v)
            for v in sorted(t.product.versions, key=lambda x: x.version_number, reverse=True)
        ],
    )


def _task_out(t: Task) -> TaskOut:
    return TaskOut(
        id=t.id,
        name=t.name,
        folder_name=t.folder_name,
        sort_order=t.sort_order,
        product=_product_out(t),
    )


async def _load_entity_full(db: AsyncSession, entity_id: UUID) -> Entity:
    stmt = (
        select(Entity)
        .where(Entity.id == entity_id, Entity.archived_at.is_(None))
        .options(
            selectinload(Entity.departments).selectinload(EntityDepartment.department),
            selectinload(Entity.departments)
            .selectinload(EntityDepartment.tasks)
            .selectinload(Task.product)
            .selectinload(Product.versions)
            .selectinload(ProductVersion.files),
        )
    )
    ent = (await db.execute(stmt)).scalar_one_or_none()
    if ent is None:
        raise NotFoundError("entity", str(entity_id))
    return ent


async def _entity_to_out(db: AsyncSession, ent: Entity, tags: list[str] | None = None) -> EntityOut:
    if tags is None:
        tag_rows = (
            await db.execute(
                select(Tag.name)
                .join(EntityTag, EntityTag.tag_id == Tag.id)
                .where(EntityTag.entity_id == ent.id)
            )
        ).scalars().all()
        tags = sorted(str(t) for t in tag_rows)

    dept_outs = [
        EntityDepartmentOut(
            id=ed.id,
            department_id=ed.department_id,
            name=ed.department.name if ed.department else "",
            folder_name=ed.department.folder_name if ed.department else "",
            sort_order=ed.sort_order,
            tasks=[_task_out(t) for t in sorted(ed.tasks, key=lambda x: x.sort_order)],
        )
        for ed in sorted(ent.departments, key=lambda x: x.sort_order)
    ]
    resolved_thumb = resolve_entity_thumbnail_file_id(ent)
    return EntityOut(
        id=ent.id,
        name=ent.name,
        folder_name=ent.folder_name,
        rel_path=ent.rel_path,
        entity_type=ent.entity_type,
        description=ent.description,
        thumbnail_file_id=ent.thumbnail_file_id,
        resolved_thumbnail_file_id=resolved_thumb,
        thumbnail_source=ent.thumbnail_source,
        is_missing=ent.is_missing,
        tags=tags,
        departments=dept_outs,
        created_at=ent.created_at,
        updated_at=ent.updated_at,
    )


@router.post("/reconcile", response_model=ReconcileReportOut)
async def trigger_reconcile(
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> ReconcileReportOut:
    rep = await reconcile_project(db, storage.root, registry)
    return ReconcileReportOut(
        entities_scanned=rep.entities_scanned,
        entities_created=rep.entities_created,
        entities_updated=rep.entities_updated,
        entities_missing=rep.entities_missing,
        versions_registered=rep.versions_registered,
        files_scanned=rep.files_scanned,
        plain_folders=rep.plain_folders,
    )


@router.get("/entities", response_model=EntityTreeOut)
async def list_entities(
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(default=""),
    tag: list[str] = Query(default=[]),
    type: str | None = Query(default=None),
    department: str | None = Query(default=None),
    folder: str | None = Query(default=None),
    sort: str = Query(default="name_asc"),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=500),
) -> EntityTreeOut:
    stmt = (
        select(Entity)
        .where(Entity.archived_at.is_(None))
        .options(
            selectinload(Entity.departments).selectinload(EntityDepartment.department),
            selectinload(Entity.departments)
            .selectinload(EntityDepartment.tasks)
            .selectinload(Task.product)
            .selectinload(Product.versions)
            .selectinload(ProductVersion.files),
        )
        .order_by(Entity.name)
    )
    entities = list((await db.execute(stmt)).scalars().all())

    tag_stmt = select(EntityTag.entity_id, Tag.name).join(Tag, EntityTag.tag_id == Tag.id)
    tags_by_entity: dict[str, list[str]] = {}
    all_tags: set[str] = set()
    for eid, tname in (await db.execute(tag_stmt)).all():
        s_tag = str(tname)
        tags_by_entity.setdefault(str(eid), []).append(s_tag)
        all_tags.add(s_tag)

    available_types = sorted({e.entity_type for e in entities if e.entity_type})
    discovery = await asyncio.to_thread(_discover_production_tree, ctx.production_dir)

    q_low = q.strip().lower()
    req_tags = {t.strip().lower() for t in tag if t.strip()}
    filtered: list[Entity] = []
    for ent in entities:
        ent_tags = tags_by_entity.get(str(ent.id), [])
        if folder is not None:
            parent_rel = ent.rel_path.rsplit("/", 1)[0] if "/" in ent.rel_path else ""
            if parent_rel != folder.strip("/"):
                continue
        if type and (ent.entity_type or "").lower() != type.strip().lower():
            continue
        if department:
            dept_low = department.strip().lower()
            if not any(
                (ed.department and ed.department.name.lower() == dept_low) for ed in ent.departments
            ):
                continue
        if req_tags and not req_tags.issubset({t.lower() for t in ent_tags}):
            continue
        if q_low and not (
            q_low in ent.name.lower()
            or q_low in (ent.entity_type or "").lower()
            or any(q_low in t.lower() for t in ent_tags)
        ):
            continue
        filtered.append(ent)

    if sort == "name_desc":
        filtered.sort(key=lambda e: e.name.lower(), reverse=True)
    elif sort == "updated_desc":
        filtered.sort(key=lambda e: e.updated_at, reverse=True)
    elif sort == "type_asc":
        filtered.sort(key=lambda e: ((e.entity_type or "~").lower(), e.name.lower()))
    else:
        filtered.sort(key=lambda e: e.name.lower())

    total = len(filtered)
    offset = int(cursor) if cursor and cursor.isdigit() else 0
    page_items = filtered[offset : offset + limit] if limit is not None else filtered[offset:]
    next_cursor = str(offset + limit) if limit is not None and (offset + limit) < total else None

    out_entities = [
        await _entity_to_out(db, ent, sorted(tags_by_entity.get(str(ent.id), [])))
        for ent in page_items
    ]
    return EntityTreeOut(
        project_uuid=ctx.uuid,
        project_name=ctx.name,
        entities=out_entities,
        plain_folders=discovery.plain_folders,
        available_types=available_types,
        available_tags=sorted(all_tags),
        next_cursor=next_cursor,
        total=total,
    )


@router.post("/entities", response_model=EntityOut, status_code=201)
async def create_entity(
    payload: EntityCreateRequest,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EntityOut:
    ent = await create_entity_atomic(
        db,
        ctx,
        name=payload.name,
        parent_rel_path=payload.parent_rel_path,
        entity_type=payload.entity_type,
        description=payload.description,
        tags=payload.tags,
        department_ids=payload.department_ids,
    )
    loaded = await _load_entity_full(db, ent.id)
    return await _entity_to_out(db, loaded)


@router.patch("/entities/{entity_id}", response_model=EntityOut)
async def patch_entity(
    entity_id: UUID,
    payload: EntityUpdateRequest,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EntityOut:
    fields = payload.model_fields_set
    await update_entity(
        db,
        ctx,
        entity_id,
        name=payload.name,
        parent_rel_path=payload.parent_rel_path,
        entity_type=payload.entity_type,
        description=payload.description,
        update_type="entity_type" in fields,
        update_description="description" in fields,
    )
    loaded = await _load_entity_full(db, entity_id)
    return await _entity_to_out(db, loaded)


@router.delete("/entities/{entity_id}", status_code=204)
async def delete_entity(
    entity_id: UUID,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await soft_delete_entity(db, ctx, entity_id)
    return Response(status_code=204)


@router.post("/folders", status_code=201)
async def create_folder(
    payload: FolderCreateRequest,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
) -> dict[str, str]:
    rel_path = await create_plain_folder(ctx, payload.parent_rel_path, payload.name)
    return {"rel_path": rel_path}


@router.post("/folders/promote", response_model=EntityOut)
async def promote_folder_body(
    payload: FolderPromoteRequest,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> EntityOut:
    ent = await promote_folder_to_entity(db, ctx, registry, payload.rel_path)
    loaded = await _load_entity_full(db, ent.id)
    return await _entity_to_out(db, loaded)


@router.post("/folders/{rel_path:path}/promote", response_model=EntityOut)
async def promote_folder_path(
    rel_path: str,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> EntityOut:
    ent = await promote_folder_to_entity(db, ctx, registry, rel_path)
    loaded = await _load_entity_full(db, ent.id)
    return await _entity_to_out(db, loaded)


@router.put("/entities/{entity_id}/tags", response_model=list[str])
async def put_entity_tags(
    entity_id: UUID,
    payload: EntityTagsPutRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[str]:
    ent = await db.get(Entity, entity_id)
    if ent is None or ent.archived_at is not None:
        raise NotFoundError("entity", str(entity_id))
    tags = await set_entity_tags(db, entity_id, payload.tags)
    await db.commit()
    return tags


@router.get("/entities/{entity_id}/data", response_model=list[EntityDataItem])
async def get_entity_data(
    entity_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[EntityDataItem]:
    ent = await db.get(Entity, entity_id)
    if ent is None or ent.archived_at is not None:
        raise NotFoundError("entity", str(entity_id))
    rows = (
        await db.execute(
            select(EntityData)
            .where(EntityData.entity_id == entity_id)
            .order_by(EntityData.key.asc())
        )
    ).scalars().all()
    return [
        EntityDataItem(
            key=r.key,
            value_type=cast(Literal["str", "int", "float", "bool", "json"], r.value_type),
            value_text=r.value_text,
        )
        for r in rows
    ]


@router.put("/entities/{entity_id}/data", response_model=list[EntityDataItem])
async def put_entity_data(
    entity_id: UUID,
    payload: EntityDataPutRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[EntityDataItem]:
    rows = await replace_entity_data(
        db,
        entity_id,
        [(it.key, it.value_type, it.value_text) for it in payload.items],
    )
    return [
        EntityDataItem(
            key=r.key,
            value_type=cast(Literal["str", "int", "float", "bool", "json"], r.value_type),
            value_text=r.value_text,
        )
        for r in rows
    ]


@router.put("/entities/{entity_id}/thumbnail", response_model=EntityOut)
async def put_entity_thumbnail(
    entity_id: UUID,
    payload: EntityThumbnailPutRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EntityOut:
    ent = await _load_entity_full(db, entity_id)
    if payload.source == "manual":
        if payload.file_id is None:
            raise AppError(
                "invalid_thumbnail", "file_id is required for manual mode", status_code=400
            )
        f = await db.get(FileEntry, payload.file_id)
        if f is None:
            raise NotFoundError("file", str(payload.file_id))
        ent.thumbnail_file_id = f.id
        ent.thumbnail_source = "manual"
    elif payload.source == "none":
        ent.thumbnail_file_id = None
        ent.thumbnail_source = "none"
    else:
        ent.thumbnail_file_id = None
        ent.thumbnail_source = "auto"
    await db.commit()
    loaded = await _load_entity_full(db, entity_id)
    return await _entity_to_out(db, loaded)


@router.get("/entities/{entity_id}/thumbnail")
async def get_entity_thumbnail_image(
    entity_id: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
    cache_storage: Annotated[StorageBackend, Depends(get_cache_storage)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> Response:
    ent = await _load_entity_full(db, entity_id)
    file_id = resolve_entity_thumbnail_file_id(ent)
    if file_id is None:
        raise NotFoundError("entity_thumbnail", str(entity_id))
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


@router.post(
    "/entities/{entity_id}/departments", response_model=EntityDepartmentOut, status_code=201
)
async def add_entity_department(
    entity_id: UUID,
    payload: EntityDepartmentAddRequest,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EntityDepartmentOut:
    ed = await attach_department_to_entity(db, ctx, entity_id, payload.department_id)
    loaded = await _load_entity_full(db, entity_id)
    matched = next(d for d in loaded.departments if d.id == ed.id)
    return EntityDepartmentOut(
        id=matched.id,
        department_id=matched.department_id,
        name=matched.department.name if matched.department else "",
        folder_name=matched.department.folder_name if matched.department else "",
        sort_order=matched.sort_order,
        tasks=[_task_out(t) for t in sorted(matched.tasks, key=lambda x: x.sort_order)],
    )


@router.delete("/entity-departments/{ed_id}", status_code=204)
async def remove_entity_department(
    ed_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await detach_entity_department(db, ed_id)
    return Response(status_code=204)


@router.post("/entity-departments/{ed_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task_endpoint(
    ed_id: UUID,
    payload: TaskCreateRequest,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskOut:
    task = await create_task_for_ed(db, ctx, ed_id, payload.name)
    t_res = await db.execute(
        select(Task)
        .where(Task.id == task.id)
        .options(
            selectinload(Task.product)
            .selectinload(Product.versions)
            .selectinload(ProductVersion.files)
        )
    )
    return _task_out(t_res.scalar_one())


@router.patch("/tasks/{task_id}", response_model=TaskOut)
async def update_task_endpoint(
    task_id: UUID,
    payload: TaskUpdateRequest,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskOut:
    if payload.name is not None:
        await rename_task(db, ctx, task_id, payload.name)
    t_res = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.product)
            .selectinload(Product.versions)
            .selectinload(ProductVersion.files)
        )
    )
    task = t_res.scalar_one_or_none()
    if task is None:
        raise NotFoundError("task", str(task_id))
    if payload.sort_order is not None:
        task.sort_order = payload.sort_order
        await db.commit()
    return _task_out(task)


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task_endpoint(
    task_id: UUID,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await soft_delete_task(db, ctx, task_id)
    return Response(status_code=204)
