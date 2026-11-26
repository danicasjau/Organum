"""CR04 §5/§7: schedule drafts, versions (S0001...) and milestones / deliver dates."""

from __future__ import annotations

import uuid
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.errors import AppError, NotFoundError
from app.core.security import client_ip_from_request, get_project_auth
from app.models.schedule import Milestone, ScheduleDraft, ScheduleVersion
from app.models.user import User
from app.schemas.api import (
    DraftChangeOut,
    DraftChangesIn,
    DraftOut,
    DraftPreviewOut,
    DraftSaveIn,
    MilestoneIn,
    MilestoneOut,
    MilestonePatch,
    ScheduleCompareOut,
    ScheduleDiffItemOut,
    ScheduleVersionOut,
    VersionStarIn,
)
from app.services import schedule_service as sch
from app.services.auth_service import write_audit
from app.services.permissions import AuthContext, visible_task_ids

router = APIRouter(tags=["schedule"])


# ------------------------------------------------------------------ helpers


def _is_client_like(auth: AuthContext) -> bool:
    return auth.role.name != "admin" and auth.permissions.get("task.view", "none") in (
        "none",
        "shared",
    )


def _assert_internal(auth: AuthContext) -> None:
    if _is_client_like(auth):
        raise AppError("forbidden", "Schedule tools are internal", status_code=403)


def _assert_writable(auth: AuthContext) -> None:
    if auth.project_status == "archived" and auth.role.name != "admin":
        raise AppError("forbidden", "Project is archived and read-only", status_code=403)


async def _audit(
    db: AsyncSession, auth: AuthContext, request: Request, action: str, target: str, detail: Any
) -> None:
    await write_audit(
        db,
        user_id=auth.user.id,
        action=action,
        target_type="schedule",
        target_id=target,
        ip=client_ip_from_request(request),
        detail=detail,
    )


async def _task_filter(db: AsyncSession, auth: AuthContext) -> set[str] | None:
    vis = await visible_task_ids(db, auth, "task.view")
    return None if vis is None else {str(t) for t in vis}


def _diff_out(
    items: list[sch.DiffItem], visible_tasks: set[str] | None
) -> list[ScheduleDiffItemOut]:
    """Diff items, hiding tasks the caller cannot see (no leakage through versions)."""
    return [
        ScheduleDiffItemOut(**it.as_dict())
        for it in items
        if it.kind != "task" or visible_tasks is None or it.target_id in visible_tasks
    ]


def _summary(items: list[ScheduleDiffItemOut]) -> dict[str, int]:
    out = {"tasks": 0, "milestones": 0, "activations": 0, "total": len(items)}
    for it in items:
        out[sch.SECTION[it.kind]] += 1
    return out


async def _draft_out(db: AsyncSession, draft: ScheduleDraft | None) -> DraftOut:
    if draft is None:
        return DraftOut()
    base_label = None
    if draft.base_version_id:
        v = await db.get(ScheduleVersion, draft.base_version_id)
        base_label = v.label if v else None
    changes = [
        DraftChangeOut(
            id=c.id,
            kind=c.kind,
            op=c.op,
            target_id=c.target_id,
            payload=dict(c.payload_json or {}),
            label=c.label,
            created_at=c.created_at,
        )
        for c in draft.changes
    ]
    return DraftOut(
        id=draft.id,
        base_version_id=draft.base_version_id,
        base_version_label=base_label,
        changes=changes,
        count=len(changes),
    )


async def _load_draft(db: AsyncSession, auth: AuthContext) -> ScheduleDraft | None:
    return (
        await db.execute(select(ScheduleDraft).where(ScheduleDraft.user_id == auth.user.id))
    ).scalar_one_or_none()


# ------------------------------------------------------------------ milestones


