from __future__ import annotations

import asyncio
import re
from collections import deque
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.project_registry import ProjectContext
from app.models.project_db import (
    Department,
    DepartmentDefaultTask,
    Entity,
    EntityDepartment,
    FileEntry,
    Product,
    ProductVersion,
    ProjectMeta,
    Tag,
    Task,
)
from app.models.tasks import (
    TaskComment,
    TaskDependency,
    TaskEvent,
    TaskReview,
    TaskTag,
    TimeLog,
)
from app.models.user import TaskShare, VersionShare
from app.services.auth_service import write_audit
from app.services.entity_service import resolve_production_rel
from app.services.naming import check_case_insensitive_collision, sanitize_folder_name
from app.services.permissions import AuthContext, assert_can, can, can_see_client_comments
from app.services.workflow import (
    DEPENDENCY_THRESHOLDS,
    PRIORITIES,
    TaskWorkflowState,
    WorkflowActor,
    WorkflowPolicy,
    evaluate_allowed_transitions,
    is_dependency_satisfied,
    validate_transition,
)


def _sanitize_code_part(raw: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", raw.strip()).strip("_") or "X"


async def generate_unique_task_code(
    db: AsyncSession,
    *,
    entity_folder: str,
    dept_short: str,
    dept_folder: str,
    task_folder: str,
    pattern: str = "{entity_folder}_{dept_short}_{task_folder}",
) -> str:
    """Generate a unique human-readable task_code with numeric suffix on collisions."""
    short = _sanitize_code_part(dept_short or dept_folder[:3] or "DPT").upper()
    tokens = {
        "entity_folder": _sanitize_code_part(entity_folder),
        "dept_short": short,
        "dept_folder": _sanitize_code_part(dept_folder),
        "task_folder": _sanitize_code_part(task_folder),
    }
    try:
        rendered = pattern.format(**tokens)
    except Exception:
        rendered = f"{tokens['entity_folder']}_{tokens['dept_short']}_{tokens['task_folder']}"
    base = _sanitize_code_part(rendered)[:115] or "TASK"

    existing_rows = (
        (await db.execute(select(Task.task_code).where(Task.task_code.ilike(f"{base}%"))))
        .scalars()
        .all()
    )
    used_lower = {str(c).lower() for c in existing_rows}
    if base.lower() not in used_lower:
        return base
    suffix = 2
    while True:
        cand = f"{base[:105]}_{suffix}"
        if cand.lower() not in used_lower:
            return cand
        suffix += 1


async def get_project_policy(db: AsyncSession) -> tuple[ProjectMeta | None, WorkflowPolicy]:
    meta = (await db.execute(select(ProjectMeta).limit(1))).scalar_one_or_none()
    req_ver = True if meta is None else bool(meta.require_version_to_submit)
    return meta, WorkflowPolicy(require_version_to_submit=req_ver)


async def create_task_unified(
    db: AsyncSession,
    ctx: ProjectContext,
    *,
    entity: Entity,
    ed: EntityDepartment,
    dept: Department,
    name: str,
    default_task: DepartmentDefaultTask | None = None,
    description: str = "",
    priority: str | None = None,
    needs_lead_review: bool | None = None,
    needs_sup_review: bool | None = None,
    needs_client_review: bool | None = None,
    bid_hours: float | None = None,
    complexity_rating: int | None = None,
    ideal_start_date: date | None = None,
    ideal_finish_date: date | None = None,
    has_unmet_dependencies: bool = False,
    create_dirs: bool = True,
    actor_user_id: UUID | None = None,
    acted_as: str = "system",
    source: str = "user",
    commit: bool = True,
) -> Task:
    """Single canonical task creation path creating disk dirs, defaults, Product, and event."""
    folder_name = sanitize_folder_name(name)
    dup = (
        await db.execute(
            select(Task).where(
                Task.entity_department_id == ed.id,
                Task.folder_name == folder_name,
            )
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise ConflictError(f"Task '{folder_name}' already exists")

    if create_dirs:
        ent_dir = resolve_production_rel(ctx.production_dir, entity.rel_path)
        dept_dir = ent_dir / dept.folder_name
        task_dir = dept_dir / folder_name
        if await asyncio.to_thread(check_case_insensitive_collision, dept_dir, folder_name):
            raise ConflictError(f"Task folder '{folder_name}' already exists on disk")

        def _mk() -> None:
            (task_dir / "products").mkdir(parents=True, exist_ok=True)
            (task_dir / "scenefiles").mkdir(parents=True, exist_ok=True)

        await asyncio.to_thread(_mk)

    max_order = max(
        [
            t.sort_order
            for t in (
                await db.execute(select(Task).where(Task.entity_department_id == ed.id))
            ).scalars()
        ],
        default=-1,
    )

    meta, _ = await get_project_policy(db)
    pattern = meta.task_code_pattern if meta else "{entity_folder}_{dept_short}_{task_folder}"
    task_code = await generate_unique_task_code(
        db,
        entity_folder=entity.folder_name,
        dept_short=dept.short_code,
        dept_folder=dept.folder_name,
        task_folder=folder_name,
        pattern=pattern,
    )

    eff_priority = priority or (default_task.default_priority if default_task else "normal")
    if eff_priority not in PRIORITIES:
        raise AppError("validation_error", f"Invalid priority '{eff_priority}'", 400)

    eff_lead = (
        needs_lead_review
        if needs_lead_review is not None
        else (default_task.needs_lead_review if default_task else True)
    )
    eff_sup = (
        needs_sup_review
        if needs_sup_review is not None
        else (default_task.needs_sup_review if default_task else False)
    )
    eff_client = (
        needs_client_review
        if needs_client_review is not None
        else (default_task.needs_client_review if default_task else False)
    )
    eff_bid = (
        bid_hours
        if bid_hours is not None
        else (default_task.default_bid_hours if default_task else None)
    )
    eff_comp = (
        complexity_rating
        if complexity_rating is not None
        else (default_task.default_complexity if default_task else None)
    )
    if eff_comp is not None and not (1 <= eff_comp <= 5):
        raise AppError("validation_error", "complexity_rating must be between 1 and 5", 400)

    initial_status = "WTG" if has_unmet_dependencies else "RDY"
    task = Task(
        task_code=task_code,
        task_name=f"{dept.name} - {folder_name}",
        entity_department_id=ed.id,
        entity_id=entity.id,
        parent_entity_type=entity.entity_type,
        department_id=dept.id,
        name=folder_name,
        folder_name=folder_name,
        description=description.strip(),
        sort_order=max_order + 1,
        status=initial_status,
        priority=eff_priority,
        needs_lead_review=eff_lead,
        needs_sup_review=eff_sup,
        needs_client_review=eff_client,
        complexity_rating=eff_comp,
        ideal_start_date=ideal_start_date,
        ideal_finish_date=ideal_finish_date,
        bid_hours=eff_bid,
        logged_hours=0.0,
        retake_count=0,
    )
    db.add(task)
    await db.flush()
    db.add(Product(task_id=task.id, name=f"{dept.folder_name}/{folder_name}"))
    db.add(
        TaskEvent(
            task_id=task.id,
            user_id=actor_user_id,
            acted_as=acted_as,
            source=source,
            field="created",
            old_value=None,
            new_value=f"{task.task_code} ({initial_status})",
        )
    )
    if commit:
        await db.commit()
    return task


async def would_create_task_dependency_cycle(
    db: AsyncSession,
    *,
    task_id: UUID,
    upstream_task_id: UUID,
    extra_edges: list[tuple[UUID, UUID]] | None = None,
) -> bool:
    """Return True if adding upstream_task_id -> task_id creates a cycle."""
    if task_id == upstream_task_id:
        return True
    rows = (await db.execute(select(TaskDependency.upstream_task_id, TaskDependency.task_id))).all()
    adj: dict[UUID, list[UUID]] = {}
    for up_id, down_id in rows:
        adj.setdefault(up_id, []).append(down_id)
    if extra_edges:
        for up_id, down_id in extra_edges:
            adj.setdefault(up_id, []).append(down_id)

    # Adding upstream_task_id -> task_id creates a cycle iff upstream is reachable from task_id
    visited: set[UUID] = set()
    queue: deque[UUID] = deque([task_id])
    while queue:
        cur = queue.popleft()
        if cur == upstream_task_id:
            return True
        if cur in visited:
            continue
        visited.add(cur)
        for nxt in adj.get(cur, ()):
            if nxt not in visited:
                queue.append(nxt)
    return False


async def set_task_dependencies(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
    items: list[tuple[UUID, str, bool]],  # (upstream_task_id, threshold, from_entity_link)
) -> list[TaskDependency]:
    """Replace a task's blocking upstream dependencies with full cycle detection."""
    upstream_ids = [uid for uid, _, _ in items]
    if upstream_ids:
        existing_tasks = {
            t.id
            for t in (await db.execute(select(Task).where(Task.id.in_(upstream_ids))))
            .scalars()
            .all()
        }
        missing = [str(uid) for uid in upstream_ids if uid not in existing_tasks]
        if missing:
            raise NotFoundError("task", missing[0])

    # Clear existing deps on task before validating batch cycles cleanly against other tasks' edges
    other_rows = (
        await db.execute(
            select(TaskDependency.upstream_task_id, TaskDependency.task_id).where(
                TaskDependency.task_id != task.id
            )
        )
    ).all()
    adj: dict[UUID, list[UUID]] = {}
    for up_id, down_id in other_rows:
        adj.setdefault(up_id, []).append(down_id)

    deduped: list[tuple[UUID, str, bool]] = []
    seen_up: set[UUID] = set()
    for up_id, thresh, from_link in items:
        if thresh not in DEPENDENCY_THRESHOLDS:
            raise AppError("validation_error", f"Invalid threshold '{thresh}'", 400)
        if up_id == task.id:
            raise ConflictError("Task cannot depend on itself")
        if up_id in seen_up:
            continue
        # BFS from task.id following downstream edges to ensure up_id is not reachable
        visited: set[UUID] = set()
        q: deque[UUID] = deque([task.id])
        while q:
            cur = q.popleft()
            if cur == up_id:
                raise ConflictError("Adding this task dependency would create a cycle")
            if cur in visited:
                continue
            visited.add(cur)
            for nxt in adj.get(cur, ()):
                if nxt not in visited:
                    q.append(nxt)
        adj.setdefault(up_id, []).append(task.id)
        seen_up.add(up_id)
        deduped.append((up_id, thresh, from_link))

    await db.execute(delete(TaskDependency).where(TaskDependency.task_id == task.id))
    created: list[TaskDependency] = []
    for up_id, thresh, from_link in deduped:
        dep = TaskDependency(
            task_id=task.id,
            upstream_task_id=up_id,
            threshold=thresh,
            from_entity_link=from_link,
            created_by=auth.user.id,
        )
        db.add(dep)
        created.append(dep)

    db.add(
        TaskEvent(
            task_id=task.id,
            user_id=auth.user.id,
            acted_as=f"role:{auth.role.name}",
            source="user",
            field="dependencies",
            old_value=None,
            new_value=f"{len(deduped)} dependencies",
        )
    )
    await db.flush()
    await reevaluate_wtg_for_tasks(db, [task.id])
    return created


async def add_task_dependencies_batch(
    db: AsyncSession,
    auth: AuthContext,
    edges: list[tuple[UUID, UUID, str, bool]],  # (task_id, upstream_task_id, threshold, from_link)
) -> int:
    """Transactionally add dependency edges without replacing unrelated ones; rejects any cycle."""
    existing_pairs = {
        (r.task_id, r.upstream_task_id)
        for r in (await db.execute(select(TaskDependency))).scalars().all()
    }
    added = 0
    touched_tasks: list[UUID] = []
    extra_edges: list[tuple[UUID, UUID]] = []
    for down_id, up_id, thresh, from_link in edges:
        if thresh not in DEPENDENCY_THRESHOLDS:
            raise AppError("validation_error", f"Invalid threshold '{thresh}'", 400)
        if (down_id, up_id) in existing_pairs:
            continue
        if await would_create_task_dependency_cycle(
            db, task_id=down_id, upstream_task_id=up_id, extra_edges=extra_edges
        ):
            raise ConflictError("Suggested dependency would create a dependency cycle")
        db.add(
            TaskDependency(
                task_id=down_id,
                upstream_task_id=up_id,
                threshold=thresh,
                from_entity_link=from_link,
                created_by=auth.user.id,
            )
        )
        db.add(
            TaskEvent(
                task_id=down_id,
                user_id=auth.user.id,
                acted_as=f"role:{auth.role.name}",
                source="user",
                field="dependency_added",
                old_value=None,
                new_value=f"upstream:{up_id} ({thresh})",
            )
        )
        existing_pairs.add((down_id, up_id))
        extra_edges.append((up_id, down_id))
        touched_tasks.append(down_id)
        added += 1

    await db.flush()
    if touched_tasks:
        await reevaluate_wtg_for_tasks(db, touched_tasks)
    return added


async def reevaluate_wtg_for_tasks(db: AsyncSession, candidate_task_ids: list[UUID]) -> list[UUID]:
    """Promote any WTG task in candidate_task_ids to RDY if all dependencies are satisfied."""
    if not candidate_task_ids:
        return []
    wtg_tasks = (
        (
            await db.execute(
                select(Task).where(Task.id.in_(candidate_task_ids), Task.status == "WTG")
            )
        )
        .scalars()
        .all()
    )
    if not wtg_tasks:
        return []
    wtg_ids = [t.id for t in wtg_tasks]
    dep_rows = (
        (await db.execute(select(TaskDependency).where(TaskDependency.task_id.in_(wtg_ids))))
        .scalars()
        .all()
    )
    up_ids = {d.upstream_task_id for d in dep_rows}
    up_map: dict[UUID, Task] = {}
    if up_ids:
        up_map = {
            u.id: u
            for u in (await db.execute(select(Task).where(Task.id.in_(up_ids)))).scalars().all()
        }

    deps_by_task: dict[UUID, list[TaskDependency]] = {}
    for d in dep_rows:
        deps_by_task.setdefault(d.task_id, []).append(d)

    promoted: list[UUID] = []
    for t in wtg_tasks:
        deps = deps_by_task.get(t.id, [])
        all_ok = True
        for dep in deps:
            up = up_map.get(dep.upstream_task_id)
            if up is None or not is_dependency_satisfied(
                up.status, up.latest_version_id is not None, dep.threshold
            ):
                all_ok = False
                break
        if all_ok:
            t.status = "RDY"
            db.add(
                TaskEvent(
                    task_id=t.id,
                    user_id=None,
                    acted_as="system",
                    source="system",
                    field="status",
                    old_value="WTG",
                    new_value="RDY",
                )
            )
            promoted.append(t.id)
    return promoted


async def reevaluate_downstream_wtg(db: AsyncSession, upstream_task_id: UUID) -> list[UUID]:
    """Check downstream WTG dependents of upstream_task_id and promote satisfied ones to RDY."""
    down_ids = list(
        (
            await db.execute(
                select(TaskDependency.task_id).where(
                    TaskDependency.upstream_task_id == upstream_task_id
                )
            )
        )
        .scalars()
        .all()
    )
    return await reevaluate_wtg_for_tasks(db, down_ids)


async def compute_blocked_upstream_map(db: AsyncSession, task_ids: list[UUID]) -> dict[UUID, bool]:
    """Compute whether each task has at least one currently unmet upstream dependency."""
    result = {tid: False for tid in task_ids}
    if not task_ids:
        return result
    deps = (
        (await db.execute(select(TaskDependency).where(TaskDependency.task_id.in_(task_ids))))
        .scalars()
        .all()
    )
    if not deps:
        return result
    up_ids = {d.upstream_task_id for d in deps}
    up_map = {
        u.id: u for u in (await db.execute(select(Task).where(Task.id.in_(up_ids)))).scalars().all()
    }
    for d in deps:
        up = up_map.get(d.upstream_task_id)
        if up is None or not is_dependency_satisfied(
            up.status, up.latest_version_id is not None, d.threshold
        ):
            result[d.task_id] = True
    return result


async def build_workflow_actor(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
) -> WorkflowActor:
    """Resolve effective role + capacity grants on task for pure workflow evaluation."""
    perm_keys = (
        "task.status.force",
        "task.status.start",
        "task.status.submit",
        "task.status.hold",
        "task.status.reopen",
        "task.approve.lead",
        "task.approve.sup",
        "task.approve.client",
    )
    grants: dict[str, str] = {}
    for pk in perm_keys:
        allowed, via = await can(db, auth, pk, task)
        if allowed and via is not None:
            grants[pk] = via
    return WorkflowActor(role_name=auth.role.name, grants=grants)


def task_workflow_state(task: Task) -> TaskWorkflowState:
    return TaskWorkflowState(
        status=task.status,
        status_before_hold=task.status_before_hold,
        needs_lead_review=task.needs_lead_review,
        needs_sup_review=task.needs_sup_review,
        needs_client_review=task.needs_client_review,
        has_version=task.latest_version_id is not None,
        actual_start_set=task.actual_start_date is not None,
    )


async def get_allowed_transitions_for_task(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
    policy: WorkflowPolicy,
) -> list[dict[str, object]]:
    actor = await build_workflow_actor(db, auth, task)
    opts = evaluate_allowed_transitions(task_workflow_state(task), actor, policy)
    return [
        {
            "to": o.to,
            "action": o.action,
            "acted_as": o.acted_as,
            "on_behalf": o.on_behalf,
            "requires_comment": o.requires_comment,
            "requires_version": o.requires_version,
        }
        for o in opts
    ]


def comment_visibilities_for_user(auth: AuthContext) -> set[str]:
    """Client-visible comments are only visible to admin, producer, director, and client."""
    if auth.role.name == "client":
        return {"client"}
    if can_see_client_comments(auth):
        return {"internal", "client"}
    return {"internal"}


async def create_task_comment(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
    *,
    body: str,
    kind: str = "note",
    visibility: str = "internal",
    parent_id: UUID | None = None,
    version_id: UUID | None = None,
    file_id: UUID | None = None,
    annotation_id: UUID | None = None,
    frame: int | None = None,
    review_decision: str | None = None,
) -> TaskComment:
    """Create a task comment enforcing visibility rules strictly server-side."""
    await assert_can(db, auth, "task.comment", task)
    if kind not in {"note", "review", "media"}:
        raise AppError("validation_error", f"Invalid comment kind '{kind}'", 400)
    if visibility not in {"internal", "client"}:
        raise AppError("validation_error", f"Invalid visibility '{visibility}'", 400)

    eff_visibility = visibility
    if auth.role.name == "client":
        eff_visibility = "client"
    elif eff_visibility == "client":
        # Only roles/capacities allowed to share with clients can publish client comments
        allowed_share, _ = await can(db, auth, "task.share_client", task)
        if not allowed_share:
            raise AppError(
                "forbidden",
                "Only users permitted to share with clients may post client-visible comments",
                status_code=403,
            )

    if file_id is not None:
        fe = await db.get(FileEntry, file_id)
        if fe is None:
            raise NotFoundError("file", str(file_id))

    row = TaskComment(
        task_id=task.id,
        author_id=auth.user.id,
        parent_id=parent_id,
        kind=kind,
        visibility=eff_visibility,
        body=body.strip(),
        version_id=version_id,
        file_id=file_id,
        annotation_id=annotation_id,
        frame=frame,
        review_decision=review_decision,
    )
    db.add(row)
    await db.flush()
    return row


async def execute_task_transition(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
    *,
    target_status: str,
    version_id: UUID | None = None,
    comment: str | None = None,
    client_ip: str | None = None,
) -> tuple[Task, str]:
    """Run one validated workflow transition, updating Task, TaskReview, VersionShare, TaskEvent."""
    meta, policy = await get_project_policy(db)
    if meta is not None and meta.status == "archived" and auth.role.name != "admin":
        raise AppError("project_archived", "Archived project is read-only", status_code=403)

    actor = await build_workflow_actor(db, auth, task)
    state = task_workflow_state(task)
    res = validate_transition(
        state,
        actor,
        policy,
        target_status,
        comment=comment,
        version_id=version_id,
    )

    chosen_ver_id: UUID | None = version_id
    if chosen_ver_id is not None:
        pv = await db.get(ProductVersion, chosen_ver_id)
        if pv is None:
            raise NotFoundError("product_version", str(chosen_ver_id))
        prod = await db.get(Product, pv.product_id)
        if prod is None or prod.task_id != task.id:
            raise AppError(
                "validation_error",
                "Submitted version does not belong to this task",
                status_code=400,
            )
    else:
        chosen_ver_id = task.latest_version_id

    today_utc = datetime.now(UTC).date()
    task.status = res.to_status
    task.status_before_hold = res.status_before_hold
    if res.set_actual_start:
        task.actual_start_date = today_utc
    if res.set_actual_finish:
        task.actual_finish_date = today_utc
    if res.clear_actual_finish:
        task.actual_finish_date = None
    if res.increment_retake:
        task.retake_count += 1
    if res.set_approved_version:
        # Prefer last pending review's version_id if available
        last_rev = (
            await db.execute(
                select(TaskReview)
                .where(TaskReview.task_id == task.id)
                .order_by(TaskReview.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if last_rev is not None and last_rev.version_id is not None:
            task.approved_version_id = last_rev.version_id
        elif chosen_ver_id is not None:
            task.approved_version_id = chosen_ver_id

    if res.auto_share_client and chosen_ver_id is not None:
        share_companies = list(
            (await db.execute(select(TaskShare.company_id).where(TaskShare.task_id == task.id)))
            .scalars()
            .all()
        )
        for comp_id in share_companies:
            existing_vs = (
                await db.execute(
                    select(VersionShare).where(
                        VersionShare.version_id == chosen_ver_id,
                        VersionShare.company_id == comp_id,
                    )
                )
            ).scalar_one_or_none()
            if existing_vs is None:
                db.add(
                    VersionShare(
                        version_id=chosen_ver_id,
                        company_id=comp_id,
                        shared_by=auth.user.id,
                    )
                )

    clean_comment = (comment or "").strip()
    comment_row: TaskComment | None = None
    if clean_comment:
        cmt_vis = (
            "client" if (auth.role.name == "client" or res.on_behalf_of_client) else "internal"
        )
        comment_row = TaskComment(
            task_id=task.id,
            author_id=auth.user.id,
            kind="review" if res.review_decision is not None else "note",
            visibility=cmt_vis,
            body=clean_comment,
            version_id=chosen_ver_id,
            review_decision=res.review_decision,
        )
        db.add(comment_row)
        await db.flush()

    if res.review_stage is not None and res.review_decision is not None:
        round_no = task.retake_count if res.increment_retake else task.retake_count + 1
        db.add(
            TaskReview(
                task_id=task.id,
                round_no=round_no,
                version_id=chosen_ver_id,
                stage=res.review_stage,
                decision=res.review_decision,
                reviewer_id=auth.user.id,
                acted_as=res.acted_as,
                on_behalf_of="client" if res.on_behalf_of_client else None,
                comment_id=comment_row.id if comment_row is not None else None,
            )
        )

    db.add(
        TaskEvent(
            task_id=task.id,
            user_id=auth.user.id,
            acted_as=res.acted_as,
            source="user",
            field="status",
            old_value=res.from_status,
            new_value=res.to_status,
        )
    )
    if res.on_behalf_of_client:
        await write_audit(
            db,
            user_id=auth.user.id,
            action="task.approve_on_behalf",
            target_type="task",
            target_id=str(task.id),
            ip=client_ip,
            detail={"from": res.from_status, "to": res.to_status},
        )

    await db.flush()
    await reevaluate_downstream_wtg(db, task.id)
    return task, res.acted_as


async def recompute_logged_hours(db: AsyncSession, task: Task) -> float:
    total = (
        await db.execute(
            select(func.coalesce(func.sum(TimeLog.hours), 0.0)).where(TimeLog.task_id == task.id)
        )
    ).scalar_one()
    task.logged_hours = round(float(total), 2)
    return task.logged_hours


async def replace_task_tags(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
    tag_names: list[str],
) -> list[str]:
    cleaned: list[str] = []
    seen_low: set[str] = set()
    for raw in tag_names:
        t = raw.strip()
        if not t or t.lower() in seen_low:
            continue
        seen_low.add(t.lower())
        cleaned.append(t)

    await db.execute(delete(TaskTag).where(TaskTag.task_id == task.id))
    for name in cleaned:
        existing = (await db.execute(select(Tag).where(Tag.name == name))).scalar_one_or_none()
        if existing is None:
            existing = Tag(name=name)
            db.add(existing)
            await db.flush()
        db.add(TaskTag(task_id=task.id, tag_id=existing.id))
    db.add(
        TaskEvent(
            task_id=task.id,
            user_id=auth.user.id,
            acted_as=f"role:{auth.role.name}",
            source="user",
            field="tags",
            old_value=None,
            new_value=", ".join(sorted(cleaned)),
        )
    )
    await db.flush()
    return sorted(cleaned)


async def load_task_full(db: AsyncSession, task_id: UUID) -> Task:
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
    return task
