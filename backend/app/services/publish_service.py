from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
from collections.abc import Sequence
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, NotFoundError
from app.core.project_registry import ProjectContext
from app.formats.base import FormatRegistry
from app.models.project_db import (
    EntityDepartment,
    Product,
    ProductVersion,
    Task,
)
from app.services.entity_service import move_to_trash, resolve_production_rel
from app.services.naming import format_version_label
from app.services.reconcile_service import _collect_version_files, _register_file_item

_PRODUCT_LOCKS: dict[str, asyncio.Lock] = {}


def _lock_for_product(product_id: UUID) -> asyncio.Lock:
    key = str(product_id)
    lock = _PRODUCT_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _PRODUCT_LOCKS[key] = lock
    return lock


def write_master_json(products_dir: Path, version_label: str | None) -> None:
    """Atomically write or remove products/master.json for external pipeline tools."""
    products_dir.mkdir(parents=True, exist_ok=True)
    master_file = products_dir / "master.json"
    if version_label is None:
        if master_file.exists():
            master_file.unlink()
        return

    fd, tmp_name = tempfile.mkstemp(prefix=".master_", suffix=".json", dir=str(products_dir))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"version": version_label}, fh, indent=2)
        os.replace(tmp_name, str(master_file))
    finally:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)


async def load_task_with_product(db: AsyncSession, task_id: UUID) -> tuple[Task, Product]:
    res = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.entity_department).selectinload(EntityDepartment.entity),
            selectinload(Task.entity_department).selectinload(EntityDepartment.department),
            selectinload(Task.product)
            .selectinload(Product.versions)
            .selectinload(ProductVersion.files),
        )
        .execution_options(populate_existing=True)
    )
    task = res.scalar_one_or_none()
    if task is None:
        raise NotFoundError("task", str(task_id))
    prod = task.product
    if prod is None:
        prod = Product(
            task_id=task.id,
            name=f"{task.entity_department.department.folder_name}/{task.folder_name}",
        )
        db.add(prod)
        await db.flush()
    return task, prod


def task_dirs(ctx: ProjectContext, task: Task) -> tuple[Path, Path, Path]:
    ed = task.entity_department
    t_dir = (
        resolve_production_rel(ctx.production_dir, ed.entity.rel_path)
        / ed.department.folder_name
        / task.folder_name
    )
    return t_dir, t_dir / "products", t_dir / "scenefiles"


async def _allocate_and_register_version(
    db: AsyncSession,
    ctx: ProjectContext,
    registry: FormatRegistry,
    task: Task,
    product: Product,
    *,
    comment: str,
    source_paths: list[str],
    set_master: bool | None,
    stage_dir: Path,
    created_by_user_id: UUID | None = None,
) -> ProductVersion:
    """Allocate next version number transactionally, move staged files, register, and set master."""
    _, products_dir, _ = task_dirs(ctx, task)
    products_dir.mkdir(parents=True, exist_ok=True)
    prod_root = ctx.production_dir.resolve()

    version: ProductVersion | None = None
    ver_dir: Path | None = None
    for attempt in range(4):
        max_num = (
            await db.execute(
                select(func.coalesce(func.max(ProductVersion.version_number), 0)).where(
                    ProductVersion.product_id == product.id
                )
            )
        ).scalar_one()
        next_num = int(max_num) + 1
        while (products_dir / format_version_label(next_num)).exists():
            next_num += 1
        v_label = format_version_label(next_num)
        ver_dir = products_dir / v_label
        v_rel = ver_dir.relative_to(prod_root).as_posix()

        try:
            await asyncio.to_thread(shutil.move, str(stage_dir), str(ver_dir))
            version = ProductVersion(
                product_id=product.id,
                version_number=next_num,
                label=v_label,
                rel_path=v_rel,
                comment=comment.strip(),
                source_json=source_paths,
                created_by_user_id=created_by_user_id,
            )
            db.add(version)
            await db.flush()
            break
        except IntegrityError:
            await db.rollback()
            if ver_dir is not None and ver_dir.exists() and attempt < 3:
                await asyncio.to_thread(shutil.move, str(ver_dir), str(stage_dir))
                continue
            raise

    assert version is not None and ver_dir is not None

    items = await asyncio.to_thread(_collect_version_files, ver_dir, prod_root)
    for item in items:
        await _register_file_item(db, version, item, registry)

    # Decision #8: first published version is auto-starred; later versions only if set_master=True
    should_star = product.master_version_id is None or set_master is True
    if should_star:
        product.master_version_id = version.id
        await asyncio.to_thread(write_master_json, products_dir, version.label)

    task.latest_version_id = version.id
    from app.services.task_service import reevaluate_downstream_wtg

    await db.flush()
    await reevaluate_downstream_wtg(db, task.id)
    await db.commit()
    return version


