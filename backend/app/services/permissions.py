from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError
from app.core.settings import Settings
from app.models.app_db import UserProjectIndex
from app.models.project_db import FileEntry, Product, ProductVersion, Task
from app.models.user import (
    CapacityPermission,
    CompanyDepartment,
    Role,
    RolePermission,
    TaskAssignment,
    TaskShare,
    User,
    UserDepartment,
    UserSession,
    VersionShare,
)
from app.services.auth_service import hash_password

ALL_PERMISSION_KEYS: tuple[str, ...] = (
    "task.view",
    "task.create",
    "task.delete",
    "task.edit_fields",
    "task.edit_schedule",
    "task.assign",
    "task.dependencies",
    "task.comment",
    "task.log_time",
    "task.status.start",
    "task.status.submit",
    "task.status.hold",
    "task.status.force",
    "task.status.reopen",
    "task.approve.lead",
    "task.approve.sup",
    "task.approve.client",
    "task.share_client",
    "media.view",
    "product.view",
    "product.publish",
    "scenefile.launch",
    "entity.manage",
    "entity.link",
    "user.view",
    "user.manage",
    "role.manage",
    "rules.manage",
    "views.gantt",
    "views.kanban",
    "views.workload",
    "views.graph",
    "views.calendar",
    "admin.db",
    "project.status",
    "confo.edit",
    "schedule.version",
    "milestone.edit",
)

WRITE_PERMISSION_KEYS: frozenset[str] = frozenset(
    {
        "task.create",
        "task.delete",
        "task.edit_fields",
        "task.edit_schedule",
        "task.assign",
        "task.dependencies",
        "task.comment",
        "task.log_time",
        "task.status.start",
        "task.status.submit",
        "task.status.hold",
        "task.status.force",
        "task.status.reopen",
        "task.approve.lead",
        "task.approve.sup",
        "task.approve.client",
        "task.share_client",
        "product.publish",
        "entity.manage",
        "entity.link",
        "user.manage",
        "role.manage",
        "rules.manage",
        "project.status",
        "confo.edit",
        "schedule.version",
        "milestone.edit",
    }
)

VALID_SCOPES: tuple[str, ...] = ("all", "company", "mine", "shared", "none")
VALID_CAPACITIES: tuple[str, ...] = ("artist", "lead", "supervisor")

DEFAULT_ROLES: list[tuple[str, str, int, bool]] = [
    ("admin", "Administrator", 100, True),
    ("producer", "Production", 80, True),
    ("director", "Director", 75, True),
    ("supervisor", "Supervisor", 60, True),
    ("lead", "Lead", 50, True),
    ("artist", "Artist", 40, True),
    ("external", "External", 20, True),
    ("client", "Client", 10, True),
]


def _build_default_role_matrix() -> dict[str, dict[str, str]]:
    admin_perms = {k: "all" for k in ALL_PERMISSION_KEYS}
    producer_perms = {
        k: ("none" if k in {"role.manage", "admin.db"} else "all") for k in ALL_PERMISSION_KEYS
    }
    # Confirmed user override: Director can view everything, comment, and approve ANY stage
    # (lead, sup, client). No edit/schedule/assign/status/time/share unless assigned a capacity.
    director_perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    for k in (
        "task.view",
        "task.comment",
        "media.view",
        "product.view",
        "user.view",
        "views.gantt",
        "views.kanban",
        "views.workload",
        "views.graph",
        "task.approve.lead",
        "task.approve.sup",
        "task.approve.client",
    ):
        director_perms[k] = "all"

    supervisor_perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    # CR04 §5: supervisors save schedule versions by default (configurable in Roles).
    supervisor_perms["schedule.version"] = "all"
    for k in (
        "task.view",
        "task.comment",
        "media.view",
        "product.view",
        "user.view",
        "scenefile.launch",
        "views.gantt",
        "views.kanban",
        "views.workload",
        "views.graph",
    ):
        supervisor_perms[k] = "all"

    lead_perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    lead_perms["task.view"] = "mine"
    lead_perms["task.comment"] = "mine"
    for k in (
        "media.view",
        "product.view",
        "user.view",
        "scenefile.launch",
        "views.kanban",
        "views.workload",
    ):
        lead_perms[k] = "all"

    artist_perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    artist_perms["task.view"] = "mine"
    artist_perms["task.comment"] = "mine"
    for k in ("media.view", "product.view", "scenefile.launch"):
        artist_perms[k] = "all"

    external_perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    for k in ("task.view", "task.comment", "media.view", "product.view"):
        external_perms[k] = "company"

    client_perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    for k in ("task.view", "task.comment", "media.view", "product.view", "task.approve.client"):
        client_perms[k] = "shared"

    # CR04 §4: Calendar for every internal role; data stays scoped by task.view. Never clients.
    for perms in (director_perms, supervisor_perms, lead_perms, artist_perms, external_perms):
        perms["views.calendar"] = "all"

    return {
        "admin": admin_perms,
        "producer": producer_perms,
        "director": director_perms,
        "supervisor": supervisor_perms,
        "lead": lead_perms,
        "artist": artist_perms,
        "external": external_perms,
        "client": client_perms,
    }


