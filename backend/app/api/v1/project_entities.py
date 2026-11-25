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
from app.core.security import get_project_auth, require
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
from app.models.user import TaskAssignment, TaskShare, User
from app.schemas.api import (
    ClientEntityDepartmentOut,
    ClientEntityOut,
    ClientEntityTreeOut,
    ClientFileSummaryOut,
    ClientProductOut,
    ClientProductVersionOut,
    ClientTaskOut,
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
    TaskAssignmentOut,
    TaskCreateRequest,
    TaskOut,
)
from app.services.artifact_service import get_or_create_artifact
from app.services.entity_service import (
    attach_department_to_entity,
    create_entity_atomic,
    create_plain_folder,
    create_task_for_ed,
    detach_entity_department,
    promote_folder_to_entity,
    replace_entity_data,
    resolve_entity_thumbnail_file_id,
    set_entity_tags,
    soft_delete_entity,
    soft_delete_task,
    update_entity,
)
from app.services.permissions import (
    AuthContext,
    can_access_file,
    client_shared_version_ids,
    visible_task_ids,
)
from app.services.reconcile_service import _discover_production_tree, reconcile_project
from app.services.streaming import build_ranged_file_response
from app.storage.base import StorageBackend

router = APIRouter(tags=["entities"])


def _client_file_summary_out(f: FileEntry) -> ClientFileSummaryOut:
    return ClientFileSummaryOut(
        id=f.id,
        filename=f.filename,
        relative_path=f.relative_path,
        size=f.size,
        sha256=f.sha256,
        detected_format=f.detected_format,
        media_kind=f.media_kind,
        is_sequence=f.is_sequence,
        sequence_pattern=f.sequence_pattern,
        sequence_kind=f.sequence_kind,
        frame_start=f.frame_start,
        frame_end=f.frame_end,
        frame_count=f.frame_count,
    )


def _client_product_version_out(v: ProductVersion) -> ClientProductVersionOut:
    return ClientProductVersionOut(
        id=v.id,
        version_number=v.version_number,
        label=v.label,
        comment=v.comment,
        created_at=v.created_at,
        files=[_client_file_summary_out(f) for f in sorted(v.files, key=lambda x: x.filename)],
    )


def _client_product_out(t: Task, shared_version_ids: set[UUID]) -> ClientProductOut | None:
    if t.product is None:
        return None
    shared_vers = [
        _client_product_version_out(v)
        for v in sorted(t.product.versions, key=lambda x: x.version_number, reverse=True)
        if v.id in shared_version_ids
    ]
    if not shared_vers:
        return None
    master_id = (
        t.product.master_version_id if t.product.master_version_id in shared_version_ids else None
    )
    return ClientProductOut(
        id=t.product.id,
        task_id=t.id,
        name=t.product.name,
        master_version_id=master_id,
        versions=shared_vers,
    )


def _client_resolve_thumb(ent: Entity, shared_version_ids: set[UUID]) -> UUID | None:
    for ed in sorted(ent.departments, key=lambda d: d.sort_order):
        for t in sorted(ed.tasks, key=lambda item: item.sort_order):
            if t.product is None:
                continue
            for v in sorted(t.product.versions, key=lambda x: x.version_number, reverse=True):
                if v.id in shared_version_ids and v.files:
                    return v.files[0].id
    return None


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


def _product_version_out(
    v: ProductVersion,
    *,
    author_name: str | None = None,
    user_names: dict[UUID, str] | None = None,
) -> ProductVersionOut:
    resolved_author = author_name
    if resolved_author is None and v.created_by_user_id and user_names:
        resolved_author = user_names.get(v.created_by_user_id)
    return ProductVersionOut(
        id=v.id,
        version_number=v.version_number,
        label=v.label,
        rel_path=v.rel_path,
        comment=v.comment,
        source_json=list(v.source_json or []),
        author_name=resolved_author or "admin",
        created_at=v.created_at,
        files=[_file_summary_out(f) for f in sorted(v.files, key=lambda x: x.filename)],
    )


def _product_out(t: Task, *, user_names: dict[UUID, str] | None = None) -> ProductOut | None:
    if t.product is None:
        return None
    return ProductOut(
        id=t.product.id,
        task_id=t.id,
        name=t.product.name,
        master_version_id=t.product.master_version_id,
        versions=[
            _product_version_out(v, user_names=user_names)
            for v in sorted(t.product.versions, key=lambda x: x.version_number, reverse=True)
        ],
    )