async def publish_from_scenefiles(
    db: AsyncSession,
    ctx: ProjectContext,
    registry: FormatRegistry,
    task_id: UUID,
    scenefile_rel_paths: list[str],
    *,
    comment: str = "",
    set_master: bool | None = None,
    created_by_user_id: UUID | None = None,
) -> ProductVersion:
    if not scenefile_rel_paths:
        raise AppError("empty_publish", "Select at least one file to publish", status_code=400)

    task, product = await load_task_with_product(db, task_id)
    _, products_dir, scenefiles_dir = task_dirs(ctx, task)
    scene_root = scenefiles_dir.resolve()

    resolved_sources: list[tuple[str, Path]] = []
    for rel in scenefile_rel_paths:
        clean = rel.strip().strip("/\\")
        if not clean:
            raise AppError("invalid_path", "Empty source path", status_code=400)
        cand = (scene_root / clean).resolve()
        try:
            cand.relative_to(scene_root)
        except ValueError as exc:
            raise AppError(
                "invalid_path", "Source path escapes task scenefiles/", status_code=400
            ) from exc
        if not cand.exists():
            raise NotFoundError("scenefile", clean)
        resolved_sources.append((clean, cand))

    async with _lock_for_product(product.id):
        products_dir.mkdir(parents=True, exist_ok=True)
        stage_dir = Path(tempfile.mkdtemp(prefix=".stage_pub_", dir=str(products_dir)))
        try:

            def _copy_all() -> None:
                for _, src in resolved_sources:
                    dst = stage_dir / src.name
                    if src.is_dir():
                        shutil.copytree(src, dst)
                    else:
                        shutil.copy2(src, dst)

            await asyncio.to_thread(_copy_all)
            source_project_rels = [
                f"{task.entity_department.entity.rel_path}/{task.entity_department.department.folder_name}/{task.folder_name}/scenefiles/{rel}"
                for rel, _ in resolved_sources
            ]
            return await _allocate_and_register_version(
                db,
                ctx,
                registry,
                task,
                product,
                comment=comment,
                source_paths=source_project_rels,
                set_master=set_master,
                stage_dir=stage_dir,
                created_by_user_id=created_by_user_id,
            )
        except Exception:
            await asyncio.to_thread(shutil.rmtree, stage_dir, True)
            raise


async def publish_from_uploads(
    db: AsyncSession,
    ctx: ProjectContext,
    registry: FormatRegistry,
    task_id: UUID,
    uploads: Sequence[UploadFile],
    *,
    comment: str = "",
    set_master: bool | None = None,
    created_by_user_id: UUID | None = None,
) -> ProductVersion:
    if not uploads:
        raise AppError("empty_publish", "Provide at least one file to publish", status_code=400)

    task, product = await load_task_with_product(db, task_id)
    _, products_dir, _ = task_dirs(ctx, task)

    async with _lock_for_product(product.id):
        products_dir.mkdir(parents=True, exist_ok=True)
        stage_dir = Path(tempfile.mkdtemp(prefix=".stage_up_", dir=str(products_dir)))
        try:
            names: list[str] = []
            for up in uploads:
                raw_name = Path(up.filename or "upload.bin").name
                if not raw_name or raw_name in (".", ".."):
                    raw_name = "upload.bin"
                dest = stage_dir / raw_name
                with dest.open("wb") as fh:
                    while True:
                        chunk = await up.read(65536)
                        if not chunk:
                            break
                        fh.write(chunk)
                names.append(raw_name)

            return await _allocate_and_register_version(
                db,
                ctx,
                registry,
                task,
                product,
                comment=comment,
                source_paths=names,
                set_master=set_master,
                stage_dir=stage_dir,
                created_by_user_id=created_by_user_id,
            )
        except Exception:
            await asyncio.to_thread(shutil.rmtree, stage_dir, True)
            raise


async def set_product_master(
    db: AsyncSession,
    ctx: ProjectContext,
    product_id: UUID,
    version_id: UUID,
) -> Product:
    prod_res = await db.execute(
        select(Product)
        .where(Product.id == product_id)
        .options(
            selectinload(Product.versions),
            selectinload(Product.task)
            .selectinload(Task.entity_department)
            .selectinload(EntityDepartment.entity),
            selectinload(Product.task)
            .selectinload(Task.entity_department)
            .selectinload(EntityDepartment.department),
        )
    )
    product = prod_res.scalar_one_or_none()
    if product is None:
        raise NotFoundError("product", str(product_id))

    target_ver = next((v for v in product.versions if v.id == version_id), None)
    if target_ver is None:
        raise NotFoundError("product_version", str(version_id))

    product.master_version_id = target_ver.id
    _, products_dir, _ = task_dirs(ctx, product.task)
    await asyncio.to_thread(write_master_json, products_dir, target_ver.label)
    await db.commit()
    return product


async def soft_delete_version(
    db: AsyncSession,
    ctx: ProjectContext,
    version_id: UUID,
) -> None:
    ver_res = await db.execute(
        select(ProductVersion)
        .where(ProductVersion.id == version_id)
        .options(
            selectinload(ProductVersion.product)
            .selectinload(Product.task)
            .selectinload(Task.entity_department)
            .selectinload(EntityDepartment.entity),
            selectinload(ProductVersion.product)
            .selectinload(Product.task)
            .selectinload(Task.entity_department)
            .selectinload(EntityDepartment.department),
        )
    )
    ver = ver_res.scalar_one_or_none()
    if ver is None:
        raise NotFoundError("product_version", str(version_id))

    product = ver.product
    _, products_dir, _ = task_dirs(ctx, product.task)
    ver_dir = resolve_production_rel(ctx.production_dir, ver.rel_path)
    if ver_dir.exists():
        await asyncio.to_thread(move_to_trash, ctx.trash_dir, ver_dir)

    if product.master_version_id == ver.id:
        product.master_version_id = None
        await asyncio.to_thread(write_master_json, products_dir, None)

    await db.delete(ver)
    await db.commit()
