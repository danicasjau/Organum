"""CR04 §6/§8: working-hour schedules, per-day capacity and activation-period coverage.

The pure functions (no DB) carry the maths and are unit-tested directly; the async loaders
only fetch rows and build the inputs.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from itertools import pairwise
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.project_db import ProjectMeta, Task
from app.models.scheduling import ActivationPeriod, UserWorkException, UserWorkHours
from app.models.user import TaskAssignment, User

DAY_START_MIN = 9 * 60  # default schedules start at 09:00


Interval = tuple[int, int]  # (start_min, end_min) from local midnight


@dataclass
class WeekSchedule:
    """Weekly intervals per ISO weekday plus dated exceptions."""

    weekly: dict[int, list[Interval]] = field(default_factory=dict)
    # day -> intervals; an empty list means a day off.
    exceptions: dict[date, list[Interval]] = field(default_factory=dict)
    is_default: bool = False

    def intervals_on(self, day: date) -> list[Interval]:
        if day in self.exceptions:
            return self.exceptions[day]
        return self.weekly.get(day.isoweekday(), [])

    def hours_on(self, day: date) -> float:
        return round(sum(e - s for s, e in self.intervals_on(day)) / 60.0, 2)

    def average_daily_hours(self) -> float:
        days = [d for d, iv in self.weekly.items() if iv]
        if not days:
            return 0.0
        total = sum(sum(e - s for s, e in self.weekly[d]) for d in days) / 60.0
        return round(total / len(days), 2)


def default_schedule(working_days: Iterable[int], hours_per_day: float) -> WeekSchedule:
    """Project-calendar default: each working day from 09:00 for `hours_per_day` hours."""
    minutes = max(0, min(round(hours_per_day * 60), 1440 - DAY_START_MIN))
    weekly = {d: [(DAY_START_MIN, DAY_START_MIN + minutes)] for d in working_days if 1 <= d <= 7}
    return WeekSchedule(weekly=weekly, is_default=True)


def parse_hhmm(text: str) -> int:
    try:
        hh, mm = text.strip().split(":")
        h, m = int(hh), int(mm)
    except ValueError as exc:
        raise AppError("invalid_hours", f"'{text}' is not a time (HH:MM)", 400) from exc
    if not (0 <= h <= 24 and 0 <= m < 60) or (h == 24 and m != 0):
        raise AppError("invalid_hours", f"'{text}' is not a valid time", 400)
    return h * 60 + m


def fmt_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def validate_intervals(intervals: Sequence[Interval], label: str) -> list[Interval]:
    clean = sorted(intervals)
    for s, e in clean:
        if not (0 <= s < e <= 1440):
            raise AppError("invalid_hours", f"{label}: start must be before end", 400)
    for (_, e1), (s2, _) in pairwise(clean):
        if s2 < e1:
            raise AppError("invalid_hours", f"{label}: intervals overlap", 400)
    return clean


# ----------------------------------------------------------------- activation periods


def merge_ranges(ranges: Iterable[tuple[date, date]]) -> list[tuple[date, date]]:
    out: list[tuple[date, date]] = []
    for s, e in sorted(ranges):
        if out and s <= out[-1][1] + timedelta(days=1):
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def covers(periods: Sequence[tuple[date, date]], start: date, end: date) -> bool:
    """True when [start, end] lies fully inside the union of periods (no periods = always)."""
    if not periods:
        return True
    return any(s <= start and end <= e for s, e in merge_ranges(periods))


def active_on(periods: Sequence[tuple[date, date]], day: date) -> bool:
    return not periods or any(s <= day <= e for s, e in periods)


# ----------------------------------------------------------------- loaders


async def project_calendar(db: AsyncSession) -> tuple[set[int], float]:
    meta = (await db.execute(select(ProjectMeta))).scalars().first()
    if meta is None:
        return {1, 2, 3, 4, 5}, 8.0
    return set(meta.working_days or [1, 2, 3, 4, 5]), float(meta.hours_per_day or 8.0)


async def load_schedules(db: AsyncSession, user_ids: Sequence[UUID]) -> dict[UUID, WeekSchedule]:
    working_days, hours_per_day = await project_calendar(db)
    out: dict[UUID, WeekSchedule] = {}
    if not user_ids:
        return out
    hours = (
        (await db.execute(select(UserWorkHours).where(UserWorkHours.user_id.in_(user_ids))))
        .scalars()
        .all()
    )
    excs = (
        (await db.execute(select(UserWorkException).where(UserWorkException.user_id.in_(user_ids))))
        .scalars()
        .all()
    )
    for uid in user_ids:
        mine = [h for h in hours if h.user_id == uid]
        sched = (
            WeekSchedule(
                weekly={
                    d: sorted((h.start_min, h.end_min) for h in mine if h.weekday == d)
                    for d in range(1, 8)
                }
            )
            if mine
            else default_schedule(working_days, hours_per_day)
        )
        for ex in (e for e in excs if e.user_id == uid):
            day_list = sched.exceptions.setdefault(ex.day, [])
            if ex.start_min is not None and ex.end_min is not None:
                day_list.append((ex.start_min, ex.end_min))
        for d in sched.exceptions:
            sched.exceptions[d].sort()
        out[uid] = sched
    return out


async def load_periods(
    db: AsyncSession,
) -> dict[tuple[str, UUID], list[tuple[date, date]]]:
    rows = (await db.execute(select(ActivationPeriod))).scalars().all()
    out: dict[tuple[str, UUID], list[tuple[date, date]]] = {}
    for p in rows:
        out.setdefault((p.target_kind, p.target_id), []).append((p.start_date, p.end_date))
    return out


@dataclass
class ScheduleWarning:
    task_id: UUID
    kind: str  # user | department | company
    target_id: UUID
    target_name: str
    message: str


async def activation_warnings(
    db: AsyncSession, task_ids: Iterable[UUID] | None = None
) -> list[ScheduleWarning]:
    """Tasks scheduled (ideal dates) outside an assignee's, department's or studio's periods."""
    periods = await load_periods(db)
    if not periods:
        return []
    stmt = select(Task).where(
        Task.ideal_start_date.is_not(None), Task.ideal_finish_date.is_not(None)
    )
    if task_ids is not None:
        ids = list(task_ids)
        if not ids:
            return []
        stmt = stmt.where(Task.id.in_(ids))
    tasks = (await db.execute(stmt)).scalars().all()
    if not tasks:
        return []
    assigns = (
        await db.execute(
            select(TaskAssignment.task_id, User)
            .join(User, User.id == TaskAssignment.user_id)
            .where(TaskAssignment.task_id.in_([t.id for t in tasks]))
        )
    ).all()
    users_by_task: dict[UUID, list[User]] = {}
    for tid, user in assigns:
        users_by_task.setdefault(tid, []).append(user)

    from app.models.project_db import Department
    from app.models.user import Company

    dept_names = {d.id: d.name for d in (await db.execute(select(Department))).scalars().all()}
    comp_names = {c.id: c.name for c in (await db.execute(select(Company))).scalars().all()}

    out: list[ScheduleWarning] = []
    for t in tasks:
        start, end = t.ideal_start_date, t.ideal_finish_date
        assert start is not None and end is not None
        span = f"{start.isoformat()} → {end.isoformat()}"
        dp = periods.get(("department", t.department_id))
        if dp and not covers(dp, start, end):
            name = dept_names.get(t.department_id, "department")
            out.append(
                ScheduleWarning(
                    t.id,
                    "department",
                    t.department_id,
                    name,
                    f"{name} is not active for the whole task ({span})",
                )
            )
        seen_companies: set[UUID] = set()
        for u in users_by_task.get(t.id, []):
            up = periods.get(("user", u.id))
            if up and not covers(up, start, end):
                out.append(
                    ScheduleWarning(
                        t.id,
                        "user",
                        u.id,
                        u.full_name,
                        f"{u.full_name} is not active for the whole task ({span})",
                    )
                )
            if u.company_id and u.company_id not in seen_companies:
                seen_companies.add(u.company_id)
                cp = periods.get(("company", u.company_id))
                if cp and not covers(cp, start, end):
                    name = comp_names.get(u.company_id, "studio")
                    out.append(
                        ScheduleWarning(
                            t.id,
                            "company",
                            u.company_id,
                            name,
                            f"Studio {name} is not active for the whole task ({span})",
                        )
                    )
    return out