DEFAULT_ROLE_PERMISSIONS: dict[str, dict[str, str]] = _build_default_role_matrix()

DEFAULT_CAPACITY_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "artist": (
        "task.status.start",
        "task.status.submit",
        "task.log_time",
        "product.publish",
        "scenefile.launch",
    ),
    "lead": (
        "task.edit_fields",
        "task.status.start",
        "task.status.submit",
        "task.log_time",
        "task.approve.lead",
        "product.publish",
    ),
    "supervisor": (
        "task.edit_fields",
        "task.edit_schedule",
        "task.assign",
        "task.dependencies",
        "task.status.hold",
        "task.status.reopen",
        "task.status.force",
        "task.approve.sup",
        "task.log_time",
    ),
}


@dataclass
class AuthContext:
    """Authenticated request security context resolved from session + project DB."""

    user: User
    role: Role
    project_uuid: str
    project_status: str
    session: UserSession
    permissions: dict[str, str]
    capacity_permissions: dict[str, set[str]]
    user_company_dept_ids: set[UUID]
    user_dept_ids: set[UUID]
    my_task_capacities: dict[UUID, list[str]]

    def has_any_scope(self, perm: str) -> bool:
        if self.role.name == "admin":
            return True
        if self.project_status == "archived" and perm in WRITE_PERMISSION_KEYS:
            return False
        return self.permissions.get(perm, "none") != "none"


def role_uuid_for_name(name: str) -> UUID:
    return uuid.uuid5(uuid.NAMESPACE_DNS, f"organum.role.{name}")


async def sync_user_project_index(
    app_db: AsyncSession,
    project_uuid: str,
    project_name: str,
    usernames: list[str],
) -> None:
    """Keep app.db user_project_index synchronized for 'Projects working on'."""
    await app_db.execute(
        delete(UserProjectIndex).where(UserProjectIndex.project_uuid == project_uuid)
    )
    for uname in sorted({u.strip() for u in usernames if u.strip()}):
        app_db.add(
            UserProjectIndex(
                username=uname,
                project_uuid=project_uuid,
                project_name=project_name,
            )
        )