def _milestone_out(m: Milestone, late: list[str]) -> MilestoneOut:
    return MilestoneOut(
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


@router.get("/milestones", response_model=list[MilestoneOut])
async def list_milestones(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[MilestoneOut]:
    """Everyone who can see tasks sees milestones; clients only see the shared ones."""
    if auth.role.name != "admin" and auth.permissions.get("task.view", "none") == "none":
        raise AppError("forbidden", "Missing permission 'task.view'", status_code=403)
    stmt = select(Milestone).order_by(Milestone.date)
    client_like = _is_client_like(auth)
    if client_like:
        stmt = stmt.where(Milestone.client_visible.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    if client_like:
        return [_milestone_out(m, []) for m in rows]  # no internal task ids for clients
    snap = await sch.live_snapshot(db)
    meta = await sch.task_meta(db)
    visible = await _task_filter(db, auth)
    out: list[MilestoneOut] = []
    for m in rows:
        late = sch.late_tasks_for_milestone(sch.milestone_dict(m), snap["tasks"], meta)
        if visible is not None:
            late = [t for t in late if t in visible]
        out.append(_milestone_out(m, late))
    return out


@router.post("/milestones", response_model=MilestoneOut, status_code=201)
async def create_milestone(
    payload: MilestoneIn,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MilestoneOut:
    """Direct (non-draft) creation, e.g. from lists; the Gantt/Calendar use the draft."""
    _assert_writable(auth)
    change = sch.Change(
        "milestone",
        "create",
        str(uuid.uuid4()),
        payload.model_dump(mode="json"),
    )
    await sch.apply_changes(db, auth, [change])
    await _audit(db, auth, request, "milestone.create", change.target_id, {"name": payload.name})
    await db.commit()
    m = await db.get(Milestone, UUID(change.target_id))
    assert m is not None
    return _milestone_out(m, [])


@router.patch("/milestones/{milestone_id}", response_model=MilestoneOut)
async def patch_milestone(
    milestone_id: UUID,
    payload: MilestonePatch,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MilestoneOut:
    _assert_writable(auth)
    m = await db.get(Milestone, milestone_id)
    if m is None:
        raise NotFoundError("milestone", str(milestone_id))
    data = payload.model_dump(mode="json", exclude_unset=True)
    if "target_kind" in data and data["target_kind"] == "none":
        data["target_id"] = None
    await sch.apply_changes(db, auth, [sch.Change("milestone", "update", str(m.id), data)])
    await _audit(db, auth, request, "milestone.update", str(m.id), data)
    await db.commit()
    await db.refresh(m)
    return _milestone_out(m, [])


@router.delete("/milestones/{milestone_id}", status_code=204)
async def delete_milestone(
    milestone_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    _assert_writable(auth)
    if await db.get(Milestone, milestone_id) is None:
        raise NotFoundError("milestone", str(milestone_id))
    await sch.apply_changes(db, auth, [sch.Change("milestone", "delete", str(milestone_id), {})])
    await _audit(db, auth, request, "milestone.delete", str(milestone_id), {})
    await db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ draft


@router.get("/schedule/draft", response_model=DraftOut)
async def get_draft(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DraftOut:
    _assert_internal(auth)
    return await _draft_out(db, await _load_draft(db, auth))


@router.post("/schedule/draft/changes", response_model=DraftOut)
async def add_draft_changes(
    payload: DraftChangesIn,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DraftOut:
    """Stage schedule edits in the caller's draft; live data is untouched."""
    _assert_internal(auth)
    _assert_writable(auth)
    draft = await sch.get_or_create_draft(db, auth.user.id)
    await sch.add_changes(
        db,
        auth,
        draft,
        [sch.Change(c.kind, c.op, str(c.target_id), c.payload) for c in payload.changes],
    )
    await db.commit()
    await db.refresh(draft, ["changes"])
    return await _draft_out(db, draft)


@router.delete("/schedule/draft/changes/{change_id}", response_model=DraftOut)
async def revert_draft_change(
    change_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DraftOut:
    _assert_internal(auth)
    draft = await _load_draft(db, auth)
    row = next((c for c in (draft.changes if draft else []) if c.id == change_id), None)
    if draft is None or row is None:
        raise NotFoundError("draft_change", str(change_id))
    draft.changes.remove(row)
    await db.delete(row)
    await db.commit()
    return await _draft_out(db, draft)


@router.delete("/schedule/draft", status_code=204)
async def discard_draft(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    _assert_internal(auth)
    draft = await _load_draft(db, auth)
    if draft is not None:
        await db.delete(draft)
        await db.commit()
    return Response(status_code=204)


@router.get("/schedule/draft/preview", response_model=DraftPreviewOut)
async def preview_draft(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DraftPreviewOut:
    """Differences the draft would apply, plus conflicts with live data changed meanwhile."""
    _assert_internal(auth)
    draft = await _load_draft(db, auth)
    live = await sch.live_snapshot(db)
    rows = draft.changes if draft else []
    changes = [sch.to_change(r) for r in rows]
    items = _diff_out(sch.diff(live, sch.overlay(live, changes)), await _task_filter(db, auth))
    conflicts = sch.find_conflicts(live, [(sch.to_change(r), r.base_json, r.label) for r in rows])
    return DraftPreviewOut(
        diff=items, summary=_summary(items), conflicts=conflicts, can_save=sch.can_version(auth)
    )


@router.post("/schedule/draft/save", response_model=ScheduleVersionOut, status_code=201)
async def save_draft_as_version(
    payload: DraftSaveIn,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ScheduleVersionOut:
    """Apply the draft to live data and store the result as a new immutable version."""
    _assert_internal(auth)
    _assert_writable(auth)
    draft = await _load_draft(db, auth)
    rows = list(draft.changes) if draft else []
    changes = [sch.to_change(r) for r in rows]
    await sch.assert_version_scope(db, auth, changes)
    before = await sch.live_snapshot(db)
    conflicts = sch.find_conflicts(before, [(sch.to_change(r), r.base_json, r.label) for r in rows])
    if conflicts and not payload.overwrite_conflicts:
        raise AppError(
            "draft_conflicts",
            f"{len(conflicts)} item(s) changed in live data since your draft started",
            status_code=409,
            details=conflicts,
        )
    try:
        await sch.apply_changes(db, auth, changes)
        after = await sch.live_snapshot(db)
        items = sch.diff(before, after)
        version = ScheduleVersion(
            id=uuid.uuid4(),
            number=await sch.next_version_number(db),
            comment=payload.comment.strip(),
            author_id=auth.user.id,
            snapshot_json=after,
            diff_summary_json={**sch.summarize(items), "changes": len(changes)},
        )
        db.add(version)
        if draft is not None:
            await db.delete(draft)
        await _audit(
            db,
            auth,
            request,
            "schedule.version.save",
            version.label,
            {
                "changes": len(changes),
                "conflicts_overwritten": len(conflicts),
                "summary": version.diff_summary_json,
            },
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return await _version_out(db, version, after)


# ------------------------------------------------------------------ versions


async def _version_out(
    db: AsyncSession, v: ScheduleVersion, live: sch.Snapshot | None = None
) -> ScheduleVersionOut:
    author = await db.get(User, v.author_id) if v.author_id else None
    return ScheduleVersionOut(
        id=v.id,
        number=v.number,
        label=v.label,
        comment=v.comment,
        author_id=v.author_id,
        author_name=author.full_name if author else None,
        created_at=v.created_at,
        is_starred=v.is_starred,
        is_current=live is not None and v.snapshot_json == live,
        diff_summary=dict(v.diff_summary_json or {}),
    )


@router.get("/schedule/versions", response_model=list[ScheduleVersionOut])
async def list_versions(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ScheduleVersionOut]:
    _assert_internal(auth)
    rows = (
        (await db.execute(select(ScheduleVersion).order_by(ScheduleVersion.number.desc())))
        .scalars()
        .all()
    )
    live = await sch.live_snapshot(db)
    out = [await _version_out(db, v) for v in rows]
    # "Current" = newest version identical to live data.
    for o, v in zip(out, rows, strict=True):
        if v.snapshot_json == live:
            o.is_current = True
            break
    return out


@router.post("/schedule/versions/{version_id}/star", response_model=ScheduleVersionOut)
async def star_version(
    version_id: UUID,
    payload: VersionStarIn,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ScheduleVersionOut:
    """Mark (or unmark) the baseline/master version; at most one version is starred."""
    _assert_internal(auth)
    _assert_writable(auth)
    if not sch.can_version(auth):
        raise AppError("forbidden", "Missing 'schedule.version'", 403)
    v = await db.get(ScheduleVersion, version_id)
    if v is None:
        raise NotFoundError("schedule_version", str(version_id))
    if payload.starred:
        for other in (
            (await db.execute(select(ScheduleVersion).where(ScheduleVersion.is_starred.is_(True))))
            .scalars()
            .all()
        ):
            other.is_starred = False
    v.is_starred = payload.starred
    await _audit(db, auth, request, "schedule.version.star", v.label, {"starred": payload.starred})
    await db.commit()
    return await _version_out(db, v)


@router.post("/schedule/versions/{version_id}/jump", response_model=DraftOut)
async def jump_to_version(
    version_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DraftOut:
    """Load a version as a *new draft* (replacing the caller's draft); live data untouched."""
    _assert_internal(auth)
    _assert_writable(auth)
    v = await db.get(ScheduleVersion, version_id)
    if v is None:
        raise NotFoundError("schedule_version", str(version_id))
    old = await _load_draft(db, auth)
    if old is not None:
        await db.delete(old)
        await db.flush()
    live = await sch.live_snapshot(db)
    changes = sch.changes_to_reach(live, v.snapshot_json)
    draft = await sch.get_or_create_draft(db, auth.user.id)
    draft.base_version_id = v.id
    if changes:
        await sch.add_changes(db, auth, draft, changes)
    await db.commit()
    await db.refresh(draft, ["changes"])
    return await _draft_out(db, draft)


async def _snapshot_for(db: AsyncSession, auth: AuthContext, ref: str) -> sch.Snapshot:
    if ref == "live":
        return await sch.live_snapshot(db)
    if ref == "draft":
        live = await sch.live_snapshot(db)
        draft = await _load_draft(db, auth)
        return sch.overlay(live, [sch.to_change(r) for r in (draft.changes if draft else [])])
    try:
        v = await db.get(ScheduleVersion, UUID(ref))
    except ValueError as exc:
        raise AppError(
            "invalid_request", "Compare refs are a version id, 'live' or 'draft'", 400
        ) from exc
    if v is None:
        raise NotFoundError("schedule_version", ref)
    return v.snapshot_json


@router.get("/schedule/versions/compare", response_model=ScheduleCompareOut)
async def compare_versions(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    a: str,
    b: str = "live",
) -> ScheduleCompareOut:
    _assert_internal(auth)
    items = _diff_out(
        sch.diff(await _snapshot_for(db, auth, a), await _snapshot_for(db, auth, b)),
        await _task_filter(db, auth),
    )
    return ScheduleCompareOut(a=a, b=b, diff=items, summary=_summary(items))
