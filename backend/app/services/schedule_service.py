"""CR04 §5/§7: schedule snapshots, per-user drafts, versions and milestones.

A *snapshot* is a plain dict describing everything schedule-related:

    {"tasks":       {task_id: {"start", "finish", "code", "assignments": [[user_id, role], ...]}},
     "milestones":  {id: {"name", "date", "kind", "target_kind", "target_id", "note",
                          "status", "client_visible"}},
     "activations": {id: {"target_kind", "target_id", "start", "end", "note"}}}

Drafts are lists of changes applied on top of the live snapshot (`overlay`). Saving applies
the changes to the database in one transaction and stores the resulting snapshot as an
immutable numbered version. Pure functions here carry the logic and are unit-tested.
"""

from __future__ import annotations

import copy
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError
from app.models.project_db import Department, Entity, Task
from app.models.schedule import (
    MILESTONE_TARGETS,
    Milestone,
    ScheduleDraft,
    ScheduleDraftChange,
    ScheduleVersion,
)
from app.models.scheduling import ActivationPeriod
from app.models.tasks import TaskEvent
from app.models.user import Company, TaskAssignment, User
from app.services.permissions import AuthContext, assert_can, visible_task_ids

Snapshot = dict[str, dict[str, dict[str, Any]]]
KINDS = ("task", "milestone", "activation")
SECTION = {"task": "tasks", "milestone": "milestones", "activation": "activations"}
TASK_FIELDS = ("start", "finish")
MILESTONE_FIELDS = (
    "name",
    "date",
    "kind",
    "target_kind",
    "target_id",
    "note",
    "status",
    "client_visible",
)
ACTIVATION_FIELDS = ("target_kind", "target_id", "start", "end", "note")


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def empty_snapshot() -> Snapshot:
    return {"tasks": {}, "milestones": {}, "activations": {}}


# ------------------------------------------------------------------ pure: overlay & diff


@dataclass
class Change:
    kind: str
    op: str
    target_id: str
    payload: dict[str, Any]


def overlay(live: Snapshot, changes: Iterable[Change]) -> Snapshot:
    """Return a new snapshot with draft changes applied on top of `live`."""
    out: Snapshot = copy.deepcopy(live)
    for ch in changes:
        section = out[SECTION[ch.kind]]
        if ch.kind == "task":
            item = section.get(ch.target_id)
            if item is None:
                continue  # task deleted meanwhile: nothing to show
            if ch.op == "assign":
                item["assignments"] = sorted([list(a) for a in ch.payload.get("assignments", [])])
            else:
                for f in TASK_FIELDS:
                    if f in ch.payload:
                        item[f] = ch.payload[f]
            continue
        if ch.op == "delete":
            section.pop(ch.target_id, None)
        elif ch.op == "create":
            section[ch.target_id] = dict(ch.payload)
        elif ch.target_id in section:
            section[ch.target_id].update(ch.payload)
    return out


@dataclass
class DiffItem:
    kind: str
    target_id: str
    op: str  # added | removed | changed
    label: str
    fields: dict[str, tuple[Any, Any]]

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "target_id": self.target_id,
            "op": self.op,
            "label": self.label,
            "fields": {k: [before, after] for k, (before, after) in self.fields.items()},
        }


def _label(kind: str, item: dict[str, Any] | None, target_id: str) -> str:
    if not item:
        return target_id[:8]
    if kind == "task":
        return str(item.get("code") or target_id[:8])
    if kind == "milestone":
        return str(item.get("name") or target_id[:8])
    return f"{item.get('target_kind', '?')} {item.get('start', '')}→{item.get('end', '')}"


