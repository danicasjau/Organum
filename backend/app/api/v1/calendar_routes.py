"""CR04 §4/§10: Calendar data (one scoped round-trip) and styled XLSX exports."""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.errors import AppError
from app.core.security import get_project_auth
from app.models.project_db import Department, Entity, ProjectMeta, Task
from app.models.schedule import Milestone
from app.models.scheduling import ActivationPeriod
from app.models.user import Company, Role, TaskAssignment, User, UserDepartment
from app.schemas.api import (
    ActivationPeriodOut,
    CalendarCompanyOut,
    CalendarDepartmentOut,
    CalendarOut,
    CalendarScheduleOut,
    CalendarTaskOut,
    CalendarUserOut,
    ExportSettingsOut,
    ExportXlsxIn,
    MilestoneOut,
)
from app.services import availability as av
from app.services import schedule_service as sch
from app.services.permissions import AuthContext, visible_task_ids
from app.services.xlsx_export import build_xlsx

router = APIRouter(tags=["calendar"])


def _assert_calendar(auth: AuthContext) -> None:
    """Calendar is internal: needs views.calendar and a non-client task scope."""
    if auth.role.name == "admin":
        return
    if auth.permissions.get("task.view", "none") in ("none", "shared"):
        raise AppError("forbidden", "The Calendar is not available to clients", status_code=403)
    if not auth.has_any_scope("views.calendar"):
        raise AppError("forbidden", "Missing permission 'views.calendar'", status_code=403)


