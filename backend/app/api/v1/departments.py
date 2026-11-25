from __future__ import annotations

from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_db
from app.core.errors import ConflictError, NotFoundError
from app.core.security import get_project_auth, require
from app.models.project_db import Department, DepartmentDefaultTask, Task
from app.schemas.api import (
    DefaultTaskCreate,
    DefaultTaskOut,
    DefaultTaskUpdate,
    DepartmentCreate,
    DepartmentOut,
    DepartmentUpdate,
    ReorderRequest,
)
from app.services.naming import sanitize_folder_name
from app.services.permissions import AuthContext, visible_task_ids

router = APIRouter(prefix="/departments", tags=["departments"])


def _default_task_out(t: DepartmentDefaultTask) -> DefaultTaskOut:
    return DefaultTaskOut(
        id=t.id,
        department_id=t.department_id,
        name=t.name,
        folder_name=t.folder_name,
        sort_order=t.sort_order,
        needs_lead_review=t.needs_lead_review,
        needs_sup_review=t.needs_sup_review,
        needs_client_review=t.needs_client_review,
        default_priority=cast(Literal["normal", "high", "stopper"], t.default_priority),
        default_bid_hours=t.default_bid_hours,
        default_complexity=t.default_complexity,
    )


def _to_out(d: Department) -> DepartmentOut:
    return DepartmentOut(
        id=d.id,
        name=d.name,
        folder_name=d.folder_name,
        short_code=d.short_code,
        color=d.color,
        sort_order=d.sort_order,
        is_active=d.is_active,
        default_tasks=[
            _default_task_out(t) for t in sorted(d.default_tasks, key=lambda item: item.sort_order)
        ],
    )


@router.get("", response_model=list[DepartmentOut])
async def list_departments(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DepartmentOut]:
    res = await db.execute(
        select(Department)
        .options(selectinload(Department.default_tasks))
        .order_by(Department.sort_order, Department.name)
    )
    depts = list(res.scalars().all())
    if auth.role.name == "client":
        vis = await visible_task_ids(db, auth, "task.view")
        if not vis:
            return []
        dept_ids = set(
            (await db.execute(select(Task.department_id).where(Task.id.in_(vis)))).scalars().all()
        )
        depts = [d for d in depts if d.id in dept_ids]
    return [_to_out(d) for d in depts]