def diff(a: Snapshot, b: Snapshot) -> list[DiffItem]:
    """Differences going from snapshot `a` to snapshot `b`."""
    out: list[DiffItem] = []
    for kind in KINDS:
        sa, sb = a.get(SECTION[kind], {}), b.get(SECTION[kind], {})
        for tid in sorted(set(sa) | set(sb)):
            ia, ib = sa.get(tid), sb.get(tid)
            if ia is None and ib is not None:
                if kind == "task":
                    continue  # tasks are created elsewhere, never by the schedule
                out.append(DiffItem(kind, tid, "added", _label(kind, ib, tid), {}))
            elif ib is None and ia is not None:
                if kind == "task":
                    continue
                out.append(DiffItem(kind, tid, "removed", _label(kind, ia, tid), {}))
            elif ia is not None and ib is not None:
                fields = {
                    k: (ia.get(k), ib.get(k))
                    for k in sorted(set(ia) | set(ib))
                    if k != "code" and ia.get(k) != ib.get(k)
                }
                if fields:
                    out.append(DiffItem(kind, tid, "changed", _label(kind, ib, tid), fields))
    return out


def summarize(items: Sequence[DiffItem]) -> dict[str, int]:
    summary = {"tasks": 0, "milestones": 0, "activations": 0, "total": len(items)}
    for it in items:
        summary[SECTION[it.kind]] += 1
    return summary


def changes_to_reach(live: Snapshot, target: Snapshot) -> list[Change]:
    """Draft changes that turn `live` into `target` (used by Jump to version)."""
    changes: list[Change] = []
    for item in diff(live, target):
        tgt = target[SECTION[item.kind]].get(item.target_id)
        if item.kind == "task":
            dates = {k: v[1] for k, v in item.fields.items() if k in TASK_FIELDS}
            if dates:
                changes.append(Change("task", "update", item.target_id, dates))
            if "assignments" in item.fields and tgt is not None:
                changes.append(
                    Change("task", "assign", item.target_id, {"assignments": tgt["assignments"]})
                )
            continue
        if item.op == "added" and tgt is not None:
            changes.append(Change(item.kind, "create", item.target_id, dict(tgt)))
        elif item.op == "removed":
            changes.append(Change(item.kind, "delete", item.target_id, {}))
        else:
            changes.append(
                Change(
                    item.kind, "update", item.target_id, {k: v[1] for k, v in item.fields.items()}
                )
            )
    return changes


def merge_change(existing: Change | None, new: Change) -> Change | None:
    """Fold a new change into an existing one for the same target (None = drop both)."""
    if existing is None:
        return new
    if new.op == "assign" or existing.op == "assign":
        return new  # assignment changes replace each other
    if existing.op == "create":
        if new.op == "delete":
            return None
        return Change(
            existing.kind, "create", existing.target_id, {**existing.payload, **new.payload}
        )
    if new.op == "delete":
        return Change(existing.kind, "delete", existing.target_id, {})
    return Change(existing.kind, "update", existing.target_id, {**existing.payload, **new.payload})


def find_conflicts(
    live: Snapshot, changes: Sequence[tuple[Change, dict[str, Any] | None, str]]
) -> list[dict[str, Any]]:
    """Changes whose touched fields changed live since the draft first touched them."""
    conflicts: list[dict[str, Any]] = []
    for ch, base, label in changes:
        if ch.op == "create" or base is None:
            continue
        current = live[SECTION[ch.kind]].get(ch.target_id)
        if current is None:
            conflicts.append(
                {
                    "kind": ch.kind,
                    "target_id": ch.target_id,
                    "label": label,
                    "message": "Deleted in live data since your draft started",
                }
            )
            continue
        fields = (
            ["assignments"]
            if ch.op == "assign"
            else list(base)
            if ch.op == "delete"
            else list(ch.payload)
        )
        changed = [f for f in fields if f in base and current.get(f) != base.get(f)]
        if changed:
            conflicts.append(
                {
                    "kind": ch.kind,
                    "target_id": ch.target_id,
                    "label": label,
                    "message": "Changed in live data since your draft started: "
                    + ", ".join(changed),
                    "fields": {f: [base.get(f), current.get(f)] for f in changed},
                }
            )
    return conflicts


