"""CR04 §6/§8/§11: working hours, activation periods, studio comments and member links."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.errors import AppError, NotFoundError
from app.core.security import client_ip_from_request, get_project_auth
from app.models.project_db import Department
from app.models.scheduling import (
    ActivationPeriod,
    CompanyComment,
    CompanyMember,
    UserWorkException,
    UserWorkHours,
)
from app.models.user import Company, User
from app.schemas.api import (
    ActivationPeriodIn,
    ActivationPeriodOut,
    ActivationPeriodUpdate,
    CompanyCommentIn,
    CompanyCommentOut,
    CompanyMembersOut,
    CompanyMembersPut,
    ScheduleWarningOut,
    WorkDay,
    WorkException,
    WorkHoursOut,
    WorkHoursPut,
    WorkInterval,
)
from app.services import availability as av
from app.services.auth_service import write_audit
from app.services.permissions import AuthContext, visible_task_ids

router = APIRouter(tags=["people"])


# ------------------------------------------------------------------- permission helpers


def _is_client_like(auth: AuthContext) -> bool:
    return auth.role.name != "admin" and auth.permissions.get("task.view", "none") in (
        "none",
        "shared",
    )


def _assert_writable(auth: AuthContext) -> None:
    if auth.project_status == "archived" and auth.role.name != "admin":
        raise AppError("forbidden", "Project is archived and read-only", status_code=403)


def _can_view_people(auth: AuthContext) -> bool:
    return auth.has_any_scope("user.view") or auth.has_any_scope("user.manage")


def _assert_can_view_people(auth: AuthContext) -> None:
    if not _can_view_people(auth):
        raise AppError("forbidden", "Missing permission 'user.view'", status_code=403)


def _assert_can_manage_people(auth: AuthContext) -> None:
    _assert_writable(auth)
    if not auth.has_any_scope("user.manage"):
        raise AppError("forbidden", "Missing permission 'user.manage'", status_code=403)


def _assert_can_edit_activation(auth: AuthContext) -> None:
    _assert_writable(auth)
    if not (auth.has_any_scope("user.manage") or auth.has_any_scope("task.edit_schedule")):
        raise AppError(
            "forbidden",
            "Editing activation periods needs 'user.manage' or 'task.edit_schedule'",
            status_code=403,
        )


# ------------------------------------------------------------------- working hours


def _intervals(items: list[WorkInterval], label: str) -> list[av.Interval]:
    return av.validate_intervals(
        [(av.parse_hhmm(i.start), av.parse_hhmm(i.end)) for i in items], label
    )


def _hours_out(user: User, sched: av.WeekSchedule) -> WorkHoursOut:
    weekly = [
        WorkDay(
            weekday=d,
            intervals=[
                WorkInterval(start=av.fmt_hhmm(s), end=av.fmt_hhmm(e))
                for s, e in sched.weekly.get(d, [])
            ],
        )
        for d in range(1, 8)
    ]
    exceptions = [
        WorkException(
            day=d,
            off=not iv,
            intervals=[WorkInterval(start=av.fmt_hhmm(s), end=av.fmt_hhmm(e)) for s, e in iv],
        )
        for d, iv in sorted(sched.exceptions.items())
    ]
    weekly_hours = round(sum(e - s for iv in sched.weekly.values() for s, e in iv) / 60.0, 2)
    return WorkHoursOut(
        user_id=user.id,
        timezone=user.timezone or "UTC",
        is_default=sched.is_default,
        weekly=weekly,
        exceptions=exceptions,
        daily_capacity_hours=user.daily_capacity_hours,
        weekly_hours=weekly_hours,
    )


async def _load_user(db: AsyncSession, user_id: UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("user", str(user_id))
    return user


@router.get("/users/{user_id}/work-hours", response_model=WorkHoursOut)
async def get_work_hours(
    user_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WorkHoursOut:
    if user_id != auth.user.id:
        _assert_can_view_people(auth)
    user = await _load_user(db, user_id)
    sched = (await av.load_schedules(db, [user.id]))[user.id]
    out = _hours_out(user, sched)
    # Exceptions carry notes: reload them for the response.
    notes = {
        e.day: e.note
        for e in (
            await db.execute(select(UserWorkException).where(UserWorkException.user_id == user.id))
        )
        .scalars()
        .all()
    }
    for ex in out.exceptions:
        ex.note = notes.get(ex.day, "")
    return out


@router.put("/users/{user_id}/work-hours", response_model=WorkHoursOut)
async def put_work_hours(
    user_id: UUID,
    payload: WorkHoursPut,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WorkHoursOut:
    if user_id != auth.user.id:
        _assert_can_manage_people(auth)
    _assert_writable(auth)
    user = await _load_user(db, user_id)
    if payload.timezone is not None:
        try:
            ZoneInfo(payload.timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise AppError(
                "invalid_timezone", f"Unknown timezone '{payload.timezone}'", 400
            ) from exc
        user.timezone = payload.timezone

    weekly: dict[int, list[av.Interval]] = {}
    for day in payload.weekly:
        if day.weekday in weekly:
            raise AppError("invalid_hours", f"Weekday {day.weekday} listed twice", 400)
        weekly[day.weekday] = _intervals(day.intervals, f"Weekday {day.weekday}")
    exceptions: dict[date, tuple[list[av.Interval], str]] = {}
    for ex in payload.exceptions:
        if ex.day in exceptions:
            raise AppError("invalid_hours", f"{ex.day} listed twice", 400)
        ivs = [] if ex.off else _intervals(ex.intervals, ex.day.isoformat())
        if not ex.off and not ivs:
            raise AppError("invalid_hours", f"{ex.day}: add hours or mark it as a day off", 400)
        exceptions[ex.day] = (ivs, ex.note.strip()[:256])

    await db.execute(delete(UserWorkHours).where(UserWorkHours.user_id == user.id))
    await db.execute(delete(UserWorkException).where(UserWorkException.user_id == user.id))
    if not payload.use_project_default:
        for wd, ivs in weekly.items():
            for s, e in ivs:
                db.add(UserWorkHours(user_id=user.id, weekday=wd, start_min=s, end_min=e))
    for d, (ivs, note) in exceptions.items():
        if not ivs:
            db.add(UserWorkException(user_id=user.id, day=d, note=note))
        for s, e in ivs:
            db.add(UserWorkException(user_id=user.id, day=d, start_min=s, end_min=e, note=note))
    await db.flush()

    sched = (await av.load_schedules(db, [user.id]))[user.id]
    # CR04 §8: daily capacity is derived from the working hours.
    user.daily_capacity_hours = sched.average_daily_hours() or user.daily_capacity_hours
    await write_audit(
        db,
        user_id=auth.user.id,
        action="user.work_hours.update",
        target_type="user",
        target_id=str(user.id),
        ip=client_ip_from_request(request),
        detail={"default": payload.use_project_default, "exceptions": len(exceptions)},
    )
    await db.commit()
    return await get_work_hours(user.id, auth, db)


# ------------------------------------------------------------------- activation periods


def _period_out(p: ActivationPeriod) -> ActivationPeriodOut:
    return ActivationPeriodOut(
        id=p.id,
        target_kind=p.target_kind,
        target_id=p.target_id,
        start_date=p.start_date,
        end_date=p.end_date,
        note=p.note,
    )


@router.get("/activation-periods", response_model=list[ActivationPeriodOut])
async def list_activation_periods(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    target_kind: str | None = None,
    target_id: UUID | None = None,
) -> list[ActivationPeriodOut]:
    if _is_client_like(auth):
        raise AppError("forbidden", "Activation periods are internal", status_code=403)
    stmt = select(ActivationPeriod).order_by(ActivationPeriod.start_date)
    col = {
        "department": ActivationPeriod.department_id,
        "company": ActivationPeriod.company_id,
        "user": ActivationPeriod.user_id,
    }.get(target_kind or "")
    if target_kind and col is None:
        raise AppError("invalid_request", f"Unknown target kind '{target_kind}'", 400)
    if col is not None:
        stmt = stmt.where(col.is_not(None))
        if target_id is not None:
            stmt = stmt.where(col == target_id)
    return [_period_out(p) for p in (await db.execute(stmt)).scalars().all()]


async def _assert_target_exists(db: AsyncSession, kind: str, target_id: UUID) -> None:
    model = {"department": Department, "company": Company, "user": User}[kind]
    if await db.get(model, target_id) is None:
        raise NotFoundError(kind, str(target_id))


@router.post("/activation-periods", response_model=ActivationPeriodOut, status_code=201)
async def create_activation_period(
    payload: ActivationPeriodIn,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivationPeriodOut:
    _assert_can_edit_activation(auth)
    if payload.end_date < payload.start_date:
        raise AppError("invalid_dates", "The period must end on or after its start", 400)
    await _assert_target_exists(db, payload.target_kind, payload.target_id)
    period = ActivationPeriod(
        id=uuid.uuid4(),
        start_date=payload.start_date,
        end_date=payload.end_date,
        note=payload.note.strip(),
        created_by=auth.user.id,
        **{f"{payload.target_kind}_id": payload.target_id},
    )
    db.add(period)
    await write_audit(
        db,
        user_id=auth.user.id,
        action="activation.create",
        target_type=payload.target_kind,
        target_id=str(payload.target_id),
        ip=client_ip_from_request(request),
        detail={"start": str(payload.start_date), "end": str(payload.end_date)},
    )
    await db.commit()
    return _period_out(period)


@router.patch("/activation-periods/{period_id}", response_model=ActivationPeriodOut)
async def update_activation_period(
    period_id: UUID,
    payload: ActivationPeriodUpdate,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivationPeriodOut:
    _assert_can_edit_activation(auth)
    period = await db.get(ActivationPeriod, period_id)
    if period is None:
        raise NotFoundError("activation_period", str(period_id))
    start = payload.start_date or period.start_date
    end = payload.end_date or period.end_date
    if end < start:
        raise AppError("invalid_dates", "The period must end on or after its start", 400)
    before = {"start": str(period.start_date), "end": str(period.end_date)}
    period.start_date, period.end_date = start, end
    if payload.note is not None:
        period.note = payload.note.strip()
    await write_audit(
        db,
        user_id=auth.user.id,
        action="activation.update",
        target_type=period.target_kind,
        target_id=str(period.target_id),
        ip=client_ip_from_request(request),
        detail={"before": before, "after": {"start": str(start), "end": str(end)}},
    )
    await db.commit()
    return _period_out(period)


@router.delete("/activation-periods/{period_id}", status_code=204)
async def delete_activation_period(
    period_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    _assert_can_edit_activation(auth)
    period = await db.get(ActivationPeriod, period_id)
    if period is None:
        raise NotFoundError("activation_period", str(period_id))
    await write_audit(
        db,
        user_id=auth.user.id,
        action="activation.delete",
        target_type=period.target_kind,
        target_id=str(period.target_id),
        ip=client_ip_from_request(request),
        detail={"start": str(period.start_date), "end": str(period.end_date)},
    )
    await db.delete(period)
    await db.commit()
    return Response(status_code=204)


@router.get("/schedule/warnings", response_model=list[ScheduleWarningOut])
async def list_schedule_warnings(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    task_id: UUID | None = None,
) -> list[ScheduleWarningOut]:
    """Tasks scheduled outside activation periods (warnings, never blocking)."""
    if _is_client_like(auth):
        raise AppError("forbidden", "Schedule warnings are internal", status_code=403)
    visible = await visible_task_ids(db, auth, "task.view")
    ids: set[UUID] | None = visible
    if task_id is not None:
        if visible is not None and task_id not in visible:
            return []
        ids = {task_id}
    warnings = await av.activation_warnings(db, ids)
    return [
        ScheduleWarningOut(
            task_id=w.task_id,
            kind=w.kind,
            target_id=w.target_id,
            target_name=w.target_name,
            message=w.message,
        )
        for w in warnings
    ]


# ------------------------------------------------------------------- studios: comments, members


async def _load_company(db: AsyncSession, company_id: UUID) -> Company:
    comp = await db.get(Company, company_id)
    if comp is None:
        raise NotFoundError("company", str(company_id))
    return comp


@router.get("/companies/{company_id}/comments", response_model=list[CompanyCommentOut])
async def list_company_comments(
    company_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[CompanyCommentOut]:
    _assert_can_view_people(auth)
    await _load_company(db, company_id)
    rows = (
        await db.execute(
            select(CompanyComment, User.full_name)
            .outerjoin(User, User.id == CompanyComment.author_id)
            .where(CompanyComment.company_id == company_id)
            .order_by(CompanyComment.created_at.desc())
        )
    ).all()
    return [
        CompanyCommentOut(
            id=c.id,
            company_id=c.company_id,
            author_id=c.author_id,
            author_name=name,
            body=c.body,
            created_at=c.created_at,
        )
        for c, name in rows
    ]


@router.post("/companies/{company_id}/comments", response_model=CompanyCommentOut, status_code=201)
async def add_company_comment(
    company_id: UUID,
    payload: CompanyCommentIn,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompanyCommentOut:
    _assert_can_view_people(auth)
    _assert_writable(auth)
    await _load_company(db, company_id)
    c = CompanyComment(
        id=uuid.uuid4(), company_id=company_id, author_id=auth.user.id, body=payload.body.strip()
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return CompanyCommentOut(
        id=c.id,
        company_id=company_id,
        author_id=auth.user.id,
        author_name=auth.user.full_name,
        body=c.body,
        created_at=c.created_at,
    )


@router.delete("/companies/{company_id}/comments/{comment_id}", status_code=204)
async def delete_company_comment(
    company_id: UUID,
    comment_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    _assert_writable(auth)
    c = await db.get(CompanyComment, comment_id)
    if c is None or c.company_id != company_id:
        raise NotFoundError("company_comment", str(comment_id))
    if c.author_id != auth.user.id and not auth.has_any_scope("user.manage"):
        raise AppError("forbidden", "Only the author or a user manager can delete", 403)
    await db.delete(c)
    await db.commit()
    return Response(status_code=204)


async def _members_out(db: AsyncSession, company_id: UUID) -> CompanyMembersOut:
    primary = (
        (await db.execute(select(User.id).where(User.company_id == company_id))).scalars().all()
    )
    linked = (
        (
            await db.execute(
                select(CompanyMember.user_id).where(CompanyMember.company_id == company_id)
            )
        )
        .scalars()
        .all()
    )
    return CompanyMembersOut(
        company_id=company_id, primary_user_ids=list(primary), linked_user_ids=list(linked)
    )


@router.get("/companies/{company_id}/members", response_model=CompanyMembersOut)
async def get_company_members(
    company_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompanyMembersOut:
    _assert_can_view_people(auth)
    await _load_company(db, company_id)
    return await _members_out(db, company_id)


@router.put("/companies/{company_id}/members", response_model=CompanyMembersOut)
async def put_company_members(
    company_id: UUID,
    payload: CompanyMembersPut,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompanyMembersOut:
    """Replace the *linked* people of a studio/group (primary company is set on the user)."""
    _assert_can_manage_people(auth)
    await _load_company(db, company_id)
    wanted = set(payload.user_ids)
    if wanted:
        found = set((await db.execute(select(User.id).where(User.id.in_(wanted)))).scalars().all())
        missing = wanted - found
        if missing:
            raise NotFoundError("user", ", ".join(sorted(str(m) for m in missing)))
    # Primary members are already members; links are only for other people.
    primary = set(
        (await db.execute(select(User.id).where(User.company_id == company_id))).scalars().all()
    )
    await db.execute(delete(CompanyMember).where(CompanyMember.company_id == company_id))
    for uid in sorted(wanted - primary, key=str):
        db.add(CompanyMember(company_id=company_id, user_id=uid))
    await write_audit(
        db,
        user_id=auth.user.id,
        action="company.members.update",
        target_type="company",
        target_id=str(company_id),
        ip=client_ip_from_request(request),
        detail={"linked": [str(u) for u in sorted(wanted - primary, key=str)]},
    )
    await db.commit()
    return await _members_out(db, company_id)


@router.get("/users/{user_id}/companies", response_model=list[UUID])
async def get_user_linked_companies(
    user_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UUID]:
    if user_id != auth.user.id:
        _assert_can_view_people(auth)
    user = await _load_user(db, user_id)
    linked = (
        (await db.execute(select(CompanyMember.company_id).where(CompanyMember.user_id == user_id)))
        .scalars()
        .all()
    )
    ids = list(linked)
    if user.company_id and user.company_id not in ids:
        ids.insert(0, user.company_id)
    return ids