@router.post("", response_model=DepartmentOut, status_code=201)
async def create_department(
    payload: DepartmentCreate,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DepartmentOut:
    display = payload.name.strip()
    folder = sanitize_folder_name(display)
    existing = (
        await db.execute(
            select(Department).where(
                (Department.name == display) | (Department.folder_name == folder)
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Department '{display}' already exists")

    all_depts = (await db.execute(select(Department))).scalars().all()
    next_order = max((d.sort_order for d in all_depts), default=-1) + 1
    raw_sc = (payload.short_code or "".join(c for c in display.upper() if c.isalnum()))[:4]
    short_code = (raw_sc[:3] if len(raw_sc) >= 3 else (raw_sc + "XXX")[:3]) or "DPT"
    palette_tokens = [f"--series-{i}" for i in range(1, 8)]
    color = (payload.color or "").strip() or palette_tokens[next_order % len(palette_tokens)]
    dept = Department(
        name=display,
        folder_name=folder,
        short_code=short_code,
        color=color,
        sort_order=next_order,
        is_active=True,
    )
    db.add(dept)
    await db.flush()
    db.add(
        DepartmentDefaultTask(
            department_id=dept.id,
            name="main",
            folder_name="main",
            sort_order=0,
        )
    )
    await db.commit()
    res = await db.execute(
        select(Department)
        .where(Department.id == dept.id)
        .options(selectinload(Department.default_tasks))
    )
    return _to_out(res.scalar_one())


@router.patch("/{dept_id}", response_model=DepartmentOut)
async def update_department(
    dept_id: UUID,
    payload: DepartmentUpdate,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DepartmentOut:
    res = await db.execute(
        select(Department)
        .where(Department.id == dept_id)
        .options(selectinload(Department.default_tasks))
    )
    dept = res.scalar_one_or_none()
    if dept is None:
        raise NotFoundError("department", str(dept_id))
    if payload.name is not None:
        display = payload.name.strip()
        folder = sanitize_folder_name(display)
        dept.name = display
        dept.folder_name = folder
    if payload.short_code is not None:
        dept.short_code = payload.short_code.strip().upper()[:8] or dept.short_code
    if payload.color is not None:
        dept.color = payload.color.strip() or dept.color
    if payload.is_active is not None:
        dept.is_active = payload.is_active
    if payload.sort_order is not None:
        dept.sort_order = payload.sort_order
    await db.commit()
    await db.refresh(dept)
    return _to_out(dept)


@router.delete("/{dept_id}", status_code=204)
async def delete_department(
    dept_id: UUID,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    dept = await db.get(Department, dept_id)
    if dept is None:
        raise NotFoundError("department", str(dept_id))
    dept.is_active = False
    await db.commit()
    return Response(status_code=204)


@router.put("/reorder", response_model=list[DepartmentOut])
async def reorder_departments(
    payload: ReorderRequest,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DepartmentOut]:
    depts = (
        (await db.execute(select(Department).options(selectinload(Department.default_tasks))))
        .scalars()
        .all()
    )
    by_id = {d.id: d for d in depts}
    for idx, did in enumerate(payload.ids):
        if did in by_id:
            by_id[did].sort_order = idx
    await db.commit()
    depts_sorted = sorted(depts, key=lambda d: (d.sort_order, d.name))
    return [_to_out(d) for d in depts_sorted]


@router.post("/{dept_id}/default-tasks", response_model=DefaultTaskOut, status_code=201)
async def add_default_task(
    dept_id: UUID,
    payload: DefaultTaskCreate,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DefaultTaskOut:
    dept = await db.get(Department, dept_id)
    if dept is None:
        raise NotFoundError("department", str(dept_id))
    display = payload.name.strip()
    folder = sanitize_folder_name(display)
    existing = (
        await db.execute(
            select(DepartmentDefaultTask).where(
                DepartmentDefaultTask.department_id == dept_id,
                DepartmentDefaultTask.name == display,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Default task '{display}' already exists")
    siblings = (
        (
            await db.execute(
                select(DepartmentDefaultTask).where(DepartmentDefaultTask.department_id == dept_id)
            )
        )
        .scalars()
        .all()
    )
    task = DepartmentDefaultTask(
        department_id=dept_id,
        name=display,
        folder_name=folder,
        sort_order=max((s.sort_order for s in siblings), default=-1) + 1,
        needs_lead_review=payload.needs_lead_review,
        needs_sup_review=payload.needs_sup_review,
        needs_client_review=payload.needs_client_review,
        default_priority=payload.default_priority,
        default_bid_hours=payload.default_bid_hours,
        default_complexity=payload.default_complexity,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _default_task_out(task)


@router.patch("/default-tasks/{task_id}", response_model=DefaultTaskOut)
async def update_default_task(
    task_id: UUID,
    payload: DefaultTaskUpdate,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DefaultTaskOut:
    task = await db.get(DepartmentDefaultTask, task_id)
    if task is None:
        raise NotFoundError("default_task", str(task_id))
    if payload.name is not None:
        display = payload.name.strip()
        task.name = display
        task.folder_name = sanitize_folder_name(display)
    if payload.sort_order is not None:
        task.sort_order = payload.sort_order
    if payload.needs_lead_review is not None:
        task.needs_lead_review = payload.needs_lead_review
    if payload.needs_sup_review is not None:
        task.needs_sup_review = payload.needs_sup_review
    if payload.needs_client_review is not None:
        task.needs_client_review = payload.needs_client_review
    if payload.default_priority is not None:
        task.default_priority = payload.default_priority
    if payload.default_bid_hours is not None:
        task.default_bid_hours = payload.default_bid_hours
    if payload.default_complexity is not None:
        task.default_complexity = payload.default_complexity
    await db.commit()
    await db.refresh(task)
    return _default_task_out(task)


@router.delete("/default-tasks/{task_id}", status_code=204)
async def delete_default_task(
    task_id: UUID,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    task = await db.get(DepartmentDefaultTask, task_id)
    if task is None:
        raise NotFoundError("default_task", str(task_id))
    await db.delete(task)
    await db.commit()
    return Response(status_code=204)


@router.put("/{dept_id}/default-tasks/reorder", response_model=list[DefaultTaskOut])
async def reorder_default_tasks(
    dept_id: UUID,
    payload: ReorderRequest,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DefaultTaskOut]:
    tasks = (
        (
            await db.execute(
                select(DepartmentDefaultTask).where(DepartmentDefaultTask.department_id == dept_id)
            )
        )
        .scalars()
        .all()
    )
    by_id = {t.id: t for t in tasks}
    for idx, tid in enumerate(payload.ids):
        if tid in by_id:
            by_id[tid].sort_order = idx
    await db.commit()
    ordered = sorted(tasks, key=lambda t: (t.sort_order, t.name))
    return [_default_task_out(t) for t in ordered]