def late_tasks_for_milestone(
    milestone: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    task_meta: dict[str, dict[str, Any]],
) -> list[str]:
    """Task ids of the milestone's target that finish after the milestone date."""
    mdate = milestone.get("date")
    if not mdate:
        return []
    kind, tid = milestone.get("target_kind", "none"), milestone.get("target_id")
    late: list[str] = []
    for task_id, t in tasks.items():
        finish = t.get("finish")
        if not finish or finish <= mdate:
            continue
        meta = task_meta.get(task_id, {})
        match = (
            kind == "none"
            or (kind == "task" and task_id == tid)
            or (kind == "department" and meta.get("department_id") == tid)
            or (kind == "entity" and meta.get("entity_id") == tid)
            or (kind == "user" and any(a[0] == tid for a in t.get("assignments", [])))
            or (kind == "company" and tid in meta.get("company_ids", []))
        )
        if match:
            late.append(task_id)
    return sorted(late)


# ------------------------------------------------------------------ DB: live snapshot


def milestone_dict(m: Milestone) -> dict[str, Any]:
    return {
        "name": m.name,
        "date": _iso(m.date),
        "kind": m.kind,
        "target_kind": m.target_kind,
        "target_id": str(m.target_id) if m.target_id else None,
        "note": m.note,
        "status": m.status,
        "client_visible": m.client_visible,
    }


def activation_dict(p: ActivationPeriod) -> dict[str, Any]:
    return {
        "target_kind": p.target_kind,
        "target_id": str(p.target_id),
        "start": _iso(p.start_date),
        "end": _iso(p.end_date),
        "note": p.note,
    }


async def live_snapshot(db: AsyncSession) -> Snapshot:
    snap = empty_snapshot()
    tasks = (
        await db.execute(
            select(Task.id, Task.task_code, Task.ideal_start_date, Task.ideal_finish_date)
        )
    ).all()
    assigns: dict[UUID, list[list[str]]] = {}
    for tid, uid, role in (
        await db.execute(
            select(TaskAssignment.task_id, TaskAssignment.user_id, TaskAssignment.assignment_role)
        )
    ).all():
        assigns.setdefault(tid, []).append([str(uid), role])
    for tid, code, start, finish in tasks:
        snap["tasks"][str(tid)] = {
            "code": code,
            "start": _iso(start),
            "finish": _iso(finish),
            "assignments": sorted(assigns.get(tid, [])),
        }
    for m in (await db.execute(select(Milestone))).scalars().all():
        snap["milestones"][str(m.id)] = milestone_dict(m)
    for p in (await db.execute(select(ActivationPeriod))).scalars().all():
        snap["activations"][str(p.id)] = activation_dict(p)
    return snap


async def task_meta(db: AsyncSession) -> dict[str, dict[str, Any]]:
    """Per task: department, entity and assignees' companies (for milestone targets)."""
    meta: dict[str, dict[str, Any]] = {}
    for tid, dept, ent in (
        await db.execute(select(Task.id, Task.department_id, Task.entity_id))
    ).all():
        meta[str(tid)] = {"department_id": str(dept), "entity_id": str(ent), "company_ids": []}
    for tid, cid in (
        await db.execute(
            select(TaskAssignment.task_id, User.company_id)
            .join(User, User.id == TaskAssignment.user_id)
            .where(User.company_id.is_not(None))
        )
    ).all():
        if str(tid) in meta:
            meta[str(tid)]["company_ids"].append(str(cid))
    return meta


# ------------------------------------------------------------------ validation & permissions


def can_version(auth: AuthContext) -> bool:
    return auth.has_any_scope("schedule.version")


def can_edit_milestones(auth: AuthContext) -> bool:
    return auth.has_any_scope("milestone.edit")