async def seed_project_auth(
    db: AsyncSession,
    settings: Settings,
    *,
    app_db: AsyncSession | None = None,
    project_uuid: str | None = None,
    project_name: str | None = None,
) -> None:
    """Idempotently seed system roles, default permissions/capacities, and initial admin user."""
    existing_roles = {r.name: r for r in (await db.execute(select(Role))).scalars().all()}
    for name, label, rank, is_sys in DEFAULT_ROLES:
        role = existing_roles.get(name)
        if role is None:
            role = Role(
                id=role_uuid_for_name(name),
                name=name,
                label=label,
                rank=rank,
                is_system=is_sys,
            )
            db.add(role)
            existing_roles[name] = role
    await db.flush()

    existing_rp = {
        (rp.role_id, rp.permission_key)
        for rp in (await db.execute(select(RolePermission))).scalars().all()
    }
    for role_name, perm_map in DEFAULT_ROLE_PERMISSIONS.items():
        role_obj = existing_roles[role_name]
        # Add only keys this role has no row for yet: a fresh role gets the full default map,
        # and permission keys introduced later (e.g. confo.edit) reach existing projects,
        # while scopes an administrator already edited are never touched.
        for perm_key, scope in perm_map.items():
            if (role_obj.id, perm_key) not in existing_rp:
                db.add(RolePermission(role_id=role_obj.id, permission_key=perm_key, scope=scope))

    existing_cap = (await db.execute(select(CapacityPermission))).scalars().all()
    if not existing_cap:
        for cap_role, perms in DEFAULT_CAPACITY_PERMISSIONS.items():
            for perm_key in perms:
                db.add(CapacityPermission(assignment_role=cap_role, permission_key=perm_key))

    admin_role = existing_roles["admin"]
    admin_user = (
        await db.execute(select(User).where(User.username == "admin"))
    ).scalar_one_or_none()
    if admin_user is None:
        # Check if legacy 'artist' row exists and promote it to admin
        legacy = (
            await db.execute(select(User).where(User.username == "artist"))
        ).scalar_one_or_none()
        if legacy is not None:
            legacy.username = "admin"
            legacy.full_name = "Administrator"
            legacy.role_id = admin_role.id
            legacy.password_hash = hash_password(settings.initial_admin_password)
            legacy.must_change_password = True
            legacy.has_initial_password = True
            legacy.is_active = True
        else:
            db.add(
                User(
                    username="admin",
                    full_name="Administrator",
                    email=None,
                    password_hash=hash_password(settings.initial_admin_password),
                    role_id=admin_role.id,
                    is_active=True,
                    must_change_password=True,
                    has_initial_password=True,
                )
            )
    await db.flush()

    if app_db is not None and project_uuid and project_name:
        all_active = (
            (await db.execute(select(User.username).where(User.is_active.is_(True))))
            .scalars()
            .all()
        )
        await sync_user_project_index(
            app_db, project_uuid, project_name, [str(u) for u in all_active]
        )


def can_see_client_comments(auth: AuthContext) -> bool:
    """Confirmed CR03 rule: client-visible comments/annotations are visible ONLY to
    client, producer (Production), director (Direction), and admin — never artists."""
    return auth.role.name in {"admin", "producer", "director", "client"}


def can_access_annotation_visibility(auth: AuthContext, visibility: str) -> bool:
    if visibility == "client":
        return can_see_client_comments(auth)
    return auth.role.name != "client"


