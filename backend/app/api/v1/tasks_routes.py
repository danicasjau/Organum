from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_project_context
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.project_registry import ProjectContext
from app.core.security import client_ip_from_request, get_project_auth, require
from app.models.project_db import (
    Department,
    Entity,
    EntityDepartment,
    EntityTag,
    FileEntry,
    Product,
    ProductVersion,
    Tag,
    Task,
    TaskLink,
)
from app.models.tasks import (
    SavedView,
    TaskComment,
    TaskDependency,
    TaskEvent,
    TaskReview,
    TaskTag,
    TimeLog,
)
from app.models.user import CompanyDepartment, TaskAssignment, TaskShare, User
from app.schemas.api import (
    ClientFileSummaryOut,
    ClientProductOut,
    ClientProductVersionOut,
    ClientReviewQueueItemOut,
    ClientTaskCommentOut,
    ClientTaskDetailOut,
    ClientTaskListItemOut,
    ClientTaskListOut,
    ClientTaskReviewOut,
    MyTasksResponse,
    ProductOut,
    ReviewQueueItemOut,
    SavedViewCreateRequest,
    SavedViewOut,
    TaskAssignmentOut,
    TaskBulkRequest,
    TaskBulkResponse,
    TaskBulkRowResult,
    TaskCommentCreateRequest,
    TaskCommentOut,
    TaskCreateFullRequest,
    TaskDependenciesPutRequest,
    TaskDependencyOut,
    TaskDetailOut,
    TaskEventOut,
    TaskGraphEdgeOut,
    TaskGraphNodeOut,
    TaskGraphOut,
    TaskLinkOut,
    TaskLinksPutRequest,
    TaskListItemOut,
    TaskListOut,
    TaskPatchRequest,
    TaskReviewOut,
    TaskTagsPutRequest,
    TaskTransitionRequest,
    TimeLogCreateRequest,
    TimeLogOut,
    TransitionOptionOut,
    WorkloadCellSchema,
    WorkloadResponse,
    WorkloadRowSchema,
)
from app.services.entity_links_service import get_linked_entity_ids
from app.services.entity_service import rename_task
from app.services.permissions import (
    AuthContext,
    assert_can,
    can,
    client_shared_version_ids,
    visible_task_ids,
)
from app.services.task_service import (
    comment_visibilities_for_user,
    compute_blocked_upstream_map,
    create_task_comment,
    create_task_unified,
    execute_task_transition,
    get_allowed_transitions_for_task,
    get_project_policy,
    load_task_full,
    recompute_logged_hours,
    replace_task_tags,
    set_task_dependencies,
)
from app.services.workflow import (
    PRIORITIES,
    TASK_STATUSES,
    compute_bid_days,
    is_dependency_satisfied,
)
from app.services.workload import (
    WorkloadTaskInput,
    WorkloadTimeLogInput,
    WorkloadUserInput,
    compute_workload_grid,
)

router = APIRouter(tags=["tasks"])


def _client_product_for_task(t: Task, shared_version_ids: set[UUID]) -> ClientProductOut | None:
    if t.product is None:
        return None
    vers: list[ClientProductVersionOut] = []
    for v in sorted(t.product.versions, key=lambda x: x.version_number, reverse=True):
        if v.id not in shared_version_ids:
            continue
        vers.append(
            ClientProductVersionOut(
                id=v.id,
                version_number=v.version_number,
                label=v.label,
                comment=v.comment,
                created_at=v.created_at,
                files=[
                    ClientFileSummaryOut(
                        id=f.id,
                        filename=f.filename,
                        relative_path=f.relative_path,
                        size=f.size,
                        sha256=f.sha256,
                        detected_format=f.detected_format,
                        media_kind=f.media_kind,
                        is_sequence=f.is_sequence,
                        sequence_pattern=f.sequence_pattern,
                        sequence_kind=f.sequence_kind,
                        frame_start=f.frame_start,
                        frame_end=f.frame_end,
                        frame_count=f.frame_count,
                    )
                    for f in sorted(v.files, key=lambda x: x.filename)
                ],
            )
        )
    if not vers:
        return None
    master_id = (
        t.product.master_version_id if t.product.master_version_id in shared_version_ids else None
    )
    return ClientProductOut(
        id=t.product.id,
        task_id=t.id,
        name=t.product.name,
        master_version_id=master_id,
        versions=vers,
    )


async def _hydrate_task_list_items(
    db: AsyncSession,
    auth: AuthContext,
    tasks: list[Task],
    *,
    hours_per_day: float = 8.0,
) -> list[TaskListItemOut]:
    if not tasks:
        return []
    t_ids = [t.id for t in tasks]
    ent_ids = {t.entity_id for t in tasks}
    dept_ids = {t.department_id for t in tasks}

    ents = {
        e.id: e
        for e in (await db.execute(select(Entity).where(Entity.id.in_(ent_ids)))).scalars().all()
    }
    depts = {
        d.id: d
        for d in (await db.execute(select(Department).where(Department.id.in_(dept_ids))))
        .scalars()
        .all()
    }
    users = {u.id: u for u in (await db.execute(select(User))).scalars().all()}

    assign_rows = (
        (await db.execute(select(TaskAssignment).where(TaskAssignment.task_id.in_(t_ids))))
        .scalars()
        .all()
    )
    assigns_by_task: dict[UUID, list[TaskAssignmentOut]] = {}
    for ta in assign_rows:
        u = users.get(ta.user_id)
        if u is None:
            continue
        assigns_by_task.setdefault(ta.task_id, []).append(
            TaskAssignmentOut(
                user_id=u.id,
                username=u.username,
                full_name=u.full_name,
                avatar_file=u.avatar_file,
                assignment_role=cast(Literal["artist", "lead", "supervisor"], ta.assignment_role),
                source=ta.source,
            )
        )

    shares_by_task: dict[UUID, list[UUID]] = {}
    for ts in (
        (await db.execute(select(TaskShare).where(TaskShare.task_id.in_(t_ids)))).scalars().all()
    ):
        shares_by_task.setdefault(ts.task_id, []).append(ts.company_id)

    tag_rows = (
        await db.execute(
            select(TaskTag.task_id, Tag.name)
            .join(Tag, Tag.id == TaskTag.tag_id)
            .where(TaskTag.task_id.in_(t_ids))
        )
    ).all()
    tags_by_task: dict[UUID, list[str]] = {}
    for tid, tname in tag_rows:
        tags_by_task.setdefault(tid, []).append(str(tname))

    ver_counts_rows = (
        await db.execute(
            select(Product.task_id, func.count(ProductVersion.id))
            .join(ProductVersion, ProductVersion.product_id == Product.id)
            .where(Product.task_id.in_(t_ids))
            .group_by(Product.task_id)
        )
    ).all()
    ver_counts = {tid: int(cnt) for tid, cnt in ver_counts_rows}

    up_counts_rows = (
        await db.execute(
            select(TaskDependency.task_id, func.count(TaskDependency.upstream_task_id))
            .where(TaskDependency.task_id.in_(t_ids))
            .group_by(TaskDependency.task_id)
        )
    ).all()
    up_counts = {tid: int(cnt) for tid, cnt in up_counts_rows}
    blocked_map = await compute_blocked_upstream_map(db, t_ids)

    # Latest feedback left by other users (review decisions + comments), used by the UI
    # to flag tasks with reviews the caller has not opened yet.
    me = auth.user.id
    feedback: dict[UUID, tuple[datetime, str | None, str]] = {}

    def _keep_latest(tid: UUID, at: datetime | None, who_id: UUID | None, kind: str) -> None:
        if at is None:
            return
        cur = feedback.get(tid)
        if cur is None or _as_aware(at) > _as_aware(cur[0]):
            who = users.get(who_id) if who_id else None
            feedback[tid] = (at, who.full_name or who.username if who else None, kind)

    for tid, at, rid, decision in (
        await db.execute(
            select(
                TaskReview.task_id,
                TaskReview.created_at,
                TaskReview.reviewer_id,
                TaskReview.decision,
            ).where(
                TaskReview.task_id.in_(t_ids),
                TaskReview.decision != "pending",
                or_(TaskReview.reviewer_id.is_(None), TaskReview.reviewer_id != me),
            )
        )
    ).all():
        _keep_latest(tid, at, rid, str(decision))

    comment_q = select(
        TaskComment.task_id,
        TaskComment.created_at,
        TaskComment.author_id,
        TaskComment.kind,
    ).where(
        TaskComment.task_id.in_(t_ids),
        TaskComment.deleted_at.is_(None),
        or_(TaskComment.author_id.is_(None), TaskComment.author_id != me),
    )
    if auth.role.name == "client":
        comment_q = comment_q.where(TaskComment.visibility == "client")
    for tid, at, aid, kind in (await db.execute(comment_q)).all():
        _keep_latest(tid, at, aid, str(kind))

    items: list[TaskListItemOut] = []
    for t in tasks:
        ent = ents.get(t.entity_id)
        dept = depts.get(t.department_id)
        prio = cast(
            Literal["normal", "high", "stopper"],
            t.priority if t.priority in PRIORITIES else "normal",
        )
        items.append(
            TaskListItemOut(
                id=t.id,
                task_code=t.task_code,
                task_name=t.task_name,
                name=t.name,
                folder_name=t.folder_name,
                entity_id=t.entity_id,
                entity_name=ent.name if ent else "",
                entity_rel_path=ent.rel_path if ent else "",
                parent_entity_type=t.parent_entity_type,
                department_id=t.department_id,
                department_name=dept.name if dept else "",
                department_short_code=dept.short_code if dept else "",
                department_color=dept.color if dept else "--series-1",
                description=t.description,
                status=t.status,
                status_before_hold=t.status_before_hold,
                priority=prio,
                needs_lead_review=t.needs_lead_review,
                needs_sup_review=t.needs_sup_review,
                needs_client_review=t.needs_client_review,
                complexity_rating=t.complexity_rating,
                ideal_start_date=t.ideal_start_date,
                actual_start_date=t.actual_start_date,
                ideal_finish_date=t.ideal_finish_date,
                actual_finish_date=t.actual_finish_date,
                bid_hours=t.bid_hours,
                bid_days=compute_bid_days(t.bid_hours, hours_per_day),
                logged_hours=t.logged_hours,
                retake_count=t.retake_count,
                latest_version_id=t.latest_version_id,
                approved_version_id=t.approved_version_id,
                version_count=ver_counts.get(t.id, 0),
                upstream_count=up_counts.get(t.id, 0),
                blocked_upstream=blocked_map.get(t.id, False),
                assignments=assigns_by_task.get(t.id, []),
                my_capacities=auth.my_task_capacities.get(t.id, []),
                tags=sorted(tags_by_task.get(t.id, [])),
                shared_company_ids=shares_by_task.get(t.id, []),
                updated_at=t.updated_at,
                last_feedback_at=feedback[t.id][0] if t.id in feedback else None,
                last_feedback_by=feedback[t.id][1] if t.id in feedback else None,
                last_feedback_kind=feedback[t.id][2] if t.id in feedback else None,
            )
        )
    return items


