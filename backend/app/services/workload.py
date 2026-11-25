from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID


@dataclass(frozen=True, slots=True)
class WorkloadUserInput:
    id: UUID
    username: str
    full_name: str
    daily_capacity_hours: float
    company_id: UUID | None
    department_ids: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class WorkloadTaskInput:
    id: UUID
    task_code: str
    status: str
    department_id: UUID
    ideal_start_date: date | None
    ideal_finish_date: date | None
    bid_hours: float | None
    logged_hours: float
    artist_user_ids: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class WorkloadTimeLogInput:
    task_id: UUID
    user_id: UUID
    work_date: date
    hours: float


@dataclass(frozen=True, slots=True)
class WorkloadCellOut:
    day: date
    hours: float
    capacity_hours: float
    utilization_pct: float
    contributing_task_ids: list[UUID]


@dataclass(frozen=True, slots=True)
class WorkloadUserRowOut:
    user_id: UUID
    username: str
    full_name: str
    daily_capacity_hours: float
    cells: list[WorkloadCellOut]


@dataclass(frozen=True, slots=True)
class WorkloadResult:
    days: list[date]
    rows: list[WorkloadUserRowOut]
    unscheduled_task_ids: list[UUID]


def _daterange(start: date, end: date) -> list[date]:
    if end < start:
        return []
    days: list[date] = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=1)
    return days


def compute_workload_grid(
    users: list[WorkloadUserInput],
    tasks: list[WorkloadTaskInput],
    time_logs: list[WorkloadTimeLogInput],
    *,
    date_from: date,
    date_to: date,
    working_days: set[int],
    today: date,
) -> WorkloadResult:
    """Pure §10.4 artist capacity vs demand workload grid calculation."""
    all_days = _daterange(date_from, date_to)
    hours_map: dict[tuple[UUID, date], float] = {}
    task_contrib: dict[tuple[UUID, date], set[UUID]] = {}
    unscheduled_ids: list[UUID] = []

    # Past days strictly before today use actual logged time entries
    for log in time_logs:
        if log.work_date < today and date_from <= log.work_date <= date_to:
            key = (log.user_id, log.work_date)
            hours_map[key] = hours_map.get(key, 0.0) + max(0.0, log.hours)
            task_contrib.setdefault(key, set()).add(log.task_id)

    # Future + today working days spread remaining hours evenly across remaining working days
    for task in tasks:
        if task.status == "APP":
            continue
        if not task.artist_user_ids or task.ideal_finish_date is None:
            unscheduled_ids.append(task.id)
            continue

        remaining = max(0.0, (task.bid_hours or 0.0) - max(0.0, task.logged_hours))
        if remaining <= 0.0:
            continue

        start_spread = max(today, task.ideal_start_date or today)
        if task.ideal_finish_date < start_spread:
            continue

        eligible_days = [
            d
            for d in _daterange(start_spread, task.ideal_finish_date)
            if d.isoweekday() in working_days
        ]
        if not eligible_days:
            continue

        per_artist_total = remaining / len(task.artist_user_ids)
        per_day_per_artist = per_artist_total / len(eligible_days)
        for day in eligible_days:
            if not (date_from <= day <= date_to):
                continue
            for uid in task.artist_user_ids:
                key = (uid, day)
                hours_map[key] = hours_map.get(key, 0.0) + per_day_per_artist
                task_contrib.setdefault(key, set()).add(task.id)

    rows: list[WorkloadUserRowOut] = []
    for user in users:
        cap = user.daily_capacity_hours if user.daily_capacity_hours > 0 else 8.0
        cells: list[WorkloadCellOut] = []
        for d in all_days:
            key = (user.id, d)
            hrs = round(hours_map.get(key, 0.0), 2)
            util = round((hrs / cap) * 100.0, 1)
            cells.append(
                WorkloadCellOut(
                    day=d,
                    hours=hrs,
                    capacity_hours=cap,
                    utilization_pct=util,
                    contributing_task_ids=sorted(task_contrib.get(key, set()), key=str),
                )
            )
        rows.append(
            WorkloadUserRowOut(
                user_id=user.id,
                username=user.username,
                full_name=user.full_name,
                daily_capacity_hours=cap,
                cells=cells,
            )
        )

    return WorkloadResult(days=all_days, rows=rows, unscheduled_task_ids=unscheduled_ids)