def _task_out(
    t: Task,
    *,
    acted_as: str | None = None,
    assignments_by_task: dict[UUID, list[TaskAssignmentOut]] | None = None,
    my_caps_by_task: dict[UUID, list[str]] | None = None,
    shares_by_task: dict[UUID, list[UUID]] | None = None,
    user_names: dict[UUID, str] | None = None,
) -> TaskOut:
    return TaskOut(
        id=t.id,
        task_code=t.task_code,
        task_name=t.task_name,
        name=t.name,
        folder_name=t.folder_name,
        sort_order=t.sort_order,
        status=t.status,
        priority=t.priority,
        ideal_finish_date=t.ideal_finish_date,
        bid_hours=t.bid_hours,
        logged_hours=t.logged_hours,
        acted_as=acted_as,
        assignments=(assignments_by_task or {}).get(t.id, []),
        my_capacities=(my_caps_by_task or {}).get(t.id, []),
        shared_company_ids=(shares_by_task or {}).get(t.id, []),
        product=_product_out(t, user_names=user_names),
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


async def _entity_to_out(
    db: AsyncSession,
    ent: Entity,
    tags: list[str] | None = None,
    *,
    allowed_task_ids: set[UUID] | None = None,
    assignments_by_task: dict[UUID, list[TaskAssignmentOut]] | None = None,
    my_caps_by_task: dict[UUID, list[str]] | None = None,
    shares_by_task: dict[UUID, list[UUID]] | None = None,
    user_names: dict[UUID, str] | None = None,
) -> EntityOut:
    if tags is None:
        tag_rows = (
            (
                await db.execute(
                    select(Tag.name)
                    .join(EntityTag, EntityTag.tag_id == Tag.id)
                    .where(EntityTag.entity_id == ent.id)
                )
            )
            .scalars()
            .all()
        )
        tags = sorted(str(t) for t in tag_rows)

    dept_outs: list[EntityDepartmentOut] = []
    for ed in sorted(ent.departments, key=lambda x: x.sort_order):
        tasks_list = sorted(ed.tasks, key=lambda x: x.sort_order)
        if allowed_task_ids is not None:
            tasks_list = [t for t in tasks_list if t.id in allowed_task_ids]
            if not tasks_list:
                continue
        dept_outs.append(
            EntityDepartmentOut(
                id=ed.id,
                department_id=ed.department_id,
                name=ed.department.name if ed.department else "",
                folder_name=ed.department.folder_name if ed.department else "",
                sort_order=ed.sort_order,
                tasks=[
                    _task_out(
                        t,
                        assignments_by_task=assignments_by_task,
                        my_caps_by_task=my_caps_by_task,
                        shares_by_task=shares_by_task,
                        user_names=user_names,
                    )
                    for t in tasks_list
                ],
            )
        )
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


async def _load_task_metadata_maps(
    db: AsyncSession, auth: AuthContext
) -> tuple[
    dict[UUID, list[TaskAssignmentOut]],
    dict[UUID, list[str]],
    dict[UUID, list[UUID]],
    dict[UUID, str],
]:
    user_rows = (await db.execute(select(User))).scalars().all()
    user_by_id = {u.id: u for u in user_rows}
    user_names = {u.id: u.full_name for u in user_rows}

    assign_rows = (await db.execute(select(TaskAssignment))).scalars().all()
    assignments_by_task: dict[UUID, list[TaskAssignmentOut]] = {}
    for ta in assign_rows:
        u = user_by_id.get(ta.user_id)
        if u is None:
            continue
        assignments_by_task.setdefault(ta.task_id, []).append(
            TaskAssignmentOut(
                user_id=u.id,
                username=u.username,
                full_name=u.full_name,
                avatar_file=u.avatar_file,
                assignment_role=cast(Literal["artist", "lead", "supervisor"], ta.assignment_role),
                source=ta.source,
            )
        )

    shares_by_task: dict[UUID, list[UUID]] = {}
    share_rows = (await db.execute(select(TaskShare))).scalars().all()
    for ts in share_rows:
        shares_by_task.setdefault(ts.task_id, []).append(ts.company_id)

    return assignments_by_task, auth.my_task_capacities, shares_by_task, user_names


@router.post("/reconcile", response_model=ReconcileReportOut)
async def trigger_reconcile(
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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


@router.get("/entities", response_model=EntityTreeOut | ClientEntityTreeOut)
async def list_entities(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
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
) -> EntityTreeOut | ClientEntityTreeOut:
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

    # Dedicated client-only allowlist serializer (§15)
    if auth.role.name == "client":
        vis_tasks = await visible_task_ids(db, auth, "task.view")
        shared_vers = await client_shared_version_ids(db, auth.user.company_id)
        q_low = q.strip().lower()
        client_entities: list[ClientEntityOut] = []
        for ent in entities:
            if (
                q_low
                and q_low not in ent.name.lower()
                and q_low not in (ent.entity_type or "").lower()
            ):
                continue
            dept_items: list[ClientEntityDepartmentOut] = []
            for ed in sorted(ent.departments, key=lambda x: x.sort_order):
                task_items: list[ClientTaskOut] = []
                for t in sorted(ed.tasks, key=lambda x: x.sort_order):
                    if vis_tasks is not None and t.id not in vis_tasks:
                        continue
                    c_prod = _client_product_out(t, shared_vers)
                    if c_prod is None and (vis_tasks is None or t.id not in vis_tasks):
                        continue
                    task_items.append(
                        ClientTaskOut(
                            id=t.id,
                            name=t.name,
                            status=t.status,
                            product=c_prod,
                        )
                    )
                if task_items:
                    dept_items.append(
                        ClientEntityDepartmentOut(
                            id=ed.id,
                            department_id=ed.department_id,
                            name=ed.department.name if ed.department else "",
                            tasks=task_items,
                        )
                    )
            if dept_items:
                client_entities.append(
                    ClientEntityOut(
                        id=ent.id,
                        name=ent.name,
                        entity_type=ent.entity_type,
                        description=ent.description,
                        resolved_thumbnail_file_id=_client_resolve_thumb(ent, shared_vers),
                        departments=dept_items,
                    )
                )
        return ClientEntityTreeOut(
            project_uuid=ctx.uuid,
            project_name=ctx.name,
            entities=client_entities,
            total=len(client_entities),
        )

    vis_ids: set[UUID] | None = None
    if auth.role.name == "external":
        vis_ids = await visible_task_ids(db, auth, "task.view")

    tag_stmt = select(EntityTag.entity_id, Tag.name).join(Tag, EntityTag.tag_id == Tag.id)
    tags_by_entity: dict[str, list[str]] = {}
    all_tags: set[str] = set()
    for eid, tname in (await db.execute(tag_stmt)).all():
        s_tag = str(tname)
        tags_by_entity.setdefault(str(eid), []).append(s_tag)
        all_tags.add(s_tag)

    available_types = sorted({e.entity_type for e in entities if e.entity_type})
    discovery = (
        await asyncio.to_thread(_discover_production_tree, ctx.production_dir)
        if auth.role.name != "external"
        else None
    )

    q_low = q.strip().lower()
    req_tags = {t.strip().lower() for t in tag if t.strip()}
    filtered: list[Entity] = []
    for ent in entities:
        if vis_ids is not None:
            has_visible_task = any(t.id in vis_ids for ed in ent.departments for t in ed.tasks)
            if not has_visible_task:
                continue
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

    assignments_map, my_caps_map, shares_map, user_names = await _load_task_metadata_maps(db, auth)
    out_entities = [
        await _entity_to_out(
            db,
            ent,
            sorted(tags_by_entity.get(str(ent.id), [])),
            allowed_task_ids=vis_ids,
            assignments_by_task=assignments_map,
            my_caps_by_task=my_caps_map,
            shares_by_task=shares_map,
            user_names=user_names,
        )
        for ent in page_items
    ]
    return EntityTreeOut(
        project_uuid=ctx.uuid,
        project_name=ctx.name,
        entities=out_entities,
        plain_folders=discovery.plain_folders if discovery is not None else [],
        available_types=available_types,
        available_tags=sorted(all_tags),
        next_cursor=next_cursor,
        total=total,
    )


@router.post("/entities", response_model=EntityOut, status_code=201)
async def create_entity(
    payload: EntityCreateRequest,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await soft_delete_entity(db, ctx, entity_id)
    return Response(status_code=204)


@router.post("/folders", status_code=201)
async def create_folder(
    payload: FolderCreateRequest,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
) -> dict[str, str]:
    rel_path = await create_plain_folder(ctx, payload.parent_rel_path, payload.name)
    return {"rel_path": rel_path}


@router.post("/folders/promote", response_model=EntityOut)
async def promote_folder_body(
    payload: FolderPromoteRequest,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[EntityDataItem]:
    if auth.role.name == "client":
        raise NotFoundError("entity", str(entity_id))
    ent = await db.get(Entity, entity_id)
    if ent is None or ent.archived_at is not None:
        raise NotFoundError("entity", str(entity_id))
    rows = (
        (
            await db.execute(
                select(EntityData)
                .where(EntityData.entity_id == entity_id)
                .order_by(EntityData.key.asc())
            )
        )
        .scalars()
        .all()
    )
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: Annotated[StorageBackend, Depends(get_storage)],
    cache_storage: Annotated[StorageBackend, Depends(get_cache_storage)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> Response:
    ent = await _load_entity_full(db, entity_id)
    if auth.role.name == "client":
        shared_vers = await client_shared_version_ids(db, auth.user.company_id)
        file_id = _client_resolve_thumb(ent, shared_vers)
    else:
        file_id = resolve_entity_thumbnail_file_id(ent)
    if file_id is None:
        raise NotFoundError("entity_thumbnail", str(entity_id))
    await can_access_file(db, auth, file_id)
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
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
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await detach_entity_department(db, ed_id)
    return Response(status_code=204)


@router.post("/entity-departments/{ed_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task_endpoint(
    ed_id: UUID,
    payload: TaskCreateRequest,
    _auth: Annotated[AuthContext, Depends(require("task.create", write=True))],
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


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task_endpoint(
    task_id: UUID,
    _auth: Annotated[AuthContext, Depends(require("task.delete", write=True))],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await soft_delete_task(db, ctx, task_id)
    return Response(status_code=204)
