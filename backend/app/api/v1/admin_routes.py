from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_db, get_project_context
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.project_registry import ProjectContext
from app.core.security import (
    client_ip_from_request,
    get_project_auth,
    require,
    require_not_archived,
)
from app.models.project_db import Product, ProductVersion, ProjectMeta, Task
from app.models.user import (
    AuditLog,
    CapacityPermission,
    Company,
    Role,
    RolePermission,
    TaskAssignment,
    TaskShare,
    User,
    VersionShare,
)
from app.schemas.api import (
    AuditLogOut,
    CapacityPermissionsOut,
    CapacityPermissionsPutRequest,
    ProjectSettingsOut,
    ProjectSettingsPatchRequest,
    RoleCreateRequest,
    RoleOut,
    RolePermissionsPutRequest,
    RoleUpdateRequest,
    TaskAssignmentOut,
    TaskAssignmentsPutRequest,
    TaskSharesPutRequest,
    VersionSharesPutRequest,
)
from app.services.auth_service import write_audit
from app.services.permissions import ALL_PERMISSION_KEYS, VALID_CAPACITIES, AuthContext, assert_can

router = APIRouter(tags=["admin"])


def _role_to_out(r: Role) -> RoleOut:
    perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    for rp in r.permissions:
        perms[rp.permission_key] = rp.scope
    return RoleOut(
        id=r.id, name=r.name, label=r.label, rank=r.rank, is_system=r.is_system, permissions=perms
    )


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[RoleOut]:
    if not auth.has_any_scope("user.view") and not auth.has_any_scope("role.manage"):
        raise AppError("forbidden", "Missing permission to view roles", status_code=403)
    roles = (
        (
            await db.execute(
                select(Role)
                .options(selectinload(Role.permissions))
                .order_by(Role.rank.desc(), Role.name.asc())
            )
        )
        .scalars()
        .all()
    )
    return [_role_to_out(r) for r in roles]


