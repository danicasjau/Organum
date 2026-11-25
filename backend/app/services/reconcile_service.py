from __future__ import annotations

import asyncio
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.formats.base import FormatRegistry
from app.models.project_db import (
    Department,
    Entity,
    EntityDepartment,
    FileEntry,
    Product,
    ProductVersion,
    Task,
)
from app.services.naming import sanitize_folder_name
from app.services.udim_service import collect_version_files

_VERSION_RE = re.compile(r"^v(\d{4,})$", re.IGNORECASE)


@dataclass
class ReconcileReport:
    entities_scanned: int = 0
    entities_created: int = 0
    entities_updated: int = 0
    entities_missing: int = 0
    versions_registered: int = 0
    files_scanned: int = 0
    plain_folders: list[str] = field(default_factory=list)


def _hash_file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class _DiskDiscovery:
    entities: list[tuple[UUID, str, Path]]
    plain_folders: list[str]


def _discover_production_tree(production_root: Path) -> _DiskDiscovery:
    if not production_root.exists():
        return _DiskDiscovery(entities=[], plain_folders=[])

    entities: list[tuple[UUID, str, Path]] = []
    plain_folders: list[str] = []

    def _walk(folder: Path) -> None:
        try:
            children = sorted(
                p for p in folder.iterdir() if p.is_dir() and not p.name.startswith(".")
            )
        except OSError:
            return
        for child in children:
            marker = child / ".entity.json"
            if marker.is_file():
                try:
                    meta = json.loads(marker.read_text(encoding="utf-8"))
                    ent_uuid = UUID(str(meta["uuid"]))
                    rel_path = child.relative_to(production_root).as_posix()
                    entities.append((ent_uuid, rel_path, child))
                except Exception:
                    continue
                # Entities cannot be nested inside entities: stop descending here
                continue
            plain_folders.append(child.relative_to(production_root).as_posix())
            _walk(child)

    _walk(production_root)
    return _DiskDiscovery(entities=entities, plain_folders=plain_folders)


async def _ensure_department(db: AsyncSession, folder_name: str) -> Department:
    res = await db.execute(select(Department).where(Department.folder_name == folder_name))
    dept = res.scalar_one_or_none()
    if dept is not None:
        return dept
    clean = sanitize_folder_name(folder_name)
    raw = "".join(c for c in clean.upper() if c.isalnum())
    short_code = (raw[:3] if len(raw) >= 3 else (raw + "XXX")[:3]) or "DPT"
    dept = Department(
        name=clean,
        folder_name=clean,
        short_code=short_code,
        color="--series-1",
        sort_order=99,
        is_active=True,
    )
    db.add(dept)
    await db.flush()
    return dept


async def _ensure_task_product(
    db: AsyncSession,
    entity: Entity,
    dept_folder: str,
    task_folder: str,
) -> Product:
    dept = await _ensure_department(db, dept_folder)
    ed_res = await db.execute(
        select(EntityDepartment).where(
            EntityDepartment.entity_id == entity.id,
            EntityDepartment.department_id == dept.id,
        )
    )
    ed = ed_res.scalar_one_or_none()
    if ed is None:
        ed = EntityDepartment(
            entity_id=entity.id, department_id=dept.id, sort_order=dept.sort_order
        )
        db.add(ed)
        await db.flush()

    t_res = await db.execute(
        select(Task).where(
            Task.entity_department_id == ed.id,
            Task.folder_name == task_folder,
        )
    )
    task = t_res.scalar_one_or_none()
    if task is None:
        from app.models.project_db import ProjectMeta
        from app.models.tasks import TaskEvent
        from app.services.task_service import generate_unique_task_code

        meta = (await db.execute(select(ProjectMeta).limit(1))).scalar_one_or_none()
        pattern = meta.task_code_pattern if meta else "{entity_folder}_{dept_short}_{task_folder}"
        t_code = await generate_unique_task_code(
            db,
            entity_folder=entity.folder_name,
            dept_short=dept.short_code,
            dept_folder=dept.folder_name,
            task_folder=task_folder,
            pattern=pattern,
        )
        task = Task(
            task_code=t_code,
            task_name=f"{dept.name} - {task_folder}",
            entity_department_id=ed.id,
            entity_id=entity.id,
            parent_entity_type=entity.entity_type,
            department_id=dept.id,
            name=task_folder,
            folder_name=task_folder,
            sort_order=0,
            status="RDY",
        )
        db.add(task)
        await db.flush()
        db.add(
            TaskEvent(
                task_id=task.id,
                user_id=None,
                acted_as="system",
                source="system",
                field="created",
                new_value=f"{t_code} (RDY)",
            )
        )

    p_res = await db.execute(select(Product).where(Product.task_id == task.id))
    prod = p_res.scalar_one_or_none()
    if prod is None:
        prod = Product(task_id=task.id, name=f"{dept.folder_name}/{task.folder_name}")
        db.add(prod)
        await db.flush()
    return prod


def _collect_version_files(
    version_dir: Path,
    production_root: Path,
    udim_keywords: list[str] | None = None,
) -> list[dict[str, Any]]:
    return collect_version_files(version_dir, production_root, udim_keywords=udim_keywords)