def _parse_date(value: Any, label: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise AppError("invalid_change", f"{label}: '{value}' is not a date", 400) from exc


async def validate_change(db: AsyncSession, auth: AuthContext, ch: Change) -> str:
    """Check payload shape and permission; returns a human label for the change."""
    if ch.kind not in KINDS:
        raise AppError("invalid_change", f"Unknown change kind '{ch.kind}'", 400)
    try:
        target = UUID(ch.target_id)
    except ValueError as exc:
        raise AppError("invalid_change", "target_id must be a uuid", 400) from exc

    if ch.kind == "task":
        task = await db.get(Task, target)
        if task is None:
            raise NotFoundError("task", ch.target_id)
        if ch.op == "assign":
            await assert_can(db, auth, "task.assign", task, message="Missing 'task.assign'")
            for pair in ch.payload.get("assignments", []):
                if not (isinstance(pair, list) and len(pair) == 2):
                    raise AppError("invalid_change", "assignments are [user_id, role] pairs", 400)
                if pair[1] not in ("artist", "lead", "supervisor"):
                    raise AppError("invalid_change", f"Unknown role '{pair[1]}'", 400)
                if await db.get(User, UUID(str(pair[0]))) is None:
                    raise NotFoundError("user", str(pair[0]))
            return f"{task.task_code}: assignments"
        if ch.op != "update":
            raise AppError("invalid_change", "Tasks can only be updated or assigned", 400)
        await assert_can(
            db, auth, "task.edit_schedule", task, message="Missing 'task.edit_schedule'"
        )
        unknown = set(ch.payload) - set(TASK_FIELDS)
        if unknown:
            raise AppError("invalid_change", f"Unknown task fields: {sorted(unknown)}", 400)
        start = ch.payload.get("start", _iso(task.ideal_start_date))
        finish = ch.payload.get("finish", _iso(task.ideal_finish_date))
        if start is not None:
            _parse_date(start, task.task_code)
        if finish is not None:
            _parse_date(finish, task.task_code)
        if start and finish and finish < start:
            raise AppError("invalid_change", f"{task.task_code}: finish before start", 400)
        return f"{task.task_code}: {start} → {finish}"

    if ch.kind == "milestone":
        if not can_edit_milestones(auth):
            raise AppError("forbidden", "Missing 'milestone.edit'", 403)
        if ch.op not in ("create", "update", "delete"):
            raise AppError("invalid_change", f"Bad milestone op '{ch.op}'", 400)
        if ch.op != "delete":
            unknown = set(ch.payload) - set(MILESTONE_FIELDS)
            if unknown:
                raise AppError("invalid_change", f"Unknown fields: {sorted(unknown)}", 400)
            p = ch.payload
            if ch.op == "create" and not str(p.get("name", "")).strip():
                raise AppError("invalid_change", "A milestone needs a name", 400)
            if ch.op == "create" or "date" in p:
                _parse_date(p.get("date"), "Milestone date")
            if p.get("kind", "milestone") not in ("deliver", "milestone"):
                raise AppError("invalid_change", "kind must be deliver or milestone", 400)
            if p.get("status", "open") not in ("open", "done"):
                raise AppError("invalid_change", "status must be open or done", 400)
            tk = p.get("target_kind", "none")
            if tk != "none" and tk not in MILESTONE_TARGETS:
                raise AppError("invalid_change", f"Unknown target kind '{tk}'", 400)
            if tk != "none":
                model = {
                    "department": Department,
                    "user": User,
                    "entity": Entity,
                    "task": Task,
                    "company": Company,
                }[tk]
                if not p.get("target_id") or await db.get(model, UUID(str(p["target_id"]))) is None:
                    raise NotFoundError(tk, str(p.get("target_id")))
        return f"Milestone {ch.payload.get('name') or ch.target_id[:8]} ({ch.op})"

    # activation
    if not (auth.has_any_scope("user.manage") or auth.has_any_scope("task.edit_schedule")):
        raise AppError("forbidden", "Missing 'user.manage' or 'task.edit_schedule'", 403)
    if ch.op not in ("create", "update", "delete"):
        raise AppError("invalid_change", f"Bad activation op '{ch.op}'", 400)
    if ch.op == "create" and ch.payload.get("target_kind") not in ("department", "company", "user"):
        raise AppError("invalid_change", "Activation target must be department/company/user", 400)
    s, e = ch.payload.get("start"), ch.payload.get("end")
    if s and e and _parse_date(e, "end") < _parse_date(s, "start"):
        raise AppError("invalid_change", "Activation period ends before it starts", 400)
    return f"Activation {ch.payload.get('start', '')}→{ch.payload.get('end', '')} ({ch.op})"


# ------------------------------------------------------------------ drafts


async def get_or_create_draft(db: AsyncSession, user_id: UUID) -> ScheduleDraft:
    draft = (
        await db.execute(select(ScheduleDraft).where(ScheduleDraft.user_id == user_id))
    ).scalar_one_or_none()
    if draft is None:
        draft = ScheduleDraft(id=uuid.uuid4(), user_id=user_id)
        db.add(draft)
        await db.flush()
        await db.refresh(draft, ["changes"])
    return draft


def _key(kind: str, op: str, target_id: str) -> tuple[str, str, str]:
    return (kind, "assign" if op == "assign" else "main", target_id)


def to_change(row: ScheduleDraftChange) -> Change:
    return Change(row.kind, row.op, str(row.target_id), dict(row.payload_json or {}))


async def add_changes(
    db: AsyncSession, auth: AuthContext, draft: ScheduleDraft, incoming: Sequence[Change]
) -> None:
    """Validate and merge changes into the user's draft (base values captured on first touch)."""
    live = await live_snapshot(db)
    by_key = {_key(r.kind, r.op, str(r.target_id)): r for r in draft.changes}
    for ch in incoming:
        k = _key(ch.kind, ch.op, ch.target_id)
        row = by_key.get(k)
        merged = merge_change(to_change(row) if row else None, ch)
        # Validate the merged change (the draft's view), not the fragment alone.
        label = await validate_change(db, auth, merged or ch)
        if merged is None:
            if row is not None:
                draft.changes.remove(row)
                await db.delete(row)
                by_key.pop(k, None)
            continue
        if row is None:
            item = live[SECTION[ch.kind]].get(ch.target_id)
            base = None
            if item is not None and ch.op != "create":
                base = (
                    {"assignments": item.get("assignments", [])}
                    if ch.op == "assign"
                    else dict(item)
                )
            row = ScheduleDraftChange(
                id=uuid.uuid4(),
                draft_id=draft.id,
                kind=ch.kind,
                op=merged.op,
                target_id=UUID(ch.target_id),
                payload_json=merged.payload,
                base_json=base,
                label=label,
            )
            draft.changes.append(row)
            by_key[k] = row
        else:
            row.op, row.payload_json, row.label = merged.op, merged.payload, label


# ------------------------------------------------------------------ apply (transactional)


def _target_cols(kind: str, target_id: str | None) -> dict[str, UUID | None]:
    cols: dict[str, UUID | None] = {f"{k}_id": None for k in MILESTONE_TARGETS}
    if kind != "none" and target_id:
        cols[f"{kind}_id"] = UUID(str(target_id))
    return cols


async def apply_changes(db: AsyncSession, auth: AuthContext, changes: Sequence[Change]) -> None:
    """Write draft changes to live tables (caller owns the transaction)."""
    for ch in changes:
        await validate_change(db, auth, ch)  # permissions may have changed since drafting
        tid = UUID(ch.target_id)
        if ch.kind == "task":
            task = await db.get(Task, tid)
            if task is None:
                continue
            if ch.op == "assign":
                await db.execute(delete(TaskAssignment).where(TaskAssignment.task_id == tid))
                for uid, role in ch.payload.get("assignments", []):
                    db.add(
                        TaskAssignment(task_id=tid, user_id=UUID(str(uid)), assignment_role=role)
                    )
                db.add(
                    TaskEvent(
                        task_id=tid,
                        user_id=auth.user.id,
                        acted_as="schedule",
                        source="schedule",
                        field="assignments",
                        new_value=str(ch.payload.get("assignments", [])),
                    )
                )
                continue
            for field, attr in (("start", "ideal_start_date"), ("finish", "ideal_finish_date")):
                if field in ch.payload:
                    new = _parse_date(ch.payload[field], field) if ch.payload[field] else None
                    old = getattr(task, attr)
                    if old != new:
                        setattr(task, attr, new)
                        db.add(
                            TaskEvent(
                                task_id=tid,
                                user_id=auth.user.id,
                                acted_as="schedule",
                                source="schedule",
                                field=attr,
                                old_value=_iso(old),
                                new_value=_iso(new),
                            )
                        )
            continue

        model: type[Milestone] | type[ActivationPeriod] = (
            Milestone if ch.kind == "milestone" else ActivationPeriod
        )
        existing = await db.get(model, tid)
        if ch.op == "delete":
            if existing is not None:
                await db.delete(existing)
            continue
        p = ch.payload
        if ch.kind == "milestone":
            m = existing if isinstance(existing, Milestone) else None
            if m is None:
                m = Milestone(id=tid, created_by=auth.user.id, name="", date=date.today())
                db.add(m)
            if "name" in p:
                m.name = str(p["name"]).strip()[:128]
            if "date" in p:
                m.date = _parse_date(p["date"], "date")
            for f in ("kind", "status"):
                if f in p:
                    setattr(m, f, p[f])
            if "note" in p:
                m.note = str(p["note"] or "")
            if "client_visible" in p:
                m.client_visible = bool(p["client_visible"])
            if "target_kind" in p or "target_id" in p:
                kind = p.get("target_kind", m.target_kind)
                target = p.get("target_id", str(m.target_id) if m.target_id else None)
                for col, val in _target_cols(kind, target).items():
                    setattr(m, col, val)
        else:
            a = existing if isinstance(existing, ActivationPeriod) else None
            if a is None:
                cols: dict[str, UUID | None] = {
                    f"{k}_id": None for k in ("department", "company", "user")
                }
                cols[f"{p['target_kind']}_id"] = UUID(str(p["target_id"]))
                a = ActivationPeriod(
                    id=tid,
                    start_date=_parse_date(p["start"], "start"),
                    end_date=_parse_date(p["end"], "end"),
                    note=str(p.get("note", "")),
                    created_by=auth.user.id,
                    **cols,
                )
                db.add(a)
            else:
                if "start" in p:
                    a.start_date = _parse_date(p["start"], "start")
                if "end" in p:
                    a.end_date = _parse_date(p["end"], "end")
                if "note" in p:
                    a.note = str(p["note"] or "")
            if a.end_date < a.start_date:
                raise AppError("invalid_change", "Activation period ends before it starts", 400)
    await db.flush()


async def assert_version_scope(
    db: AsyncSession, auth: AuthContext, changes: Sequence[Change]
) -> None:
    """Scoped holders of schedule.version may only save changes to tasks in their scope."""
    if not can_version(auth):
        raise AppError("forbidden", "Missing 'schedule.version'", 403)
    scoped = await visible_task_ids(db, auth, "schedule.version")
    if scoped is None:
        return
    outside = [c for c in changes if c.kind == "task" and UUID(c.target_id) not in scoped]
    if outside:
        raise AppError(
            "forbidden",
            f"{len(outside)} change(s) touch tasks outside your schedule.version scope",
            403,
        )


async def next_version_number(db: AsyncSession) -> int:
    rows = (await db.execute(select(ScheduleVersion.number))).scalars().all()
    return (max(rows) if rows else 0) + 1