@router.post("/roles", response_model=RoleOut, status_code=201)
async def create_role(
    payload: RoleCreateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("role.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoleOut:
    name = payload.name.strip().lower().replace(" ", "_")
    label = payload.label.strip()
    if not name or not label:
        raise AppError("invalid_request", "Role name and label are required", status_code=400)
    existing = (await db.execute(select(Role).where(Role.name == name))).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Role '{name}' already exists")

    role = Role(name=name, label=label, rank=payload.rank, is_system=False)
    db.add(role)
    await db.flush()
    for k in ALL_PERMISSION_KEYS:
        db.add(RolePermission(role_id=role.id, permission_key=k, scope="none"))
    await write_audit(
        db,
        user_id=auth.user.id,
        action="role.created",
        target_type="role",
        target_id=str(role.id),
        ip=client_ip_from_request(request),
        detail={"name": name, "label": label},
    )
    await db.commit()
    loaded = (
        await db.execute(
            select(Role)
            .where(Role.id == role.id)
            .options(selectinload(Role.permissions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return _role_to_out(loaded)


@router.patch("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: UUID,
    payload: RoleUpdateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("role.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoleOut:
    role = (
        await db.execute(
            select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    if role is None:
        raise NotFoundError("role", str(role_id))
    if payload.label is not None:
        role.label = payload.label.strip() or role.label
    if payload.rank is not None:
        role.rank = payload.rank
    await write_audit(
        db,
        user_id=auth.user.id,
        action="role.updated",
        target_type="role",
        target_id=str(role.id),
        ip=client_ip_from_request(request),
        detail={"label": role.label, "rank": role.rank},
    )
    await db.commit()
    return _role_to_out(role)


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("role.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    role = await db.get(Role, role_id)
    if role is None:
        raise NotFoundError("role", str(role_id))
    if role.is_system:
        raise AppError("forbidden", "System roles cannot be deleted", status_code=403)
    in_use = (await db.execute(select(User.id).where(User.role_id == role_id))).first()
    if in_use is not None:
        raise ConflictError("Cannot delete a role while users are assigned to it")
    await write_audit(
        db,
        user_id=auth.user.id,
        action="role.deleted",
        target_type="role",
        target_id=str(role_id),
        ip=client_ip_from_request(request),
        detail={"name": role.name},
    )
    await db.delete(role)
    await db.commit()
    return Response(status_code=204)


@router.put("/roles/{role_id}/permissions", response_model=RoleOut)
async def put_role_permissions(
    role_id: UUID,
    payload: RolePermissionsPutRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("role.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoleOut:
    role = (
        await db.execute(
            select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    if role is None:
        raise NotFoundError("role", str(role_id))
    if role.name == "admin":
        raise AppError(
            "forbidden", "Administrator role permissions are locked to all", status_code=403
        )

    valid_keys = set(ALL_PERMISSION_KEYS)
    await db.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
    for k in ALL_PERMISSION_KEYS:
        scope = payload.permissions.get(k, "none")
        if k in valid_keys:
            db.add(RolePermission(role_id=role.id, permission_key=k, scope=scope))

    await write_audit(
        db,
        user_id=auth.user.id,
        action="role.permissions_updated",
        target_type="role",
        target_id=str(role.id),
        ip=client_ip_from_request(request),
        detail={"role": role.name},
    )
    await db.commit()
    loaded = (
        await db.execute(
            select(Role)
            .where(Role.id == role.id)
            .options(selectinload(Role.permissions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return _role_to_out(loaded)


@router.get("/capacities", response_model=CapacityPermissionsOut)
async def get_capacity_permissions(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CapacityPermissionsOut:
    _ = auth
    rows = (await db.execute(select(CapacityPermission))).scalars().all()
    grouped: dict[str, list[str]] = {c: [] for c in VALID_CAPACITIES}
    for row in rows:
        grouped.setdefault(row.assignment_role, []).append(row.permission_key)
    return CapacityPermissionsOut(
        artist=sorted(grouped["artist"]),
        lead=sorted(grouped["lead"]),
        supervisor=sorted(grouped["supervisor"]),
    )


@router.put("/capacities", response_model=CapacityPermissionsOut)
async def put_capacity_permissions(
    payload: CapacityPermissionsPutRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("role.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CapacityPermissionsOut:
    valid_keys = set(ALL_PERMISSION_KEYS)
    await db.execute(delete(CapacityPermission))
    out: dict[str, list[str]] = {}
    for cap, perms in (
        ("artist", payload.artist),
        ("lead", payload.lead),
        ("supervisor", payload.supervisor),
    ):
        clean = sorted({p for p in perms if p in valid_keys})
        out[cap] = clean
        for p in clean:
            db.add(CapacityPermission(assignment_role=cap, permission_key=p))

    await write_audit(
        db,
        user_id=auth.user.id,
        action="capacity.permissions_updated",
        target_type="capacity_permissions",
        target_id="matrix",
        ip=client_ip_from_request(request),
        detail=out,
    )
    await db.commit()
    return CapacityPermissionsOut(
        artist=out["artist"], lead=out["lead"], supervisor=out["supervisor"]
    )


@router.get("/project/settings", response_model=ProjectSettingsOut)
async def get_project_settings(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProjectSettingsOut:
    if auth.role.name == "client":
        raise AppError("forbidden", "Clients cannot access project settings", status_code=403)
    meta = (
        await db.execute(select(ProjectMeta).where(ProjectMeta.uuid == ctx.uuid))
    ).scalar_one_or_none()
    if meta is None:
        raise NotFoundError("project_meta", ctx.uuid)
    return ProjectSettingsOut(
        uuid=meta.uuid,
        name=meta.name,
        status=cast(Literal["active", "on_hold", "completed", "archived"], meta.status),
        hours_per_day=meta.hours_per_day,
        working_days=list(meta.working_days or [1, 2, 3, 4, 5]),
        task_code_pattern=meta.task_code_pattern,
        require_version_to_submit=meta.require_version_to_submit,
        enforce_dependencies_in_gantt=meta.enforce_dependencies_in_gantt,
        admin_sql_console_enabled=meta.admin_sql_console_enabled,
        link_dependency_depth=meta.link_dependency_depth,
    )


@router.patch("/project/settings", response_model=ProjectSettingsOut)
async def patch_project_settings(
    payload: ProjectSettingsPatchRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProjectSettingsOut:
    fields = payload.model_fields_set
    # Status change requires project.status; other project settings require role.manage / admin
    if "status" in fields:
        if not auth.has_any_scope("project.status"):
            raise AppError("forbidden", "Missing permission 'project.status'", status_code=403)
        if auth.project_status == "archived" and auth.role.name != "admin":
            raise AppError(
                "forbidden",
                "Only administrators can unarchive a project",
                status_code=403,
            )
    other_fields = fields - {"status"}
    if other_fields:
        await require_not_archived(auth)
        if not auth.has_any_scope("role.manage") and auth.role.name != "admin":
            raise AppError(
                "forbidden",
                "Only admins/role managers can update project settings",
                status_code=403,
            )

    meta = (
        await db.execute(select(ProjectMeta).where(ProjectMeta.uuid == ctx.uuid))
    ).scalar_one_or_none()
    if meta is None:
        raise NotFoundError("project_meta", ctx.uuid)

    old_status = meta.status
    if "name" in fields and payload.name is not None:
        meta.name = payload.name.strip() or meta.name
    if "status" in fields and payload.status is not None:
        meta.status = payload.status
    if "hours_per_day" in fields and payload.hours_per_day is not None:
        meta.hours_per_day = payload.hours_per_day
    if "working_days" in fields and payload.working_days is not None:
        meta.working_days = [d for d in payload.working_days if 1 <= d <= 7] or [1, 2, 3, 4, 5]
    if "task_code_pattern" in fields and payload.task_code_pattern is not None:
        meta.task_code_pattern = payload.task_code_pattern.strip() or meta.task_code_pattern
    if "require_version_to_submit" in fields and payload.require_version_to_submit is not None:
        meta.require_version_to_submit = payload.require_version_to_submit
    if (
        "enforce_dependencies_in_gantt" in fields
        and payload.enforce_dependencies_in_gantt is not None
    ):
        meta.enforce_dependencies_in_gantt = payload.enforce_dependencies_in_gantt
    if "admin_sql_console_enabled" in fields and payload.admin_sql_console_enabled is not None:
        meta.admin_sql_console_enabled = payload.admin_sql_console_enabled
    if "link_dependency_depth" in fields and payload.link_dependency_depth is not None:
        meta.link_dependency_depth = payload.link_dependency_depth

    if "status" in fields and payload.status != old_status:
        await write_audit(
            db,
            user_id=auth.user.id,
            action="project.status_changed",
            target_type="project",
            target_id=ctx.uuid,
            ip=client_ip_from_request(request),
            detail={"from": old_status, "to": meta.status},
        )
    if other_fields:
        await write_audit(
            db,
            user_id=auth.user.id,
            action="project.settings_updated",
            target_type="project",
            target_id=ctx.uuid,
            ip=client_ip_from_request(request),
            detail={"fields": sorted(other_fields)},
        )
    await db.commit()
    await db.refresh(meta)
    return ProjectSettingsOut(
        uuid=meta.uuid,
        name=meta.name,
        status=cast(Literal["active", "on_hold", "completed", "archived"], meta.status),
        hours_per_day=meta.hours_per_day,
        working_days=list(meta.working_days or [1, 2, 3, 4, 5]),
        task_code_pattern=meta.task_code_pattern,
        require_version_to_submit=meta.require_version_to_submit,
        enforce_dependencies_in_gantt=meta.enforce_dependencies_in_gantt,
        admin_sql_console_enabled=meta.admin_sql_console_enabled,
        link_dependency_depth=meta.link_dependency_depth,
    )


@router.get("/admin/audit", response_model=list[AuditLogOut])
async def list_audit_logs(
    auth: Annotated[AuthContext, Depends(require("role.manage"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    action: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[AuditLogOut]:
    _ = auth
    stmt = select(AuditLog).order_by(AuditLog.at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action == action.strip())
    rows = (await db.execute(stmt)).scalars().all()
    user_ids = {r.user_id for r in rows if r.user_id is not None}
    usernames: dict[UUID, str] = {}
    if user_ids:
        u_rows = (
            await db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
        ).all()
        usernames = {uid: str(uname) for uid, uname in u_rows}
    return [
        AuditLogOut(
            id=r.id,
            at=r.at,
            user_id=r.user_id,
            username=usernames.get(r.user_id) if r.user_id else None,
            action=r.action,
            target_type=r.target_type,
            target_id=r.target_id,
            ip=r.ip,
            detail_json=dict(r.detail_json or {}),
        )
        for r in rows
    ]


# --- Task assignments & client sharing (used by capacity & client isolation in Gate A) ---


@router.put("/tasks/{task_id}/assignments", response_model=list[TaskAssignmentOut])
async def put_task_assignments(
    task_id: UUID,
    payload: TaskAssignmentsPutRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TaskAssignmentOut]:
    task = await db.get(Task, task_id)
    if task is None:
        raise NotFoundError("task", str(task_id))
    via = await assert_can(db, auth, "task.assign", task)

    await db.execute(delete(TaskAssignment).where(TaskAssignment.task_id == task_id))
    seen: set[tuple[UUID, str]] = set()
    for item in payload.assignments:
        key = (item.user_id, item.assignment_role)
        if key in seen:
            continue
        u = await db.get(User, item.user_id)
        if u is None:
            raise NotFoundError("user", str(item.user_id))
        db.add(
            TaskAssignment(
                task_id=task_id,
                user_id=item.user_id,
                assignment_role=item.assignment_role,
                source="manual",
            )
        )
        seen.add(key)

    await write_audit(
        db,
        user_id=auth.user.id,
        action="task.assignments_updated",
        target_type="task",
        target_id=str(task_id),
        ip=client_ip_from_request(request),
        detail={"acted_as": via, "count": len(seen)},
    )
    await db.commit()

    rows = (
        await db.execute(
            select(TaskAssignment, User)
            .join(User, User.id == TaskAssignment.user_id)
            .where(TaskAssignment.task_id == task_id)
        )
    ).all()
    return [
        TaskAssignmentOut(
            user_id=u.id,
            username=u.username,
            full_name=u.full_name,
            avatar_file=u.avatar_file,
            assignment_role=cast(Literal["artist", "lead", "supervisor"], ta.assignment_role),
            source=ta.source,
        )
        for ta, u in rows
    ]


@router.put("/tasks/{task_id}/shares", response_model=list[UUID])
async def put_task_shares(
    task_id: UUID,
    payload: TaskSharesPutRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("task.share_client", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UUID]:
    task = await db.get(Task, task_id)
    if task is None:
        raise NotFoundError("task", str(task_id))
    await db.execute(delete(TaskShare).where(TaskShare.task_id == task_id))
    now = datetime.now(UTC)
    seen: set[UUID] = set()
    for cid in payload.company_ids:
        if cid in seen:
            continue
        comp = await db.get(Company, cid)
        if comp is None:
            raise NotFoundError("company", str(cid))
        db.add(TaskShare(task_id=task_id, company_id=cid, shared_by=auth.user.id, shared_at=now))
        seen.add(cid)

    await write_audit(
        db,
        user_id=auth.user.id,
        action="task.share_updated",
        target_type="task",
        target_id=str(task_id),
        ip=client_ip_from_request(request),
        detail={"company_ids": [str(c) for c in sorted(seen, key=str)]},
    )
    await db.commit()
    return sorted(seen, key=str)


@router.put("/versions/{version_id}/shares", response_model=list[UUID])
async def put_version_shares(
    version_id: UUID,
    payload: VersionSharesPutRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("task.share_client", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UUID]:
    ver = await db.get(ProductVersion, version_id)
    if ver is None:
        raise NotFoundError("product_version", str(version_id))
    prod = await db.get(Product, ver.product_id)
    await db.execute(delete(VersionShare).where(VersionShare.version_id == version_id))
    now = datetime.now(UTC)
    seen: set[UUID] = set()
    for cid in payload.company_ids:
        if cid in seen:
            continue
        comp = await db.get(Company, cid)
        if comp is None:
            raise NotFoundError("company", str(cid))
        db.add(
            VersionShare(
                version_id=version_id, company_id=cid, shared_by=auth.user.id, shared_at=now
            )
        )
        # Ensure parent task is also shared with that company so entity/task tree lists it
        if prod is not None:
            existing_ts = (
                await db.execute(
                    select(TaskShare).where(
                        TaskShare.task_id == prod.task_id, TaskShare.company_id == cid
                    )
                )
            ).first()
            if existing_ts is None:
                db.add(
                    TaskShare(
                        task_id=prod.task_id, company_id=cid, shared_by=auth.user.id, shared_at=now
                    )
                )
        seen.add(cid)

    await write_audit(
        db,
        user_id=auth.user.id,
        action="version.share_updated",
        target_type="product_version",
        target_id=str(version_id),
        ip=client_ip_from_request(request),
        detail={"company_ids": [str(c) for c in sorted(seen, key=str)]},
    )
    await db.commit()
    return sorted(seen, key=str)