@router.get("/calendar", response_model=CalendarOut)
async def calendar_data(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CalendarOut:
    _assert_calendar(auth)
    meta = (await db.execute(select(ProjectMeta))).scalars().first()
    visible = await visible_task_ids(db, auth, "task.view")

    t_stmt = (
        select(Task, Entity)
        .join(Entity, Entity.id == Task.entity_id)
        .where(Entity.archived_at.is_(None))
        .order_by(Entity.rel_path, Task.sort_order)
    )
    if visible is not None:
        if not visible:
            t_stmt = t_stmt.where(Task.id.is_(None))
        else:
            t_stmt = t_stmt.where(Task.id.in_(visible))
    rows = (await db.execute(t_stmt)).all()
    task_ids = [t.id for t, _ in rows]
    assigns: dict[UUID, list[list[str]]] = {}
    if task_ids:
        for tid, uid, role in (
            await db.execute(
                select(
                    TaskAssignment.task_id, TaskAssignment.user_id, TaskAssignment.assignment_role
                ).where(TaskAssignment.task_id.in_(task_ids))
            )
        ).all():
            assigns.setdefault(tid, []).append([str(uid), role])
    tasks = [
        CalendarTaskOut(
            id=t.id,
            code=t.task_code,
            name=t.task_name or t.name,
            status=t.status,
            priority=t.priority,
            entity_id=e.id,
            entity_name=e.name,
            entity_path=e.rel_path,
            entity_type=e.entity_type,
            department_id=t.department_id,
            start=t.ideal_start_date,
            finish=t.ideal_finish_date,
            assignments=sorted(assigns.get(t.id, [])),
        )
        for t, e in rows
    ]

    # Scoped viewers only see the people, departments and studios involved in their tasks.
    scoped = visible is not None
    involved_users = {UUID(a[0]) for t in tasks for a in t.assignments}
    involved_depts = {t.department_id for t in tasks}

    dept_rows = (await db.execute(select(Department).order_by(Department.sort_order))).scalars()
    departments = [
        CalendarDepartmentOut(id=d.id, name=d.name, short_code=d.short_code, color=d.color)
        for d in dept_rows
        if d.is_active and (not scoped or d.id in involved_depts)
    ]
    user_rows: list[tuple[User, Role]] = [
        (u, r)
        for u, r in (
            await db.execute(
                select(User, Role)
                .join(Role, Role.id == User.role_id)
                .where(User.is_active.is_(True))
                .order_by(User.full_name)
            )
        ).all()
    ]
    if scoped:
        user_rows = [(u, r) for u, r in user_rows if u.id in involved_users or u.id == auth.user.id]
    ud: dict[UUID, list[UUID]] = {}
    for row in (await db.execute(select(UserDepartment))).scalars().all():
        ud.setdefault(row.user_id, []).append(row.department_id)
    users = [
        CalendarUserOut(
            id=u.id,
            full_name=u.full_name,
            role_name=r.name,
            role_label=r.label,
            company_id=u.company_id,
            department_ids=ud.get(u.id, []),
        )
        for u, r in user_rows
        if r.name != "client"
    ]
    user_ids = [u.id for u in users]
    involved_companies = {u.company_id for u in users if u.company_id}
    companies = [
        CalendarCompanyOut(id=c.id, name=c.name, kind=c.kind, color=c.color)
        for c in (await db.execute(select(Company).order_by(Company.name))).scalars().all()
        if c.kind != "client" and (not scoped or c.id in involved_companies)
    ]

    schedules: dict[str, CalendarScheduleOut] = {}
    for uid, s in (await av.load_schedules(db, user_ids)).items():
        schedules[str(uid)] = CalendarScheduleOut(
            weekly={str(d): [list(iv) for iv in ivs] for d, ivs in s.weekly.items() if ivs},
            exceptions={d.isoformat(): [list(iv) for iv in ivs] for d, ivs in s.exceptions.items()},
        )

    shown = {
        "department": {d.id for d in departments},
        "company": {c.id for c in companies},
        "user": set(user_ids),
    }
    activations = [
        ActivationPeriodOut(
            id=p.id,
            target_kind=p.target_kind,
            target_id=p.target_id,
            start_date=p.start_date,
            end_date=p.end_date,
            note=p.note,
        )
        for p in (await db.execute(select(ActivationPeriod))).scalars().all()
        if p.target_id in shown[p.target_kind]
    ]

    snap_tasks = {
        str(t.id): {
            "finish": t.finish.isoformat() if t.finish else None,
            "assignments": t.assignments,
        }
        for t in tasks
    }
    tmeta = await sch.task_meta(db)
    milestones = []
    for m in (await db.execute(select(Milestone).order_by(Milestone.date))).scalars().all():
        late = sch.late_tasks_for_milestone(sch.milestone_dict(m), snap_tasks, tmeta)
        milestones.append(
            MilestoneOut(
                id=m.id,
                name=m.name,
                date=m.date,
                kind=m.kind,
                target_kind=m.target_kind,
                target_id=m.target_id,
                note=m.note,
                status=m.status,
                client_visible=m.client_visible,
                late_task_ids=[UUID(t) for t in late],
            )
        )

    return CalendarOut(
        working_days=list(meta.working_days if meta and meta.working_days else [1, 2, 3, 4, 5]),
        tasks=tasks,
        departments=departments,
        companies=companies,
        users=users,
        schedules=schedules,
        activations=activations,
        milestones=milestones,
        can_edit_schedule=auth.has_any_scope("task.edit_schedule"),
    )


# ------------------------------------------------------------------ exports


@router.get("/exports/settings", response_model=ExportSettingsOut)
async def export_settings(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ExportSettingsOut:
    meta = (await db.execute(select(ProjectMeta))).scalars().first()
    _ = auth
    return ExportSettingsOut(styled_exports=bool(meta.styled_exports) if meta else True)


@router.post("/exports/xlsx")
async def export_xlsx(
    payload: ExportXlsxIn,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
) -> StreamingResponse:
    """Render exactly the rows the browser shows (already filtered) as a styled workbook."""
    if auth.permissions.get("task.view", "none") in ("none",) and auth.role.name != "admin":
        raise AppError("forbidden", "Missing permission 'task.view'", status_code=403)
    cells = sum(len(s.rows) * len(s.columns) for s in payload.sheets)
    if cells > 3_000_000:
        raise AppError("export_too_large", "Export is too large (max 3,000,000 cells)", 413)
    stream = build_xlsx(
        title=payload.title,
        sheets=[
            {"name": s.name, "columns": [c.model_dump() for c in s.columns], "rows": s.rows}
            for s in payload.sheets
        ],
        styled=payload.styled,
    )
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", payload.filename).strip("_") or "export"
    if not safe.lower().endswith(".xlsx"):
        safe += ".xlsx"

    def _iter() -> Iterator[bytes]:
        try:
            while chunk := stream.read(64 * 1024):
                yield chunk
        finally:
            stream.close()

    return StreamingResponse(
        _iter(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )
