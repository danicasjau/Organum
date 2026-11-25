from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.project_registry import ProjectContext
from app.db.base import utc_now
from app.formats.base import FormatRegistry
from app.models.project_db import (
    Department,
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
from app.services.naming import check_case_insensitive_collision, sanitize_folder_name
from app.services.reconcile_service import reconcile_project


def _safe_trash_dest(trash_dir: Path, name: str) -> Path:
    trash_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    return trash_dir / f"{stamp}_{uuid.uuid4().hex[:8]}_{name}"


_ACTIVE_WATCH_EVENTS: list[tuple[Path, object]] = []


def register_active_watch(watch_dir: Path, stop_event: object) -> None:
    _ACTIVE_WATCH_EVENTS.append((watch_dir.resolve(), stop_event))


def unregister_active_watch(stop_event: object) -> None:
    _ACTIVE_WATCH_EVENTS[:] = [pair for pair in _ACTIVE_WATCH_EVENTS if pair[1] is not stop_event]


def stop_watches_under(target: Path) -> None:
    """Signal any active directory watcher inside target so Windows releases its handle."""
    resolved = target.resolve()
    for watch_dir, stop_ev in list(_ACTIVE_WATCH_EVENTS):
        if watch_dir == resolved or resolved in watch_dir.parents:
            setter = getattr(stop_ev, "set", None)
            if callable(setter):
                setter()


def move_to_trash(trash_dir: Path, target: Path) -> Path:
    """Move a file or directory to 00_Pipeline/trash safely without hard deletion."""
    stop_watches_under(target)
    dest = _safe_trash_dest(trash_dir, target.name)
    shutil.move(str(target), str(dest))
    return dest


def resolve_production_rel(production_dir: Path, rel_path: str) -> Path:
    """Resolve a production-relative path strictly inside 01_Production."""
    root = production_dir.resolve()
    clean = rel_path.strip().strip("/\\")
    if not clean:
        return root
    candidate = (root / clean).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise AppError("invalid_path", "Path escapes 01_Production root", status_code=400) from exc
    return candidate


def assert_not_inside_entity(production_dir: Path, folder: Path) -> None:
    """Raise ConflictError if folder or any ancestor inside 01_Production is an entity."""
    root = production_dir.resolve()
    cur = folder.resolve()
    while True:
        if cur == root:
            return
        if (cur / ".entity.json").is_file():
            raise ConflictError("Entities cannot be nested inside another entity")
        if cur.parent == cur:
            return
        cur = cur.parent


def assert_contains_no_entity(folder: Path) -> None:
    """Raise ConflictError if any subdirectory contains .entity.json."""
    if not folder.is_dir():
        return
    for p in folder.rglob(".entity.json"):
        if p.parent.resolve() != folder.resolve():
            raise ConflictError("Folder already contains a nested entity")


def resolve_entity_thumbnail_file_id(entity: Entity) -> UUID | None:
    """Resolve thumbnail file ID per CR02 §5 auto/manual/none rules."""
    if entity.thumbnail_source == "none":
        return None
    if entity.thumbnail_source == "manual" and entity.thumbnail_file_id is not None:
        return entity.thumbnail_file_id

    for ed in sorted(entity.departments, key=lambda d: d.sort_order):
        for task in sorted(ed.tasks, key=lambda t: t.sort_order):
            prod = task.product
            if prod is None or not prod.versions:
                continue
            versions_sorted = sorted(prod.versions, key=lambda v: v.version_number, reverse=True)
            ordered_versions = versions_sorted
            if prod.master_version_id is not None:
                master = [v for v in versions_sorted if v.id == prod.master_version_id]
                rest = [v for v in versions_sorted if v.id != prod.master_version_id]
                ordered_versions = master + rest
            for ver in ordered_versions:
                for f in sorted(ver.files, key=lambda x: x.filename.lower()):
                    if not f.is_missing and f.filename.lower().endswith(".png"):
                        return f.id
    return None


async def set_entity_tags(db: AsyncSession, entity_id: UUID, tag_names: list[str]) -> list[str]:
    """Replace an entity's tags atomically, reusing or creating canonical Tag rows."""
    cleaned: list[str] = []
    seen_low: set[str] = set()
    for raw in tag_names:
        t = raw.strip()
        if not t or t.lower() in seen_low:
            continue
        seen_low.add(t.lower())
        cleaned.append(t)

    await db.execute(delete(EntityTag).where(EntityTag.entity_id == entity_id))
    for name in cleaned:
        existing = (await db.execute(select(Tag).where(Tag.name == name))).scalar_one_or_none()
        if existing is None:
            existing = Tag(name=name)
            db.add(existing)
            await db.flush()
        db.add(EntityTag(entity_id=entity_id, tag_id=existing.id))
    return sorted(cleaned)


async def create_entity_atomic(
    db: AsyncSession,
    ctx: ProjectContext,
    *,
    name: str,
    parent_rel_path: str = "",
    entity_type: str | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    department_ids: list[UUID] | None = None,
) -> Entity:
    """Create an entity on disk and in project.db atomically, rolling back on failure."""
    folder_name = sanitize_folder_name(name)
    parent_dir = resolve_production_rel(ctx.production_dir, parent_rel_path)
    if not parent_dir.exists() or not parent_dir.is_dir():
        raise NotFoundError("folder", parent_rel_path or "01_Production")
    assert_not_inside_entity(ctx.production_dir, parent_dir)

    if await asyncio.to_thread(check_case_insensitive_collision, parent_dir, folder_name):
        raise ConflictError(f"A sibling folder named '{folder_name}' already exists")

    entity_id = uuid.uuid4()
    entity_dir = parent_dir / folder_name
    rel_path = entity_dir.relative_to(ctx.production_dir.resolve()).as_posix()

    depts: list[Department] = []
    if department_ids:
        res = await db.execute(
            select(Department)
            .where(Department.id.in_(department_ids), Department.is_active.is_(True))
            .options(selectinload(Department.default_tasks))
            .order_by(Department.sort_order.asc(), Department.name.asc())
        )
        by_id = {d.id: d for d in res.scalars().all()}
        for did in department_ids:
            if did in by_id and by_id[did] not in depts:
                depts.append(by_id[did])

    def _prepare_disk() -> None:
        entity_dir.mkdir(parents=True, exist_ok=False)
        (entity_dir / ".entity.json").write_text(
            json.dumps({"uuid": str(entity_id), "schema_version": 2}, indent=2),
            encoding="utf-8",
        )
        for dept in depts:
            dept_dir = entity_dir / dept.folder_name
            dept_dir.mkdir(parents=True, exist_ok=True)
            task_defs = list(dept.default_tasks) or []
            for td in task_defs:
                tdir = dept_dir / td.folder_name
                (tdir / "products").mkdir(parents=True, exist_ok=True)
                (tdir / "scenefiles").mkdir(parents=True, exist_ok=True)

    await asyncio.to_thread(_prepare_disk)
    try:
        clean_type = entity_type.strip() if entity_type and entity_type.strip() else None
        clean_desc = description.strip() if description and description.strip() else None
        entity = Entity(
            id=entity_id,
            name=folder_name,
            folder_name=folder_name,
            rel_path=rel_path,
            entity_type=clean_type,
            description=clean_desc,
            thumbnail_source="auto",
            is_missing=False,
        )
        db.add(entity)
        await db.flush()

        for dept in depts:
            ed = EntityDepartment(
                entity_id=entity.id,
                department_id=dept.id,
                sort_order=dept.sort_order,
            )
            db.add(ed)
            await db.flush()
            from app.services.task_service import create_task_unified

            for td in sorted(dept.default_tasks, key=lambda x: x.sort_order):
                await create_task_unified(
                    db,
                    ctx,
                    entity=entity,
                    ed=ed,
                    dept=dept,
                    name=td.name,
                    default_task=td,
                    create_dirs=False,
                    commit=False,
                )

        if tags:
            await set_entity_tags(db, entity.id, tags)

        await db.commit()
    except Exception:
        await db.rollback()
        await asyncio.to_thread(shutil.rmtree, entity_dir, True)
        raise

    return entity


async def _rewrite_entity_rel_prefixes(
    db: AsyncSession,
    entity_id: UUID,
    old_prefix: str,
    new_prefix: str,
) -> None:
    if old_prefix == new_prefix:
        return
    t_res = await db.execute(select(Task.id).where(Task.entity_id == entity_id))
    task_ids = [row[0] for row in t_res.all()]
    if not task_ids:
        return
    p_res = await db.execute(select(Product.id).where(Product.task_id.in_(task_ids)))
    prod_ids = [row[0] for row in p_res.all()]
    if not prod_ids:
        return
    v_res = await db.execute(select(ProductVersion).where(ProductVersion.product_id.in_(prod_ids)))
    versions = v_res.scalars().all()
    ver_ids = [v.id for v in versions]
    old_slash = f"{old_prefix}/"
    new_slash = f"{new_prefix}/"
    for v in versions:
        if v.rel_path.startswith(old_slash):
            v.rel_path = new_slash + v.rel_path[len(old_slash) :]
    if ver_ids:
        f_res = await db.execute(select(FileEntry).where(FileEntry.product_version_id.in_(ver_ids)))
        for f in f_res.scalars().all():
            if f.relative_path.startswith(old_slash):
                f.relative_path = new_slash + f.relative_path[len(old_slash) :]


async def update_entity(
    db: AsyncSession,
    ctx: ProjectContext,
    entity_id: UUID,
    *,
    name: str | None = None,
    parent_rel_path: str | None = None,
    entity_type: str | None = None,
    description: str | None = None,
    update_type: bool = False,
    update_description: bool = False,
) -> Entity:
    entity = await db.get(Entity, entity_id)
    if entity is None or entity.archived_at is not None:
        raise NotFoundError("entity", str(entity_id))

    if name is not None or parent_rel_path is not None:
        old_rel = entity.rel_path
        old_dir = resolve_production_rel(ctx.production_dir, old_rel)
        new_folder = sanitize_folder_name(name) if name is not None else entity.folder_name
        if parent_rel_path is not None:
            dest_parent = resolve_production_rel(ctx.production_dir, parent_rel_path)
        else:
            dest_parent = old_dir.parent

        if not dest_parent.exists() or not dest_parent.is_dir():
            raise NotFoundError("folder", parent_rel_path or "")
        assert_not_inside_entity(ctx.production_dir, dest_parent)
        dest_dir = dest_parent / new_folder
        if dest_dir.resolve() != old_dir.resolve():
            ignore = old_dir.name if dest_parent.resolve() == old_dir.parent.resolve() else None
            if await asyncio.to_thread(
                check_case_insensitive_collision, dest_parent, new_folder, ignore
            ):
                raise ConflictError(f"A sibling folder named '{new_folder}' already exists")
            if old_dir.exists():
                stop_watches_under(old_dir)
                await asyncio.sleep(0.05)
                await asyncio.to_thread(shutil.move, str(old_dir), str(dest_dir))
            new_rel = dest_dir.relative_to(ctx.production_dir.resolve()).as_posix()
            entity.folder_name = new_folder
            entity.name = new_folder
            entity.rel_path = new_rel
            await _rewrite_entity_rel_prefixes(db, entity.id, old_rel, new_rel)

    if update_type:
        entity.entity_type = entity_type.strip() if entity_type and entity_type.strip() else None
        ent_tasks = (
            (await db.execute(select(Task).where(Task.entity_id == entity.id))).scalars().all()
        )
        for t in ent_tasks:
            t.parent_entity_type = entity.entity_type
    if update_description:
        entity.description = description.strip() if description and description.strip() else None

    await db.commit()
    return entity


async def soft_delete_entity(
    db: AsyncSession,
    ctx: ProjectContext,
    entity_id: UUID,
) -> None:
    entity = await db.get(Entity, entity_id)
    if entity is None or entity.archived_at is not None:
        raise NotFoundError("entity", str(entity_id))
    old_rel = entity.rel_path
    ent_dir = resolve_production_rel(ctx.production_dir, old_rel)
    if ent_dir.exists():
        stop_watches_under(ent_dir)
        await asyncio.sleep(0.05)
        await asyncio.to_thread(move_to_trash, ctx.trash_dir, ent_dir)
    if not old_rel.startswith("__trashed__/"):
        trashed_rel = f"__trashed__/{entity.id.hex}/{old_rel}"
        entity.rel_path = trashed_rel
        await _rewrite_entity_rel_prefixes(db, entity.id, old_rel, trashed_rel)
    entity.archived_at = utc_now()
    await db.commit()


async def create_plain_folder(
    ctx: ProjectContext,
    parent_rel_path: str,
    name: str,
) -> str:
    clean = sanitize_folder_name(name)
    parent = resolve_production_rel(ctx.production_dir, parent_rel_path)
    if not parent.exists() or not parent.is_dir():
        raise NotFoundError("folder", parent_rel_path or "01_Production")
    assert_not_inside_entity(ctx.production_dir, parent)
    if await asyncio.to_thread(check_case_insensitive_collision, parent, clean):
        raise ConflictError(f"Folder '{clean}' already exists")
    target = parent / clean
    await asyncio.to_thread(target.mkdir, parents=False, exist_ok=False)
    return target.relative_to(ctx.production_dir.resolve()).as_posix()


async def promote_folder_to_entity(
    db: AsyncSession,
    ctx: ProjectContext,
    registry: FormatRegistry,
    rel_path: str,
) -> Entity:
    target = resolve_production_rel(ctx.production_dir, rel_path)
    if target.resolve() == ctx.production_dir.resolve():
        raise AppError("invalid_path", "Cannot promote 01_Production root", status_code=400)
    if not target.exists() or not target.is_dir():
        raise NotFoundError("folder", rel_path)
    assert_not_inside_entity(ctx.production_dir, target.parent)
    assert_contains_no_entity(target)

    marker = target / ".entity.json"
    if marker.is_file():
        meta = json.loads(marker.read_text(encoding="utf-8"))
        ent_uuid = UUID(str(meta["uuid"]))
    else:
        ent_uuid = uuid.uuid4()
        await asyncio.to_thread(
            marker.write_text,
            json.dumps({"uuid": str(ent_uuid), "schema_version": 2}, indent=2),
            "utf-8",
        )
    await reconcile_project(db, ctx.production_dir, registry)
    ent = await db.get(Entity, ent_uuid)
    if ent is None:
        raise NotFoundError("entity", str(ent_uuid))
    return ent


async def attach_department_to_entity(
    db: AsyncSession,
    ctx: ProjectContext,
    entity_id: UUID,
    department_id: UUID,
) -> EntityDepartment:
    entity = await db.get(Entity, entity_id)
    if entity is None or entity.archived_at is not None:
        raise NotFoundError("entity", str(entity_id))

    dept_res = await db.execute(
        select(Department)
        .where(Department.id == department_id, Department.is_active.is_(True))
        .options(selectinload(Department.default_tasks))
    )
    dept = dept_res.scalar_one_or_none()
    if dept is None:
        raise NotFoundError("department", str(department_id))

    existing = (
        await db.execute(
            select(EntityDepartment).where(
                EntityDepartment.entity_id == entity_id,
                EntityDepartment.department_id == department_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Department '{dept.name}' is already attached to '{entity.name}'")

    ent_dir = resolve_production_rel(ctx.production_dir, entity.rel_path)
    dept_dir = ent_dir / dept.folder_name

    def _mk_dept() -> None:
        dept_dir.mkdir(parents=True, exist_ok=True)
        for td in dept.default_tasks:
            tdir = dept_dir / td.folder_name
            (tdir / "products").mkdir(parents=True, exist_ok=True)
            (tdir / "scenefiles").mkdir(parents=True, exist_ok=True)

    await asyncio.to_thread(_mk_dept)
    ed = EntityDepartment(entity_id=entity.id, department_id=dept.id, sort_order=dept.sort_order)
    db.add(ed)
    await db.flush()
    from app.services.task_service import create_task_unified

    for td in sorted(dept.default_tasks, key=lambda x: x.sort_order):
        await create_task_unified(
            db,
            ctx,
            entity=entity,
            ed=ed,
            dept=dept,
            name=td.name,
            default_task=td,
            create_dirs=False,
            commit=False,
        )
    await db.commit()
    return ed


async def detach_entity_department(db: AsyncSession, ed_id: UUID) -> None:
    """Remove department link from an entity without deleting disk files (CR02 §5)."""
    ed = await db.get(EntityDepartment, ed_id)
    if ed is None:
        raise NotFoundError("entity_department", str(ed_id))
    await db.delete(ed)
    await db.commit()


async def create_task_for_ed(
    db: AsyncSession,
    ctx: ProjectContext,
    ed_id: UUID,
    name: str,
) -> Task:
    ed_res = await db.execute(
        select(EntityDepartment)
        .where(EntityDepartment.id == ed_id)
        .options(selectinload(EntityDepartment.entity), selectinload(EntityDepartment.department))
    )
    ed = ed_res.scalar_one_or_none()
    if ed is None:
        raise NotFoundError("entity_department", str(ed_id))

    from app.services.task_service import create_task_unified

    return await create_task_unified(
        db,
        ctx,
        entity=ed.entity,
        ed=ed,
        dept=ed.department,
        name=name,
        create_dirs=True,
        commit=True,
    )


async def rename_task(
    db: AsyncSession,
    ctx: ProjectContext,
    task_id: UUID,
    new_name: str,
) -> Task:
    task_res = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.entity_department).selectinload(EntityDepartment.entity),
            selectinload(Task.entity_department).selectinload(EntityDepartment.department),
            selectinload(Task.product),
        )
    )
    task = task_res.scalar_one_or_none()
    if task is None:
        raise NotFoundError("task", str(task_id))

    clean = sanitize_folder_name(new_name)
    ed = task.entity_department
    ent_dir = resolve_production_rel(ctx.production_dir, ed.entity.rel_path)
    dept_dir = ent_dir / ed.department.folder_name
    old_dir = dept_dir / task.folder_name
    new_dir = dept_dir / clean
    if new_dir.resolve() != old_dir.resolve():
        if await asyncio.to_thread(check_case_insensitive_collision, dept_dir, clean, old_dir.name):
            raise ConflictError(f"Task '{clean}' already exists")
        if old_dir.exists():
            await asyncio.to_thread(shutil.move, str(old_dir), str(new_dir))
        old_prefix = f"{ed.entity.rel_path}/{ed.department.folder_name}/{task.folder_name}"
        new_prefix = f"{ed.entity.rel_path}/{ed.department.folder_name}/{clean}"
        await _rewrite_entity_rel_prefixes(db, ed.entity_id, old_prefix, new_prefix)
    task.name = clean
    task.folder_name = clean
    if task.product is not None:
        task.product.name = f"{ed.department.folder_name}/{clean}"
    await db.commit()
    return task


async def soft_delete_task(db: AsyncSession, ctx: ProjectContext, task_id: UUID) -> None:
    task_res = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.entity_department).selectinload(EntityDepartment.entity),
            selectinload(Task.entity_department).selectinload(EntityDepartment.department),
        )
    )
    task = task_res.scalar_one_or_none()
    if task is None:
        raise NotFoundError("task", str(task_id))
    ed = task.entity_department
    task_dir = (
        resolve_production_rel(ctx.production_dir, ed.entity.rel_path)
        / ed.department.folder_name
        / task.folder_name
    )
    if task_dir.exists():
        await asyncio.to_thread(move_to_trash, ctx.trash_dir, task_dir)
    await db.delete(task)
    await db.commit()


async def replace_entity_data(
    db: AsyncSession,
    entity_id: UUID,
    items: list[tuple[str, str, str]],
) -> list[EntityData]:
    entity = await db.get(Entity, entity_id)
    if entity is None or entity.archived_at is not None:
        raise NotFoundError("entity", str(entity_id))

    seen: set[str] = set()
    rows: list[EntityData] = []
    await db.execute(delete(EntityData).where(EntityData.entity_id == entity_id))
    for key, val_type, val_text in items:
        clean_k = key.strip()
        if not clean_k or clean_k in seen:
            continue
        seen.add(clean_k)
        row = EntityData(
            entity_id=entity_id,
            key=clean_k,
            value_type=val_type,
            value_text=val_text,
        )
        db.add(row)
        rows.append(row)
    await db.commit()
    return rows