async def load_user_permissions_bundle(
    db: AsyncSession,
    user: User,
) -> tuple[
    Role,
    dict[str, str],
    dict[str, set[str]],
    set[UUID],
    set[UUID],
    dict[UUID, list[str]],
]:
    role = await db.get(Role, user.role_id)
    if role is None:
        raise AppError("forbidden", "Assigned role no longer exists", status_code=403)

    rp_rows = (
        (await db.execute(select(RolePermission).where(RolePermission.role_id == role.id)))
        .scalars()
        .all()
    )
    perms = {k: "none" for k in ALL_PERMISSION_KEYS}
    for rp in rp_rows:
        perms[rp.permission_key] = rp.scope

    cap_rows = (await db.execute(select(CapacityPermission))).scalars().all()
    caps: dict[str, set[str]] = {c: set() for c in VALID_CAPACITIES}
    for cp in cap_rows:
        caps.setdefault(cp.assignment_role, set()).add(cp.permission_key)

    comp_depts: set[UUID] = set()
    if user.company_id is not None:
        comp_depts = set(
            (
                await db.execute(
                    select(CompanyDepartment.department_id).where(
                        CompanyDepartment.company_id == user.company_id
                    )
                )
            )
            .scalars()
            .all()
        )

    user_depts = set(
        (
            await db.execute(
                select(UserDepartment.department_id).where(UserDepartment.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )

    assign_rows = (
        await db.execute(
            select(TaskAssignment.task_id, TaskAssignment.assignment_role).where(
                TaskAssignment.user_id == user.id
            )
        )
    ).all()
    my_caps: dict[UUID, list[str]] = {}
    for tid, arole in assign_rows:
        my_caps.setdefault(tid, []).append(str(arole))

    return role, perms, caps, comp_depts, user_depts, my_caps


async def _task_in_scope(
    db: AsyncSession,
    auth: AuthContext,
    scope: str,
    task: Task,
) -> bool:
    if scope == "all":
        return True
    if scope == "none":
        return False
    if scope == "mine":
        return task.id in auth.my_task_capacities
    if scope == "company":
        if task.department_id in auth.user_company_dept_ids:
            return True
        if auth.user.company_id is None:
            return False
        match = (
            await db.execute(
                select(TaskAssignment.task_id)
                .join(User, User.id == TaskAssignment.user_id)
                .where(
                    TaskAssignment.task_id == task.id,
                    User.company_id == auth.user.company_id,
                )
            )
        ).first()
        return match is not None
    if scope == "shared":
        if auth.user.company_id is None:
            return False
        t_share = (
            await db.execute(
                select(TaskShare.task_id).where(
                    TaskShare.task_id == task.id,
                    TaskShare.company_id == auth.user.company_id,
                )
            )
        ).first()
        if t_share is not None:
            return True
        v_share = (
            await db.execute(
                select(VersionShare.version_id)
                .join(ProductVersion, ProductVersion.id == VersionShare.version_id)
                .join(Product, Product.id == ProductVersion.product_id)
                .where(
                    Product.task_id == task.id,
                    VersionShare.company_id == auth.user.company_id,
                )
            )
        ).first()
        return v_share is not None
    return False


async def can(
    db: AsyncSession,
    auth: AuthContext,
    perm: str,
    task: Task | None = None,
) -> tuple[bool, str | None]:
    """Central two-layer permission resolver (§3.2). Returns (allowed, via)."""
    if (
        auth.project_status == "archived"
        and perm in WRITE_PERMISSION_KEYS
        and auth.role.name != "admin"
    ):
        return False, None
    if auth.role.name == "admin":
        return True, "role:admin"

    scope = auth.permissions.get(perm, "none")
    if task is None:
        if scope != "none":
            return True, f"role:{auth.role.name}"
        return False, None

    if await _task_in_scope(db, auth, scope, task):
        return True, f"role:{auth.role.name}"

    # Capacity grants on specific assigned task (priority order: supervisor, lead, artist)
    task_caps = auth.my_task_capacities.get(task.id, [])
    for cap in ("supervisor", "lead", "artist"):
        if cap in task_caps and perm in auth.capacity_permissions.get(cap, set()):
            return True, f"capacity:{cap}"

    return False, None


async def assert_can(
    db: AsyncSession,
    auth: AuthContext,
    perm: str,
    task: Task | None = None,
    *,
    message: str = "Insufficient permissions for this action",
) -> str:
    allowed, via = await can(db, auth, perm, task)
    if not allowed or via is None:
        raise AppError("forbidden", message, status_code=403)
    return via


async def visible_task_ids(
    db: AsyncSession,
    auth: AuthContext,
    perm: str = "task.view",
) -> set[UUID] | None:
    """Return None when unrestricted ('all'), or set of permitted task IDs for SQL scoping."""
    if auth.role.name == "admin":
        return None
    scope = auth.permissions.get(perm, "none")
    if scope == "all":
        return None

    ids: set[UUID] = set(auth.my_task_capacities.keys()) if scope != "shared" else set()
    # Clients only see shared tasks/versions
    if scope == "shared":
        if auth.user.company_id is None:
            return set()
        t_rows = (
            (
                await db.execute(
                    select(TaskShare.task_id).where(TaskShare.company_id == auth.user.company_id)
                )
            )
            .scalars()
            .all()
        )
        v_rows = (
            (
                await db.execute(
                    select(Product.task_id)
                    .join(ProductVersion, ProductVersion.product_id == Product.id)
                    .join(VersionShare, VersionShare.version_id == ProductVersion.id)
                    .where(VersionShare.company_id == auth.user.company_id)
                )
            )
            .scalars()
            .all()
        )
        ids.update(t_rows)
        ids.update(v_rows)
        return ids

    if scope == "company":
        if auth.user_company_dept_ids:
            dept_tasks = (
                (
                    await db.execute(
                        select(Task.id).where(Task.department_id.in_(auth.user_company_dept_ids))
                    )
                )
                .scalars()
                .all()
            )
            ids.update(dept_tasks)
        if auth.user.company_id is not None:
            comp_assign_tasks = (
                (
                    await db.execute(
                        select(TaskAssignment.task_id)
                        .join(User, User.id == TaskAssignment.user_id)
                        .where(User.company_id == auth.user.company_id)
                    )
                )
                .scalars()
                .all()
            )
            ids.update(comp_assign_tasks)
    elif scope == "mine":
        ids.update(auth.my_task_capacities.keys())

    # Union with any capacity grant for perm across assigned tasks
    for tid, caps in auth.my_task_capacities.items():
        if any(perm in auth.capacity_permissions.get(cap, set()) for cap in caps):
            ids.add(tid)
    return ids


async def client_shared_version_ids(db: AsyncSession, company_id: UUID | None) -> set[UUID]:
    if company_id is None:
        return set()
    rows = (
        (
            await db.execute(
                select(VersionShare.version_id).where(VersionShare.company_id == company_id)
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


async def can_access_file(
    db: AsyncSession,
    auth: AuthContext,
    file_id: UUID,
) -> tuple[FileEntry, Task]:
    """Verify caller can view a file; clients receive 404 (not 403) on unshared files (§15)."""
    res = await db.execute(
        select(FileEntry, Task, ProductVersion.id)
        .join(ProductVersion, ProductVersion.id == FileEntry.product_version_id)
        .join(Product, Product.id == ProductVersion.product_id)
        .join(Task, Task.id == Product.task_id)
        .where(FileEntry.id == file_id)
    )
    row = res.first()
    if row is None:
        raise NotFoundError("file", str(file_id))
    entry, task, version_id = row

    if auth.role.name == "client":
        if auth.user.company_id is None:
            raise NotFoundError("file", str(file_id))
        shared = (
            await db.execute(
                select(VersionShare.version_id).where(
                    VersionShare.version_id == version_id,
                    VersionShare.company_id == auth.user.company_id,
                )
            )
        ).first()
        if shared is None:
            # Section 15: unshared versions/files return 404 (not 403) to clients
            raise NotFoundError("file", str(file_id))
        return entry, task

    allowed, _ = await can(db, auth, "media.view", task)
    if not allowed:
        raise AppError(
            "forbidden", "You do not have permission to view this media", status_code=403
        )
    return entry, task


def serialize_auth_payload(
    auth: AuthContext, *, projects_working_on: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "user": {
            "id": str(auth.user.id),
            "username": auth.user.username,
            "full_name": auth.user.full_name,
            "email": auth.user.email,
            "role_id": str(auth.role.id),
            "role_name": auth.role.name,
            "role_label": auth.role.label,
            "company_id": str(auth.user.company_id) if auth.user.company_id else None,
            "avatar_file": auth.user.avatar_file,
            "daily_capacity_hours": auth.user.daily_capacity_hours,
            "timezone": auth.user.timezone,
            "is_active": auth.user.is_active,
            "must_change_password": auth.user.must_change_password,
            "department_ids": [str(d) for d in sorted(auth.user_dept_ids, key=str)],
            "projects_working_on": projects_working_on,
        },
        "project_uuid": auth.project_uuid,
        "project_status": auth.project_status,
        "permissions": auth.permissions,
        "capacity_permissions": {k: sorted(v) for k, v in auth.capacity_permissions.items()},
    }