def _as_aware(dt: datetime) -> datetime:
    """SQLite returns naive datetimes; normalise to UTC for comparisons."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def _build_task_detail_out(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
    *,
    acted_as: str | None = None,
) -> TaskDetailOut:
    meta, policy = await get_project_policy(db)
    hours_per_day = meta.hours_per_day if meta else 8.0
    base_list = await _hydrate_task_list_items(db, auth, [task], hours_per_day=hours_per_day)
    base = base_list[0]

    trans_raw = await get_allowed_transitions_for_task(db, auth, task, policy)
    transitions = [
        TransitionOptionOut(
            to=str(o["to"]),
            action=str(o["action"]),
            acted_as=str(o["acted_as"]),
            on_behalf=bool(o["on_behalf"]),
            requires_comment=bool(o["requires_comment"]),
            requires_version=bool(o["requires_version"]),
        )
        for o in trans_raw
    ]

    # Upstream & downstream deps
    up_rows = (
        (await db.execute(select(TaskDependency).where(TaskDependency.task_id == task.id)))
        .scalars()
        .all()
    )
    dn_rows = (
        (await db.execute(select(TaskDependency).where(TaskDependency.upstream_task_id == task.id)))
        .scalars()
        .all()
    )
    rel_task_ids = {r.upstream_task_id for r in up_rows} | {r.task_id for r in dn_rows}
    rel_tasks: dict[UUID, Task] = {}
    if rel_task_ids:
        rel_tasks = {
            rt.id: rt
            for rt in (await db.execute(select(Task).where(Task.id.in_(rel_task_ids))))
            .scalars()
            .all()
        }
    rel_ents = {
        e.id: e
        for e in (
            await db.execute(
                select(Entity).where(Entity.id.in_({t.entity_id for t in rel_tasks.values()}))
            )
        )
        .scalars()
        .all()
    }
    rel_depts = {
        d.id: d
        for d in (
            await db.execute(
                select(Department).where(
                    Department.id.in_({t.department_id for t in rel_tasks.values()})
                )
            )
        )
        .scalars()
        .all()
    }

    up_outs: list[TaskDependencyOut] = []
    for d in up_rows:
        ut = rel_tasks.get(d.upstream_task_id)
        if ut is None:
            continue
        up_outs.append(
            TaskDependencyOut(
                task_id=d.task_id,
                upstream_task_id=d.upstream_task_id,
                upstream_task_code=ut.task_code,
                upstream_task_name=ut.task_name,
                upstream_entity_name=rel_ents[ut.entity_id].name
                if ut.entity_id in rel_ents
                else "",
                upstream_department=rel_depts[ut.department_id].name
                if ut.department_id in rel_depts
                else "",
                upstream_status=ut.status,
                threshold=d.threshold,
                from_entity_link=d.from_entity_link,
                satisfied=is_dependency_satisfied(
                    ut.status, ut.latest_version_id is not None, d.threshold
                ),
            )
        )

    dn_outs: list[TaskDependencyOut] = []
    for d in dn_rows:
        dt = rel_tasks.get(d.task_id)
        if dt is None:
            continue
        dn_outs.append(
            TaskDependencyOut(
                task_id=d.task_id,
                upstream_task_id=d.upstream_task_id,
                upstream_task_code=dt.task_code,
                upstream_task_name=dt.task_name,
                upstream_entity_name=rel_ents[dt.entity_id].name
                if dt.entity_id in rel_ents
                else "",
                upstream_department=rel_depts[dt.department_id].name
                if dt.department_id in rel_depts
                else "",
                upstream_status=dt.status,
                threshold=d.threshold,
                from_entity_link=d.from_entity_link,
                satisfied=is_dependency_satisfied(
                    task.status, task.latest_version_id is not None, d.threshold
                ),
            )
        )

    # Non-blocking task links
    tl_rows = (
        (await db.execute(select(TaskLink).where(TaskLink.task_id == task.id))).scalars().all()
    )
    tl_targets: dict[UUID, Task] = {}
    if tl_rows:
        tl_targets = {
            rt.id: rt
            for rt in (
                await db.execute(
                    select(Task).where(Task.id.in_([r.linked_task_id for r in tl_rows]))
                )
            )
            .scalars()
            .all()
        }
    link_outs = [
        TaskLinkOut(
            id=lk.id,
            task_id=lk.task_id,
            linked_task_id=lk.linked_task_id,
            linked_task_code=tl_targets[lk.linked_task_id].task_code
            if lk.linked_task_id in tl_targets
            else "",
            linked_task_status=tl_targets[lk.linked_task_id].status
            if lk.linked_task_id in tl_targets
            else "",
            link_type=lk.link_type,
        )
        for lk in tl_rows
    ]

    users_map = {u.id: u for u in (await db.execute(select(User))).scalars().all()}

    from app.api.v1.project_entities import _product_out

    user_names = {uid: u.full_name for uid, u in users_map.items()}
    product_out: ProductOut | None = _product_out(task, user_names=user_names)

    vis_set = comment_visibilities_for_user(auth)
    comment_rows = (
        (
            await db.execute(
                select(TaskComment)
                .where(
                    TaskComment.task_id == task.id,
                    TaskComment.deleted_at.is_(None),
                    TaskComment.visibility.in_(vis_set),
                )
                .order_by(TaskComment.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    comments_out = [
        TaskCommentOut(
            id=c.id,
            task_id=c.task_id,
            author_id=c.author_id,
            author_username=users_map[c.author_id].username
            if c.author_id and c.author_id in users_map
            else None,
            author_full_name=users_map[c.author_id].full_name
            if c.author_id and c.author_id in users_map
            else None,
            parent_id=c.parent_id,
            kind=c.kind,
            visibility=cast(Literal["internal", "client"], c.visibility),
            body=c.body,
            version_id=c.version_id,
            file_id=c.file_id,
            annotation_id=c.annotation_id,
            frame=c.frame,
            review_decision=c.review_decision,
            created_at=c.created_at,
            edited_at=c.edited_at,
        )
        for c in comment_rows
    ]

    rev_rows = (
        (
            await db.execute(
                select(TaskReview)
                .where(TaskReview.task_id == task.id)
                .order_by(TaskReview.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    ver_labels: dict[UUID, str] = {}
    if task.product is not None:
        ver_labels = {v.id: v.label for v in task.product.versions}
    reviews_out = [
        TaskReviewOut(
            id=r.id,
            task_id=r.task_id,
            round_no=r.round_no,
            version_id=r.version_id,
            version_label=ver_labels.get(r.version_id) if r.version_id else None,
            stage=cast(Literal["lead", "sup", "client"], r.stage),
            decision=cast(Literal["pending", "approved", "retake"], r.decision),
            reviewer_id=r.reviewer_id,
            reviewer_name=users_map[r.reviewer_id].full_name
            if r.reviewer_id and r.reviewer_id in users_map
            else None,
            acted_as=r.acted_as,
            on_behalf_of=r.on_behalf_of,
            comment_id=r.comment_id,
            created_at=r.created_at,
        )
        for r in rev_rows
    ]

    ev_rows = (
        (
            await db.execute(
                select(TaskEvent)
                .where(TaskEvent.task_id == task.id)
                .order_by(TaskEvent.at.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    events_out = [
        TaskEventOut(
            id=ev.id,
            task_id=ev.task_id,
            at=ev.at,
            user_id=ev.user_id,
            username=users_map[ev.user_id].username
            if ev.user_id and ev.user_id in users_map
            else None,
            acted_as=ev.acted_as,
            source=cast(Literal["user", "rule", "system"], ev.source),
            field=ev.field,
            old_value=ev.old_value,
            new_value=ev.new_value,
        )
        for ev in ev_rows
    ]

    tl_log_rows = (
        (
            await db.execute(
                select(TimeLog)
                .where(TimeLog.task_id == task.id)
                .order_by(TimeLog.work_date.desc(), TimeLog.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    time_logs_out = [
        TimeLogOut(
            id=lg.id,
            task_id=lg.task_id,
            user_id=lg.user_id,
            username=users_map[lg.user_id].username
            if lg.user_id and lg.user_id in users_map
            else None,
            full_name=users_map[lg.user_id].full_name
            if lg.user_id and lg.user_id in users_map
            else None,
            work_date=lg.work_date,
            hours=lg.hours,
            note=lg.note,
            created_at=lg.created_at,
        )
        for lg in tl_log_rows
    ]

    return TaskDetailOut(
        **base.model_dump(),
        acted_as=acted_as,
        allowed_transitions=transitions,
        dependencies=up_outs,
        downstream=dn_outs,
        links=link_outs,
        product=product_out,
        reviews=reviews_out,
        comments=comments_out,
        events=events_out,
        time_logs=time_logs_out,
    )


async def _build_client_task_detail(
    db: AsyncSession,
    auth: AuthContext,
    task: Task,
) -> ClientTaskDetailOut:
    shared_vers = await client_shared_version_ids(db, auth.user.company_id)
    ent = await db.get(Entity, task.entity_id)
    dept = await db.get(Department, task.department_id)
    _, policy = await get_project_policy(db)
    trans_raw = await get_allowed_transitions_for_task(db, auth, task, policy)
    transitions = [
        TransitionOptionOut(
            to=str(o["to"]),
            action=str(o["action"]),
            acted_as=str(o["acted_as"]),
            on_behalf=bool(o["on_behalf"]),
            requires_comment=bool(o["requires_comment"]),
            requires_version=bool(o["requires_version"]),
        )
        for o in trans_raw
    ]

    comment_rows = (
        (
            await db.execute(
                select(TaskComment)
                .where(
                    TaskComment.task_id == task.id,
                    TaskComment.deleted_at.is_(None),
                    TaskComment.visibility == "client",
                )
                .order_by(TaskComment.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    users_map = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    comments = [
        ClientTaskCommentOut(
            id=c.id,
            task_id=c.task_id,
            author_full_name=users_map[c.author_id].full_name
            if c.author_id and c.author_id in users_map
            else None,
            kind=c.kind,
            visibility="client",
            body=c.body,
            version_id=c.version_id if c.version_id in shared_vers else None,
            file_id=c.file_id,
            frame=c.frame,
            review_decision=c.review_decision,
            created_at=c.created_at,
        )
        for c in comment_rows
    ]
    rev_rows = (
        (
            await db.execute(
                select(TaskReview)
                .where(TaskReview.task_id == task.id, TaskReview.stage == "client")
                .order_by(TaskReview.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    reviews = [
        ClientTaskReviewOut(
            id=r.id,
            round_no=r.round_no,
            version_id=r.version_id if r.version_id in shared_vers else None,
            stage=cast(Literal["lead", "sup", "client"], r.stage),
            decision=cast(Literal["pending", "approved", "retake"], r.decision),
            created_at=r.created_at,
        )
        for r in rev_rows
    ]
    return ClientTaskDetailOut(
        id=task.id,
        task_code=task.task_code,
        task_name=task.task_name,
        entity_id=task.entity_id,
        entity_name=ent.name if ent else "",
        department_name=dept.name if dept else "",
        status=task.status,
        ideal_finish_date=task.ideal_finish_date,
        description=task.description,
        product=_client_product_for_task(task, shared_vers),
        allowed_transitions=transitions,
        comments=comments,
        reviews=reviews,
    )


async def _ensure_task_visible_or_404(
    db: AsyncSession,
    auth: AuthContext,
    task_id: UUID,
) -> Task:
    task = await load_task_full(db, task_id)
    if auth.role.name == "client":
        vis = await visible_task_ids(db, auth, "task.view")
        if vis is not None and task.id not in vis:
            raise NotFoundError("task", str(task_id))
    else:
        await assert_can(db, auth, "task.view", task)
    return task


@router.get("/tasks", response_model=TaskListOut | ClientTaskListOut)
async def list_tasks_endpoint(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    status: str | None = None,
    priority: str | None = None,
    department_id: UUID | None = None,
    entity_id: UUID | None = None,
    entity_path_prefix: str | None = None,
    tag: str | None = None,
    company_id: UUID | None = None,
    user_id: UUID | None = None,
    role_name: str | None = None,
    my_capacity: Literal["artist", "lead", "supervisor"] | None = None,
    mine_only: bool = False,
    include_linked_entities: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    sort: Literal["code", "status", "priority", "due", "updated"] = "updated",
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> TaskListOut | ClientTaskListOut:
    meta, _ = await get_project_policy(db)
    is_client = auth.role.name == "client"
    visible_ids = await visible_task_ids(db, auth, "task.view")

    stmt = (
        select(Task).join(Entity, Entity.id == Task.entity_id).where(Entity.archived_at.is_(None))
    )
    if visible_ids is not None:
        if not visible_ids:
            return (
                ClientTaskListOut(items=[], total=0, next_cursor=None)
                if is_client
                else TaskListOut(items=[], total=0, next_cursor=None)
            )
        stmt = stmt.where(Task.id.in_(visible_ids))

    if status:
        vals = [s.strip() for s in status.split(",") if s.strip()]
        if vals:
            stmt = stmt.where(Task.status.in_(vals))
    if priority and not is_client:
        vals = [p.strip() for p in priority.split(",") if p.strip()]
        if vals:
            stmt = stmt.where(Task.priority.in_(vals))
    if department_id is not None:
        stmt = stmt.where(Task.department_id == department_id)
    if entity_id is not None:
        if include_linked_entities and not is_client:
            depth = meta.link_dependency_depth if meta else 1
            linked_ids = await get_linked_entity_ids(db, [entity_id], max_depth=depth)
            stmt = stmt.where(Task.entity_id.in_(linked_ids))
        else:
            stmt = stmt.where(Task.entity_id == entity_id)
    if entity_path_prefix and not is_client:
        clean_prefix = entity_path_prefix.strip().strip("/")
        if clean_prefix:
            stmt = stmt.where(
                or_(Entity.rel_path == clean_prefix, Entity.rel_path.startswith(f"{clean_prefix}/"))
            )
    if tag and not is_client:
        t_clean = tag.strip()
        stmt = stmt.where(
            or_(
                Task.id.in_(
                    select(TaskTag.task_id)
                    .join(Tag, Tag.id == TaskTag.tag_id)
                    .where(Tag.name == t_clean)
                ),
                Task.entity_id.in_(
                    select(EntityTag.entity_id)
                    .join(Tag, Tag.id == EntityTag.tag_id)
                    .where(Tag.name == t_clean)
                ),
            )
        )
    if company_id is not None and not is_client:
        comp_depts = select(CompanyDepartment.department_id).where(
            CompanyDepartment.company_id == company_id
        )
        comp_users = select(User.id).where(User.company_id == company_id)
        stmt = stmt.where(
            or_(
                Task.department_id.in_(comp_depts),
                Task.id.in_(
                    select(TaskAssignment.task_id).where(TaskAssignment.user_id.in_(comp_users))
                ),
            )
        )
    if user_id is not None and not is_client:
        assign_sub = select(TaskAssignment.task_id).where(TaskAssignment.user_id == user_id)
        if role_name:
            assign_sub = assign_sub.where(TaskAssignment.assignment_role == role_name)
        stmt = stmt.where(Task.id.in_(assign_sub))
    elif role_name and not is_client:
        stmt = stmt.where(
            Task.id.in_(
                select(TaskAssignment.task_id).where(TaskAssignment.assignment_role == role_name)
            )
        )
    if my_capacity is not None and not is_client:
        cap_tids = [tid for tid, caps in auth.my_task_capacities.items() if my_capacity in caps]
        if not cap_tids:
            return TaskListOut(items=[], total=0, next_cursor=None)
        stmt = stmt.where(Task.id.in_(cap_tids))
    elif mine_only and not is_client:
        if not auth.my_task_capacities:
            return TaskListOut(items=[], total=0, next_cursor=None)
        stmt = stmt.where(Task.id.in_(list(auth.my_task_capacities.keys())))

    if date_from is not None:
        stmt = stmt.where(
            or_(Task.ideal_finish_date >= date_from, Task.ideal_start_date >= date_from)
        )
    if date_to is not None:
        stmt = stmt.where(or_(Task.ideal_start_date <= date_to, Task.ideal_finish_date <= date_to))
    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Task.task_code.ilike(pat),
                Task.task_name.ilike(pat),
                Entity.name.ilike(pat),
                Task.description.ilike(pat),
            )
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = int((await db.execute(count_stmt)).scalar_one())

    if sort == "code":
        stmt = stmt.order_by(Task.task_code.asc(), Task.id.asc())
    elif sort == "status":
        stmt = stmt.order_by(Task.status.asc(), Task.task_code.asc(), Task.id.asc())
    elif sort == "priority":
        stmt = stmt.order_by(Task.priority.desc(), Task.task_code.asc(), Task.id.asc())
    elif sort == "due":
        stmt = stmt.order_by(Task.ideal_finish_date.asc(), Task.task_code.asc(), Task.id.asc())
    else:
        stmt = stmt.order_by(Task.updated_at.desc(), Task.id.asc())

    offset = 0
    if cursor is not None:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            offset = 0
    page_rows = list((await db.execute(stmt.offset(offset).limit(limit))).scalars().all())
    next_cursor = str(offset + limit) if (offset + len(page_rows)) < total else None

    if is_client:
        shared_vers = await client_shared_version_ids(db, auth.user.company_id)
        t_ids = [t.id for t in page_rows]
        full_tasks = (
            {
                ft.id: ft
                for ft in (await db.execute(select(Task).where(Task.id.in_(t_ids)))).scalars().all()
            }
            if t_ids
            else {}
        )
        ents = {
            e.id: e
            for e in (
                await db.execute(
                    select(Entity).where(Entity.id.in_({t.entity_id for t in page_rows}))
                )
            )
            .scalars()
            .all()
        }
        depts = {
            d.id: d
            for d in (
                await db.execute(
                    select(Department).where(
                        Department.id.in_({t.department_id for t in page_rows})
                    )
                )
            )
            .scalars()
            .all()
        }
        client_items: list[ClientTaskListItemOut] = []
        for t in page_rows:
            loaded = await load_task_full(db, t.id) if t.id in full_tasks else t
            ent = ents.get(loaded.entity_id)
            dept = depts.get(loaded.department_id)
            client_items.append(
                ClientTaskListItemOut(
                    id=loaded.id,
                    task_code=loaded.task_code,
                    task_name=loaded.task_name,
                    entity_id=loaded.entity_id,
                    entity_name=ent.name if ent else "",
                    department_name=dept.name if dept else "",
                    status=loaded.status,
                    ideal_finish_date=loaded.ideal_finish_date,
                    description=loaded.description,
                    product=_client_product_for_task(loaded, shared_vers),
                )
            )
        return ClientTaskListOut(items=client_items, total=total, next_cursor=next_cursor)

    items = await _hydrate_task_list_items(
        db, auth, page_rows, hours_per_day=meta.hours_per_day if meta else 8.0
    )
    return TaskListOut(items=items, total=total, next_cursor=next_cursor)


@router.post("/tasks", response_model=TaskDetailOut, status_code=201)
async def create_task_full_endpoint(
    payload: TaskCreateFullRequest,
    auth: Annotated[AuthContext, Depends(require("task.create", write=True))],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskDetailOut:
    ent = await db.get(Entity, payload.entity_id)
    if ent is None or ent.archived_at is not None:
        raise NotFoundError("entity", str(payload.entity_id))
    dept = await db.get(Department, payload.department_id)
    if dept is None or not dept.is_active:
        raise NotFoundError("department", str(payload.department_id))

    ed = (
        await db.execute(
            select(EntityDepartment).where(
                EntityDepartment.entity_id == ent.id,
                EntityDepartment.department_id == dept.id,
            )
        )
    ).scalar_one_or_none()
    if ed is None:
        ed = EntityDepartment(entity_id=ent.id, department_id=dept.id, sort_order=dept.sort_order)
        db.add(ed)
        await db.flush()

    created = await create_task_unified(
        db,
        ctx,
        entity=ent,
        ed=ed,
        dept=dept,
        name=payload.name,
        description=payload.description,
        priority=payload.priority,
        needs_lead_review=payload.needs_lead_review,
        needs_sup_review=payload.needs_sup_review,
        needs_client_review=payload.needs_client_review,
        bid_hours=payload.bid_hours,
        complexity_rating=payload.complexity_rating,
        ideal_start_date=payload.ideal_start_date,
        ideal_finish_date=payload.ideal_finish_date,
        actor_user_id=auth.user.id,
        acted_as=f"role:{auth.role.name}",
        source="user",
        commit=True,
    )
    from app.services.rules_engine import run_trigger_rules

    applied = await run_trigger_rules(
        db, "task_created", task_ids=[created.id], actor_user_id=auth.user.id
    )
    if applied > 0:
        await db.commit()
    loaded = await load_task_full(db, created.id)
    return await _build_task_detail_out(db, auth, loaded, acted_as=f"role:{auth.role.name}")


@router.post("/tasks/bulk", response_model=TaskBulkResponse)
async def bulk_update_tasks_endpoint(
    payload: TaskBulkRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskBulkResponse:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot perform bulk task updates", status_code=403)
    meta, _ = await get_project_policy(db)
    if meta is not None and meta.status == "archived" and auth.role.name != "admin":
        raise AppError("project_archived", "Archived project is read-only", status_code=403)

    results: list[TaskBulkRowResult] = []
    ok_count = 0
    error_count = 0
    ip = client_ip_from_request(request)

    nested = await db.begin_nested()
    try:
        for row in payload.rows:
            changes: list[str] = []
            task = (
                await db.execute(select(Task).where(Task.id == row.task_id))
            ).scalar_one_or_none()
            if task is None:
                results.append(
                    TaskBulkRowResult(
                        task_id=row.task_id, ok=False, error=f"Task '{row.task_id}' not found"
                    )
                )
                error_count += 1
                continue
            try:
                if row.priority is not None:
                    via = await assert_can(db, auth, "task.edit_fields", task)
                    old_p = task.priority
                    task.priority = row.priority
                    db.add(
                        TaskEvent(
                            task_id=task.id,
                            user_id=auth.user.id,
                            acted_as=via,
                            source="user",
                            field="priority",
                            old_value=old_p,
                            new_value=row.priority,
                        )
                    )
                    changes.append(f"priority:{old_p}->{row.priority}")

                if row.assignee_user_ids is not None:
                    await assert_can(db, auth, "task.assign", task)
                    await db.execute(
                        delete(TaskAssignment).where(
                            TaskAssignment.task_id == task.id,
                            TaskAssignment.assignment_role == row.assignee_role,
                        )
                    )
                    for uid in dict.fromkeys(row.assignee_user_ids):
                        u_obj = await db.get(User, uid)
                        if u_obj is None:
                            raise NotFoundError("user", str(uid))
                        db.add(
                            TaskAssignment(
                                task_id=task.id,
                                user_id=uid,
                                assignment_role=row.assignee_role,
                                source="manual",
                            )
                        )
                    changes.append(f"assign:{row.assignee_role}({len(row.assignee_user_ids)})")

                if row.status is not None and row.status != task.status:
                    loaded = await load_task_full(db, task.id)
                    old_st = loaded.status
                    await execute_task_transition(
                        db,
                        auth,
                        loaded,
                        target_status=row.status,
                        comment=row.comment,
                        client_ip=ip,
                    )
                    changes.append(f"status:{old_st}->{row.status}")

                results.append(
                    TaskBulkRowResult(
                        task_id=task.id, task_code=task.task_code, ok=True, changes=changes
                    )
                )
                ok_count += 1
            except AppError as exc:
                results.append(
                    TaskBulkRowResult(
                        task_id=task.id, task_code=task.task_code, ok=False, error=exc.message
                    )
                )
                error_count += 1

        if payload.dry_run or error_count > 0:
            await nested.rollback()
            applied = False
        else:
            await nested.commit()
            await db.commit()
            applied = True
    except Exception:
        await nested.rollback()
        raise

    return TaskBulkResponse(
        dry_run=payload.dry_run,
        applied=applied,
        ok_count=ok_count,
        error_count=error_count,
        results=results,
    )


@router.get("/tasks/graph", response_model=TaskGraphOut)
async def task_graph_endpoint(
    auth: Annotated[AuthContext, Depends(require("views.graph"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    task_id: UUID | None = None,
    entity_id: UUID | None = None,
    department_id: UUID | None = None,
    hops: Annotated[int, Query(ge=1, le=3)] = 2,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> TaskGraphOut:
    if auth.role.name == "client":
        raise AppError("forbidden", "Graph view is not available to clients", status_code=403)
    vis = await visible_task_ids(db, auth, "task.view")

    all_deps = (await db.execute(select(TaskDependency))).scalars().all()
    all_links = (await db.execute(select(TaskLink))).scalars().all()

    selected_ids: set[UUID] | None = None
    if task_id is not None:
        frontier: set[UUID] = {task_id}
        visited: set[UUID] = {task_id}
        adj: dict[UUID, set[UUID]] = {}
        for d in all_deps:
            adj.setdefault(d.upstream_task_id, set()).add(d.task_id)
            adj.setdefault(d.task_id, set()).add(d.upstream_task_id)
        for lk in all_links:
            adj.setdefault(lk.task_id, set()).add(lk.linked_task_id)
            adj.setdefault(lk.linked_task_id, set()).add(lk.task_id)
        for _ in range(hops):
            nxt: set[UUID] = set()
            for cur in frontier:
                for nb in adj.get(cur, set()):
                    if nb not in visited:
                        visited.add(nb)
                        nxt.add(nb)
            frontier = nxt
        selected_ids = visited

    stmt = (
        select(Task).join(Entity, Entity.id == Task.entity_id).where(Entity.archived_at.is_(None))
    )
    if vis is not None:
        stmt = stmt.where(Task.id.in_(vis))
    if selected_ids is not None:
        stmt = stmt.where(Task.id.in_(selected_ids))
    if entity_id is not None:
        stmt = stmt.where(Task.entity_id == entity_id)
    if department_id is not None:
        stmt = stmt.where(Task.department_id == department_id)

    tasks_all = list((await db.execute(stmt.order_by(Task.task_code.asc()))).scalars().all())
    truncated = len(tasks_all) > limit
    tasks_kept = tasks_all[:limit]
    kept_set = {t.id for t in tasks_kept}

    ents = {
        e.id: e
        for e in (
            await db.execute(select(Entity).where(Entity.id.in_({t.entity_id for t in tasks_kept})))
        )
        .scalars()
        .all()
    }
    depts = {
        d.id: d
        for d in (
            await db.execute(
                select(Department).where(Department.id.in_({t.department_id for t in tasks_kept}))
            )
        )
        .scalars()
        .all()
    }
    users = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    assigns_by_task: dict[UUID, list[TaskAssignmentOut]] = {}
    if kept_set:
        for ta in (
            (await db.execute(select(TaskAssignment).where(TaskAssignment.task_id.in_(kept_set))))
            .scalars()
            .all()
        ):
            u = users.get(ta.user_id)
            if u is None:
                continue
            assigns_by_task.setdefault(ta.task_id, []).append(
                TaskAssignmentOut(
                    user_id=u.id,
                    username=u.username,
                    full_name=u.full_name,
                    avatar_file=u.avatar_file,
                    assignment_role=cast(
                        Literal["artist", "lead", "supervisor"], ta.assignment_role
                    ),
                    source=ta.source,
                )
            )

    nodes = [
        TaskGraphNodeOut(
            id=t.id,
            task_code=t.task_code,
            task_name=t.task_name,
            status=t.status,
            entity_name=ents[t.entity_id].name if t.entity_id in ents else "",
            department_name=depts[t.department_id].name if t.department_id in depts else "",
            department_color=depts[t.department_id].color
            if t.department_id in depts
            else "--series-1",
            assignees=assigns_by_task.get(t.id, []),
        )
        for t in tasks_kept
    ]
    edges: list[TaskGraphEdgeOut] = []
    for d in all_deps:
        if d.upstream_task_id in kept_set and d.task_id in kept_set:
            edges.append(
                TaskGraphEdgeOut(
                    source_task_id=d.upstream_task_id,
                    target_task_id=d.task_id,
                    kind="dependency",
                    threshold=d.threshold,
                    from_entity_link=d.from_entity_link,
                )
            )
    for lk in all_links:
        if lk.task_id in kept_set and lk.linked_task_id in kept_set:
            edges.append(
                TaskGraphEdgeOut(
                    source_task_id=lk.task_id,
                    target_task_id=lk.linked_task_id,
                    kind="link",
                )
            )
    return TaskGraphOut(nodes=nodes, edges=edges, truncated=truncated)


@router.get("/workload", response_model=WorkloadResponse)
async def workload_endpoint(
    auth: Annotated[AuthContext, Depends(require("views.workload"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
    department_id: UUID | None = None,
    company_id: UUID | None = None,
) -> WorkloadResponse:
    if auth.role.name == "client":
        raise AppError("forbidden", "Workload view is not available to clients", status_code=403)
    meta, _ = await get_project_policy(db)
    today_utc = datetime.now(UTC).date()
    d_from = date_from or (today_utc - timedelta(days=2))
    d_to = date_to or (today_utc + timedelta(days=14))
    working_days = set(meta.working_days) if meta and meta.working_days else {1, 2, 3, 4, 5}

    u_stmt = select(User).where(User.is_active.is_(True)).order_by(User.full_name.asc())
    if company_id is not None:
        u_stmt = u_stmt.where(User.company_id == company_id)
    users = list((await db.execute(u_stmt)).scalars().all())
    u_ids = {u.id for u in users}

    ud_rows = (await db.execute(select(User.id))).all()
    _ = ud_rows
    from app.models.user import UserDepartment

    user_depts_map: dict[UUID, list[UUID]] = {}
    for ud in (await db.execute(select(UserDepartment))).scalars().all():
        user_depts_map.setdefault(ud.user_id, []).append(ud.department_id)

    if department_id is not None:
        users = [u for u in users if department_id in user_depts_map.get(u.id, [])]
        u_ids = {u.id for u in users}

    w_users = [
        WorkloadUserInput(
            id=u.id,
            username=u.username,
            full_name=u.full_name,
            daily_capacity_hours=u.daily_capacity_hours,
            company_id=u.company_id,
            department_ids=tuple(user_depts_map.get(u.id, [])),
        )
        for u in users
    ]

    vis = await visible_task_ids(db, auth, "task.view")
    t_stmt = (
        select(Task).join(Entity, Entity.id == Task.entity_id).where(Entity.archived_at.is_(None))
    )
    if vis is not None:
        t_stmt = t_stmt.where(Task.id.in_(vis))
    if department_id is not None:
        t_stmt = t_stmt.where(Task.department_id == department_id)
    tasks = list((await db.execute(t_stmt)).scalars().all())
    t_by_id = {t.id: t for t in tasks}

    artist_assigns: dict[UUID, list[UUID]] = {}
    if t_by_id:
        for ta in (
            (
                await db.execute(
                    select(TaskAssignment).where(
                        TaskAssignment.task_id.in_(list(t_by_id.keys())),
                        TaskAssignment.assignment_role == "artist",
                    )
                )
            )
            .scalars()
            .all()
        ):
            if ta.user_id in u_ids:
                artist_assigns.setdefault(ta.task_id, []).append(ta.user_id)

    w_tasks = [
        WorkloadTaskInput(
            id=t.id,
            task_code=t.task_code,
            status=t.status,
            department_id=t.department_id,
            ideal_start_date=t.ideal_start_date,
            ideal_finish_date=t.ideal_finish_date,
            bid_hours=t.bid_hours,
            logged_hours=t.logged_hours,
            artist_user_ids=tuple(artist_assigns.get(t.id, [])),
        )
        for t in tasks
    ]

    logs = (
        (
            await db.execute(
                select(TimeLog).where(
                    TimeLog.work_date >= d_from,
                    TimeLog.work_date <= d_to,
                )
            )
        )
        .scalars()
        .all()
    )
    w_logs = [
        WorkloadTimeLogInput(
            task_id=lg.task_id,
            user_id=lg.user_id,
            work_date=lg.work_date,
            hours=lg.hours,
        )
        for lg in logs
        if lg.user_id is not None
    ]

    grid = compute_workload_grid(
        w_users,
        w_tasks,
        w_logs,
        date_from=d_from,
        date_to=d_to,
        working_days=working_days,
        today=today_utc,
    )
    unsched_tasks = [t_by_id[tid] for tid in grid.unscheduled_task_ids if tid in t_by_id]
    unsched_items = await _hydrate_task_list_items(
        db, auth, unsched_tasks, hours_per_day=meta.hours_per_day if meta else 8.0
    )
    return WorkloadResponse(
        days=grid.days,
        rows=[
            WorkloadRowSchema(
                user_id=r.user_id,
                username=r.username,
                full_name=r.full_name,
                daily_capacity_hours=r.daily_capacity_hours,
                cells=[
                    WorkloadCellSchema(
                        day=c.day,
                        hours=c.hours,
                        capacity_hours=c.capacity_hours,
                        utilization_pct=c.utilization_pct,
                        contributing_task_ids=c.contributing_task_ids,
                    )
                    for c in r.cells
                ],
            )
            for r in grid.rows
        ],
        unscheduled_tasks=unsched_items,
    )


async def _compute_review_queue(
    db: AsyncSession, auth: AuthContext
) -> list[ReviewQueueItemOut] | list[ClientReviewQueueItemOut]:
    vis = await visible_task_ids(db, auth, "task.view")
    stmt = (
        select(Task)
        .join(Entity, Entity.id == Task.entity_id)
        .where(
            Entity.archived_at.is_(None),
            Task.status.in_(("P_LEAD", "P_SUP", "P_CLIENT")),
        )
    )
    if vis is not None:
        if not vis:
            return []
        stmt = stmt.where(Task.id.in_(vis))
    candidates = list((await db.execute(stmt)).scalars().all())
    if not candidates:
        return []

    cand_ids = [t.id for t in candidates]
    ents = {
        e.id: e
        for e in (
            await db.execute(select(Entity).where(Entity.id.in_({t.entity_id for t in candidates})))
        )
        .scalars()
        .all()
    }
    depts = {
        d.id: d
        for d in (
            await db.execute(
                select(Department).where(Department.id.in_({t.department_id for t in candidates}))
            )
        )
        .scalars()
        .all()
    }
    users_map = {u.id: u for u in (await db.execute(select(User))).scalars().all()}

    pending_revs = (
        (
            await db.execute(
                select(TaskReview)
                .where(TaskReview.task_id.in_(cand_ids), TaskReview.decision == "pending")
                .order_by(TaskReview.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    latest_rev_by_task: dict[UUID, TaskReview] = {}
    for pr in pending_revs:
        if pr.task_id not in latest_rev_by_task:
            latest_rev_by_task[pr.task_id] = pr

    now = datetime.now(UTC)
    shared_vers = (
        await client_shared_version_ids(db, auth.user.company_id)
        if auth.role.name == "client"
        else set()
    )

    stage_perm = {
        "P_LEAD": "task.approve.lead",
        "P_SUP": "task.approve.sup",
        "P_CLIENT": "task.approve.client",
    }

    internal_items: list[ReviewQueueItemOut] = []
    client_items: list[ClientReviewQueueItemOut] = []
    for t in candidates:
        perm_key = stage_perm.get(t.status)
        if perm_key is None:
            continue
        allowed, via = await can(db, auth, perm_key, t)
        if not allowed or via is None:
            continue

        rv = latest_rev_by_task.get(t.id)
        sub_vid = rv.version_id if rv and rv.version_id else t.latest_version_id
        sub_label: str | None = None
        thumb_fid: UUID | None = None
        if sub_vid is not None and (auth.role.name != "client" or sub_vid in shared_vers):
            pv = await db.get(ProductVersion, sub_vid)
            if pv is not None:
                sub_label = pv.label
            fe = (
                await db.execute(
                    select(FileEntry)
                    .where(
                        FileEntry.product_version_id == sub_vid,
                        FileEntry.media_kind.in_(("image2d", "video")),
                    )
                    .order_by(FileEntry.filename.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if fe is not None:
                thumb_fid = fe.id

        submitted_at = rv.created_at if rv is not None else t.updated_at
        if submitted_at.tzinfo is None:
            submitted_at = submitted_at.replace(tzinfo=UTC)
        wait_hours = round(max(0.0, (now - submitted_at).total_seconds() / 3600.0), 1)
        ent = ents.get(t.entity_id)
        dept = depts.get(t.department_id)
        on_behalf = t.status == "P_CLIENT" and auth.role.name in {"producer", "admin"}

        if auth.role.name == "client":
            client_items.append(
                ClientReviewQueueItemOut(
                    task_id=t.id,
                    task_code=t.task_code,
                    task_name=t.task_name,
                    entity_id=t.entity_id,
                    entity_name=ent.name if ent else "",
                    department_name=dept.name if dept else "",
                    status=t.status,
                    submitted_version_id=sub_vid if sub_vid in shared_vers else None,
                    submitted_version_label=sub_label,
                    thumbnail_file_id=thumb_fid,
                    submitted_at=submitted_at,
                    wait_hours=wait_hours,
                    can_act_as=via,
                )
            )
        else:
            submitter_name = (
                users_map[rv.reviewer_id].full_name
                if rv is not None and rv.reviewer_id and rv.reviewer_id in users_map
                else None
            )
            internal_items.append(
                ReviewQueueItemOut(
                    task_id=t.id,
                    task_code=t.task_code,
                    task_name=t.task_name,
                    entity_id=t.entity_id,
                    entity_name=ent.name if ent else "",
                    department_name=dept.name if dept else "",
                    status=t.status,
                    submitted_version_id=sub_vid,
                    submitted_version_label=sub_label,
                    thumbnail_file_id=thumb_fid,
                    submitter_name=submitter_name,
                    submitted_at=submitted_at,
                    wait_hours=wait_hours,
                    can_act_as="on_behalf" if on_behalf else via,
                    on_behalf=on_behalf,
                )
            )

    if auth.role.name == "client":
        client_items.sort(key=lambda x: x.submitted_at)
        return client_items
    internal_items.sort(key=lambda x: x.submitted_at)
    return internal_items


@router.get(
    "/review-queue", response_model=list[ReviewQueueItemOut] | list[ClientReviewQueueItemOut]
)
async def review_queue_endpoint(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ReviewQueueItemOut] | list[ClientReviewQueueItemOut]:
    return await _compute_review_queue(db, auth)


@router.get("/my/tasks", response_model=MyTasksResponse)
async def my_tasks_endpoint(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MyTasksResponse:
    if auth.role.name == "client":
        raise AppError("forbidden", "Use Review Queue or shared Tasks view", status_code=403)
    meta, _ = await get_project_policy(db)
    assigned_ids = list(auth.my_task_capacities.keys())
    my_tasks: list[Task] = []
    if assigned_ids:
        my_tasks = list(
            (
                await db.execute(
                    select(Task)
                    .join(Entity, Entity.id == Task.entity_id)
                    .where(Entity.archived_at.is_(None), Task.id.in_(assigned_ids))
                    .order_by(Task.ideal_finish_date.asc(), Task.task_code.asc())
                )
            )
            .scalars()
            .all()
        )
    items = await _hydrate_task_list_items(
        db, auth, my_tasks, hours_per_day=meta.hours_per_day if meta else 8.0
    )
    to_review = cast(list[ReviewQueueItemOut], await _compute_review_queue(db, auth))
    return MyTasksResponse(tasks=items, to_review=to_review)


@router.get("/saved-views", response_model=list[SavedViewOut])
async def list_saved_views(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    view_kind: str | None = None,
) -> list[SavedViewOut]:
    stmt = select(SavedView).where(SavedView.user_id == auth.user.id)
    if view_kind:
        stmt = stmt.where(SavedView.view_kind == view_kind)
    rows = (await db.execute(stmt.order_by(SavedView.name.asc()))).scalars().all()
    return [
        SavedViewOut(
            id=r.id,
            view_kind=r.view_kind,
            name=r.name,
            config_json=r.config_json,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("/saved-views", response_model=SavedViewOut, status_code=201)
async def create_saved_view(
    payload: SavedViewCreateRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SavedViewOut:
    meta, _ = await get_project_policy(db)
    if meta is not None and meta.status == "archived" and auth.role.name != "admin":
        raise AppError("project_archived", "Archived project is read-only", status_code=403)
    row = SavedView(
        user_id=auth.user.id,
        view_kind=payload.view_kind.strip(),
        name=payload.name.strip(),
        config_json=payload.config_json,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return SavedViewOut(
        id=row.id,
        view_kind=row.view_kind,
        name=row.name,
        config_json=row.config_json,
        updated_at=row.updated_at,
    )


@router.delete("/saved-views/{view_id}", status_code=204)
async def delete_saved_view(
    view_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    row = await db.get(SavedView, view_id)
    if row is None or row.user_id != auth.user.id:
        raise NotFoundError("saved_view", str(view_id))
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)


@router.get("/tasks/{task_id}", response_model=TaskDetailOut | ClientTaskDetailOut)
async def get_task_detail_endpoint(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskDetailOut | ClientTaskDetailOut:
    task = await _ensure_task_visible_or_404(db, auth, task_id)
    if auth.role.name == "client":
        return await _build_client_task_detail(db, auth, task)
    return await _build_task_detail_out(db, auth, task)


@router.patch("/tasks/{task_id}", response_model=TaskDetailOut)
async def patch_task_endpoint(
    task_id: UUID,
    payload: TaskPatchRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskDetailOut:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot edit task fields", status_code=403)
    meta, _ = await get_project_policy(db)
    if meta is not None and meta.status == "archived" and auth.role.name != "admin":
        raise AppError("project_archived", "Archived project is read-only", status_code=403)

    if payload.status is not None:
        raise AppError(
            "validation_error",
            "Task status changes must go through POST /tasks/{id}/transition",
            status_code=400,
        )

    task = await load_task_full(db, task_id)

    if payload.expected_updated_at is not None:
        cur_ts = (
            task.updated_at.replace(tzinfo=UTC)
            if task.updated_at.tzinfo is None
            else task.updated_at.astimezone(UTC)
        )
        exp_ts = (
            payload.expected_updated_at.replace(tzinfo=UTC)
            if payload.expected_updated_at.tzinfo is None
            else payload.expected_updated_at.astimezone(UTC)
        )
        if abs((cur_ts - exp_ts).total_seconds()) > 0.5:
            raise ConflictError("Task has been modified by someone else; reload before saving")

    fields_set = payload.model_fields_set
    schedule_keys = {"ideal_start_date", "ideal_finish_date"}
    admin_keys = {"task_code"}
    field_keys = {
        "name",
        "sort_order",
        "task_name",
        "description",
        "priority",
        "needs_lead_review",
        "needs_sup_review",
        "needs_client_review",
        "complexity_rating",
        "bid_hours",
    }

    acted_via: str | None = None
    if fields_set & admin_keys:
        if auth.role.name != "admin":
            raise AppError("forbidden", "Only administrators may modify task_code", status_code=403)
        acted_via = "role:admin"
    if fields_set & schedule_keys:
        acted_via = await assert_can(db, auth, "task.edit_schedule", task)
    if fields_set & field_keys:
        acted_via = await assert_can(db, auth, "task.edit_fields", task)

    if payload.name is not None and payload.name != task.name:
        old_name = task.name
        await rename_task(db, ctx, task_id, payload.name)
        task = await load_task_full(db, task_id)
        db.add(
            TaskEvent(
                task_id=task.id,
                user_id=auth.user.id,
                acted_as=acted_via or f"role:{auth.role.name}",
                source="user",
                field="name",
                old_value=old_name,
                new_value=task.name,
            )
        )

    def _record(field: str, old: object, new: object) -> None:
        if old != new:
            db.add(
                TaskEvent(
                    task_id=task.id,
                    user_id=auth.user.id,
                    acted_as=acted_via or f"role:{auth.role.name}",
                    source="user",
                    field=field,
                    old_value=None if old is None else str(old),
                    new_value=None if new is None else str(new),
                )
            )

    if "task_code" in fields_set and payload.task_code is not None:
        clean_code = payload.task_code.strip()
        if not clean_code:
            raise AppError("validation_error", "task_code cannot be empty", 400)
        dup_code = (
            await db.execute(select(Task).where(Task.task_code == clean_code, Task.id != task.id))
        ).scalar_one_or_none()
        if dup_code is not None:
            raise ConflictError(f"task_code '{clean_code}' is already in use")
        _record("task_code", task.task_code, clean_code)
        task.task_code = clean_code
    if "task_name" in fields_set and payload.task_name is not None:
        _record("task_name", task.task_name, payload.task_name.strip())
        task.task_name = payload.task_name.strip()
    if "description" in fields_set and payload.description is not None:
        _record("description", task.description, payload.description)
        task.description = payload.description
    if "sort_order" in fields_set and payload.sort_order is not None:
        _record("sort_order", task.sort_order, payload.sort_order)
        task.sort_order = payload.sort_order
    if "priority" in fields_set and payload.priority is not None:
        _record("priority", task.priority, payload.priority)
        task.priority = payload.priority
    if "needs_lead_review" in fields_set and payload.needs_lead_review is not None:
        _record("needs_lead_review", task.needs_lead_review, payload.needs_lead_review)
        task.needs_lead_review = payload.needs_lead_review
    if "needs_sup_review" in fields_set and payload.needs_sup_review is not None:
        _record("needs_sup_review", task.needs_sup_review, payload.needs_sup_review)
        task.needs_sup_review = payload.needs_sup_review
    if "needs_client_review" in fields_set and payload.needs_client_review is not None:
        _record("needs_client_review", task.needs_client_review, payload.needs_client_review)
        task.needs_client_review = payload.needs_client_review
    if "complexity_rating" in fields_set:
        _record("complexity_rating", task.complexity_rating, payload.complexity_rating)
        task.complexity_rating = payload.complexity_rating
    if "bid_hours" in fields_set:
        _record("bid_hours", task.bid_hours, payload.bid_hours)
        task.bid_hours = payload.bid_hours
    if "ideal_start_date" in fields_set:
        _record("ideal_start_date", task.ideal_start_date, payload.ideal_start_date)
        task.ideal_start_date = payload.ideal_start_date
    if "ideal_finish_date" in fields_set:
        _record("ideal_finish_date", task.ideal_finish_date, payload.ideal_finish_date)
        task.ideal_finish_date = payload.ideal_finish_date

    await db.commit()
    loaded = await load_task_full(db, task.id)
    return await _build_task_detail_out(db, auth, loaded, acted_as=acted_via)


@router.post("/tasks/{task_id}/transition", response_model=TaskDetailOut | ClientTaskDetailOut)
async def transition_task_endpoint(
    task_id: UUID,
    payload: TaskTransitionRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskDetailOut | ClientTaskDetailOut:
    task = await _ensure_task_visible_or_404(db, auth, task_id)
    target = payload.to.strip()
    if target not in TASK_STATUSES:
        raise AppError("invalid_transition", f"Unknown status '{target}'", 400)

    _, acted_as = await execute_task_transition(
        db,
        auth,
        task,
        target_status=target,
        version_id=payload.version_id,
        comment=payload.comment,
        client_ip=client_ip_from_request(request),
    )
    await db.commit()
    loaded = await load_task_full(db, task_id)
    if auth.role.name == "client":
        return await _build_client_task_detail(db, auth, loaded)
    return await _build_task_detail_out(db, auth, loaded, acted_as=acted_as)


@router.put("/tasks/{task_id}/dependencies", response_model=list[TaskDependencyOut])
async def put_task_dependencies_endpoint(
    task_id: UUID,
    payload: TaskDependenciesPutRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TaskDependencyOut]:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot edit task dependencies", status_code=403)
    task = await load_task_full(db, task_id)
    await assert_can(db, auth, "task.dependencies", task)
    await set_task_dependencies(
        db,
        auth,
        task,
        [(d.upstream_task_id, d.threshold, d.from_entity_link) for d in payload.dependencies],
    )
    await db.commit()
    detail = await _build_task_detail_out(db, auth, await load_task_full(db, task_id))
    return detail.dependencies


@router.put("/tasks/{task_id}/links", response_model=list[TaskLinkOut])
async def put_task_links_endpoint(
    task_id: UUID,
    payload: TaskLinksPutRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TaskLinkOut]:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot edit task links", status_code=403)
    task = await load_task_full(db, task_id)
    await assert_can(db, auth, "task.edit_fields", task)

    await db.execute(delete(TaskLink).where(TaskLink.task_id == task.id))
    for item in payload.links:
        if item.linked_task_id == task.id:
            raise AppError("validation_error", "Task cannot link to itself", 400)
        target_task = await db.get(Task, item.linked_task_id)
        if target_task is None:
            raise NotFoundError("task", str(item.linked_task_id))
        db.add(
            TaskLink(
                task_id=task.id,
                linked_task_id=item.linked_task_id,
                link_type=item.link_type.strip() if item.link_type else None,
            )
        )
    await db.commit()
    detail = await _build_task_detail_out(db, auth, await load_task_full(db, task_id))
    return detail.links


@router.put("/tasks/{task_id}/tags", response_model=list[str])
async def put_task_tags_endpoint(
    task_id: UUID,
    payload: TaskTagsPutRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[str]:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot edit task tags", status_code=403)
    task = await load_task_full(db, task_id)
    await assert_can(db, auth, "task.edit_fields", task)
    tags = await replace_task_tags(db, auth, task, payload.tags)
    await db.commit()
    return tags


@router.get(
    "/tasks/{task_id}/comments", response_model=list[TaskCommentOut] | list[ClientTaskCommentOut]
)
async def list_task_comments_endpoint(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TaskCommentOut] | list[ClientTaskCommentOut]:
    task = await _ensure_task_visible_or_404(db, auth, task_id)
    if auth.role.name == "client":
        detail = await _build_client_task_detail(db, auth, task)
        return detail.comments
    full = await _build_task_detail_out(db, auth, task)
    return full.comments


@router.post(
    "/tasks/{task_id}/comments",
    response_model=TaskCommentOut | ClientTaskCommentOut,
    status_code=201,
)
async def create_task_comment_endpoint(
    task_id: UUID,
    payload: TaskCommentCreateRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TaskCommentOut | ClientTaskCommentOut:
    task = await _ensure_task_visible_or_404(db, auth, task_id)
    meta, _ = await get_project_policy(db)
    if meta is not None and meta.status == "archived" and auth.role.name != "admin":
        raise AppError("project_archived", "Archived project is read-only", status_code=403)

    row = await create_task_comment(
        db,
        auth,
        task,
        body=payload.body,
        kind=payload.kind,
        visibility=payload.visibility,
        parent_id=payload.parent_id,
        version_id=payload.version_id,
        file_id=payload.file_id,
        annotation_id=payload.annotation_id,
        frame=payload.frame,
    )
    await db.commit()
    await db.refresh(row)
    if auth.role.name == "client":
        return ClientTaskCommentOut(
            id=row.id,
            task_id=row.task_id,
            author_full_name=auth.user.full_name,
            kind=row.kind,
            visibility="client",
            body=row.body,
            version_id=row.version_id,
            file_id=row.file_id,
            frame=row.frame,
            review_decision=row.review_decision,
            created_at=row.created_at,
        )
    return TaskCommentOut(
        id=row.id,
        task_id=row.task_id,
        author_id=row.author_id,
        author_username=auth.user.username,
        author_full_name=auth.user.full_name,
        parent_id=row.parent_id,
        kind=row.kind,
        visibility=cast(Literal["internal", "client"], row.visibility),
        body=row.body,
        version_id=row.version_id,
        file_id=row.file_id,
        annotation_id=row.annotation_id,
        frame=row.frame,
        review_decision=row.review_decision,
        created_at=row.created_at,
        edited_at=row.edited_at,
    )


@router.get("/tasks/{task_id}/events", response_model=list[TaskEventOut])
async def list_task_events_endpoint(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TaskEventOut]:
    if auth.role.name == "client":
        raise NotFoundError("task", str(task_id))
    task = await _ensure_task_visible_or_404(db, auth, task_id)
    detail = await _build_task_detail_out(db, auth, task)
    return detail.events


@router.get("/tasks/{task_id}/time-logs", response_model=list[TimeLogOut])
async def list_time_logs_endpoint(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TimeLogOut]:
    if auth.role.name == "client":
        raise NotFoundError("task", str(task_id))
    task = await _ensure_task_visible_or_404(db, auth, task_id)
    detail = await _build_task_detail_out(db, auth, task)
    return detail.time_logs


@router.post("/tasks/{task_id}/time-logs", response_model=TimeLogOut, status_code=201)
async def create_time_log_endpoint(
    task_id: UUID,
    payload: TimeLogCreateRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TimeLogOut:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot log time", status_code=403)
    task = await load_task_full(db, task_id)
    via = await assert_can(db, auth, "task.log_time", task)
    w_date = payload.work_date or datetime.now(UTC).date()
    log = TimeLog(
        task_id=task.id,
        user_id=auth.user.id,
        work_date=w_date,
        hours=payload.hours,
        note=payload.note.strip(),
    )
    db.add(log)
    await db.flush()
    old_total = task.logged_hours
    new_total = await recompute_logged_hours(db, task)
    db.add(
        TaskEvent(
            task_id=task.id,
            user_id=auth.user.id,
            acted_as=via,
            source="user",
            field="logged_hours",
            old_value=str(old_total),
            new_value=str(new_total),
        )
    )
    await db.commit()
    await db.refresh(log)
    return TimeLogOut(
        id=log.id,
        task_id=log.task_id,
        user_id=log.user_id,
        username=auth.user.username,
        full_name=auth.user.full_name,
        work_date=log.work_date,
        hours=log.hours,
        note=log.note,
        created_at=log.created_at,
    )


@router.delete("/tasks/{task_id}/time-logs/{log_id}", status_code=204)
async def delete_time_log_endpoint(
    task_id: UUID,
    log_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot delete time logs", status_code=403)
    task = await load_task_full(db, task_id)
    via = await assert_can(db, auth, "task.log_time", task)
    log = await db.get(TimeLog, log_id)
    if log is None or log.task_id != task.id:
        raise NotFoundError("time_log", str(log_id))
    if log.user_id != auth.user.id:
        await assert_can(db, auth, "task.edit_fields", task)

    old_total = task.logged_hours
    await db.delete(log)
    await db.flush()
    new_total = await recompute_logged_hours(db, task)
    db.add(
        TaskEvent(
            task_id=task.id,
            user_id=auth.user.id,
            acted_as=via,
            source="user",
            field="logged_hours",
            old_value=str(old_total),
            new_value=str(new_total),
        )
    )
    await db.commit()
    return Response(status_code=204)