async def _register_file_item(
    db: AsyncSession,
    version: ProductVersion,
    item: dict[str, Any],
    registry: FormatRegistry,
) -> None:
    disk_path: Path = item["disk_path"]
    rel_path: str = item["relative_path"]
    stat = await asyncio.to_thread(disk_path.stat)
    sha = await asyncio.to_thread(_hash_file_sha256, disk_path)

    res = await db.execute(select(FileEntry).where(FileEntry.relative_path == rel_path))
    existing = res.scalar_one_or_none()
    if existing is not None:
        changed = existing.sha256 != sha or existing.size != stat.st_size
        existing.product_version_id = version.id
        existing.is_missing = False
        existing.mtime = stat.st_mtime
        existing.frame_start = item["frame_start"]
        existing.frame_end = item["frame_end"]
        existing.frame_count = item["frame_count"]
        if not existing.sequence_kind_user_override:
            existing.sequence_kind = str(item["sequence_kind"])
        if changed:
            handler = registry.resolve(disk_path)
            probe = await handler.probe(disk_path)
            existing.sha256 = sha
            existing.size = stat.st_size
            existing.detected_format = probe.format_id
            existing.media_kind = probe.media_kind
            existing.probe_json = probe.details
        return

    handler = registry.resolve(disk_path)
    probe = await handler.probe(disk_path)
    entry = FileEntry(
        product_version_id=version.id,
        relative_path=rel_path,
        filename=item["filename"],
        size=stat.st_size,
        sha256=sha,
        mtime=stat.st_mtime,
        detected_format=probe.format_id,
        media_kind=probe.media_kind,
        probe_json=probe.details,
        is_sequence=bool(item["is_sequence"]),
        sequence_pattern=item["sequence_pattern"],
        sequence_kind=str(item["sequence_kind"]),
        frame_start=item["frame_start"],
        frame_end=item["frame_end"],
        frame_count=item["frame_count"],
        is_missing=False,
    )
    db.add(entry)


async def reconcile_project(
    db: AsyncSession,
    production_root: Path,
    format_registry: FormatRegistry,
) -> ReconcileReport:
    """Reconcile DB entities, tasks, product versions, and files with disk state."""
    discovery = await asyncio.to_thread(_discover_production_tree, production_root)
    report = ReconcileReport(plain_folders=discovery.plain_folders)

    seen_entity_ids: set[UUID] = set()
    for ent_uuid, rel_path, ent_dir in discovery.entities:
        report.entities_scanned += 1
        seen_entity_ids.add(ent_uuid)
        entity = await db.get(Entity, ent_uuid)
        if entity is None:
            entity = Entity(
                id=ent_uuid,
                name=ent_dir.name,
                folder_name=ent_dir.name,
                rel_path=rel_path,
                is_missing=False,
            )
            db.add(entity)
            await db.flush()
            report.entities_created += 1
        else:
            needs_update = (
                entity.rel_path != rel_path
                or entity.folder_name != ent_dir.name
                or entity.is_missing
            )
            if needs_update:
                entity.rel_path = rel_path
                entity.folder_name = ent_dir.name
                entity.name = ent_dir.name
                entity.is_missing = False
                report.entities_updated += 1

        # Scan <entity>/<dept>/<task>/products/vNNNN/
        dept_dirs = sorted(
            p for p in ent_dir.iterdir() if p.is_dir() and not p.name.startswith(".")
        )
        for dept_dir in dept_dirs:
            for task_dir in sorted(
                p for p in dept_dir.iterdir() if p.is_dir() and not p.name.startswith(".")
            ):
                products_dir = task_dir / "products"
                if not products_dir.is_dir():
                    continue
                product = await _ensure_task_product(db, entity, dept_dir.name, task_dir.name)
                master_label: str | None = None
                master_json = products_dir / "master.json"
                if master_json.is_file():
                    try:
                        master_label = str(
                            json.loads(master_json.read_text(encoding="utf-8")).get("version") or ""
                        )
                    except Exception:
                        master_label = None

                for ver_dir in sorted(p for p in products_dir.iterdir() if p.is_dir()):
                    m = _VERSION_RE.match(ver_dir.name)
                    if not m:
                        continue
                    v_num = int(m.group(1))
                    v_label = f"v{v_num:04d}"
                    v_rel = ver_dir.relative_to(production_root).as_posix()
                    v_res = await db.execute(
                        select(ProductVersion).where(
                            ProductVersion.product_id == product.id,
                            ProductVersion.version_number == v_num,
                        )
                    )
                    version = v_res.scalar_one_or_none()
                    if version is None:
                        version = ProductVersion(
                            product_id=product.id,
                            version_number=v_num,
                            label=v_label,
                            rel_path=v_rel,
                            comment="Reconciled from disk",
                            source_json=[],
                        )
                        db.add(version)
                        await db.flush()
                        report.versions_registered += 1

                    if (master_label and v_label == master_label) or (
                        product.master_version_id is None and v_num == 1
                    ):
                        product.master_version_id = version.id

                    items = await asyncio.to_thread(
                        _collect_version_files, ver_dir, production_root
                    )
                    seen_rel_paths: set[str] = set()
                    for item in items:
                        seen_rel_paths.add(str(item["relative_path"]))
                        await _register_file_item(db, version, item, format_registry)
                        report.files_scanned += 1

                    # Mark missing files inside this version
                    f_res = await db.execute(
                        select(FileEntry).where(FileEntry.product_version_id == version.id)
                    )
                    for existing_file in f_res.scalars().all():
                        if existing_file.relative_path not in seen_rel_paths:
                            existing_file.is_missing = True

                # Sync task.latest_version_id from highest reconciled ProductVersion
                latest_pv = (
                    await db.execute(
                        select(ProductVersion)
                        .where(ProductVersion.product_id == product.id)
                        .order_by(ProductVersion.version_number.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if latest_pv is not None:
                    parent_task = await db.get(Task, product.task_id)
                    if parent_task is not None:
                        parent_task.latest_version_id = latest_pv.id

    all_entities = (await db.execute(select(Entity))).scalars().all()
    for ent in all_entities:
        if ent.id not in seen_entity_ids and not ent.is_missing:
            ent.is_missing = True
            report.entities_missing += 1

    await db.commit()
    return report
