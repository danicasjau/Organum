from __future__ import annotations

import asyncio
import io
from pathlib import Path
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from PIL import Image
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_app_db, get_db, get_project_context
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.project_registry import ProjectContext
from app.core.security import (
    client_ip_from_request,
    get_project_auth,
    require,
    require_not_archived,
)
from app.models.app_db import UserProjectIndex
from app.models.project_db import Department
from app.models.user import Company, CompanyDepartment, Role, User, UserDepartment
from app.schemas.api import (
    CompanyCreateRequest,
    CompanyDepartmentsPutRequest,
    CompanyOut,
    CompanyUpdateRequest,
    ProjectRefOut,
    UserCreateRequest,
    UserDepartmentsPutRequest,
    UserOut,
    UserResetPasswordRequest,
    UserUpdateRequest,
)
from app.services.auth_service import (
    hash_password,
    revoke_all_user_sessions,
    validate_password,
    write_audit,
)
from app.services.permissions import AuthContext, sync_user_project_index

router = APIRouter(tags=["users", "companies"])

_MAX_AVATAR_BYTES = 2 * 1024 * 1024


async def _build_user_out(
    db: AsyncSession,
    app_db: AsyncSession,
    user: User,
    projects_by_username: dict[str, list[ProjectRefOut]] | None = None,
) -> UserOut:
    role = await db.get(Role, user.role_id)
    company = await db.get(Company, user.company_id) if user.company_id else None
    dept_ids = list(
        (
            await db.execute(
                select(UserDepartment.department_id).where(UserDepartment.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    if projects_by_username is not None:
        projs = projects_by_username.get(user.username, [])
    else:
        p_rows = (
            (
                await app_db.execute(
                    select(UserProjectIndex)
                    .where(UserProjectIndex.username == user.username)
                    .order_by(UserProjectIndex.project_name.asc())
                )
            )
            .scalars()
            .all()
        )
        projs = [
            ProjectRefOut(project_uuid=r.project_uuid, project_name=r.project_name) for r in p_rows
        ]
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        role_id=user.role_id,
        role_name=role.name if role else "unknown",
        role_label=role.label if role else "Unknown",
        company_id=user.company_id,
        company_name=company.name if company else None,
        avatar_file=user.avatar_file,
        daily_capacity_hours=user.daily_capacity_hours,
        timezone=user.timezone,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        department_ids=sorted(dept_ids, key=str),
        projects_working_on=projs,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _company_to_out(comp: Company) -> CompanyOut:
    return CompanyOut(
        id=comp.id,
        name=comp.name,
        short_code=comp.short_code,
        kind=cast(Literal["internal", "external", "group"], comp.kind),
        color=comp.color,
        notes=comp.notes,
        department_ids=sorted([cd.department_id for cd in comp.departments], key=str),
        created_at=comp.created_at,
        updated_at=comp.updated_at,
    )


async def _sync_project_users_index(
    db: AsyncSession, app_db: AsyncSession, ctx: ProjectContext
) -> None:
    usernames = (
        (await db.execute(select(User.username).where(User.is_active.is_(True)))).scalars().all()
    )
    await sync_user_project_index(app_db, ctx.uuid, ctx.name, [str(u) for u in usernames])
    await app_db.commit()


@router.get("/users", response_model=list[UserOut])
async def list_users(
    auth: Annotated[AuthContext, Depends(require("user.view"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> list[UserOut]:
    _ = auth
    users = (await db.execute(select(User).order_by(User.full_name.asc()))).scalars().all()
    idx_rows = (
        (
            await app_db.execute(
                select(UserProjectIndex).order_by(UserProjectIndex.project_name.asc())
            )
        )
        .scalars()
        .all()
    )
    proj_map: dict[str, list[ProjectRefOut]] = {}
    for row in idx_rows:
        proj_map.setdefault(row.username, []).append(
            ProjectRefOut(project_uuid=row.project_uuid, project_name=row.project_name)
        )
    return [await _build_user_out(db, app_db, u, projects_by_username=proj_map) for u in users]


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    payload: UserCreateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("user.manage", write=True))],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> UserOut:
    uname = payload.username.strip()
    if not uname or len(uname) < 2 or " " in uname:
        raise AppError(
            "invalid_username", "Username must be >= 2 chars without spaces", status_code=400
        )
    existing = (await db.execute(select(User).where(User.username == uname))).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Username '{uname}' already exists")

    target_role = await db.get(Role, payload.role_id)
    if target_role is None:
        raise NotFoundError("role", str(payload.role_id))
    # Producer (or any non-admin) cannot create admin users
    if target_role.name == "admin" and auth.role.name != "admin":
        raise AppError("forbidden", "Only administrators can create admin users", status_code=403)

    if target_role.name == "client":
        if payload.company_id is None:
            raise AppError(
                "invalid_user",
                "Client users must belong to an external company",
                status_code=400,
            )
        comp = await db.get(Company, payload.company_id)
        if comp is None:
            raise NotFoundError("company", str(payload.company_id))
        if comp.kind not in ("external", "client"):
            raise AppError(
                "invalid_user",
                "Client users must belong to a client or external company",
                status_code=400,
            )
    elif payload.company_id is not None:
        comp = await db.get(Company, payload.company_id)
        if comp is None:
            raise NotFoundError("company", str(payload.company_id))

    validate_password(payload.password, uname)
    user = User(
        username=uname,
        full_name=payload.full_name.strip() or uname,
        email=payload.email.strip() if payload.email else None,
        password_hash=hash_password(payload.password),
        role_id=target_role.id,
        company_id=payload.company_id,
        daily_capacity_hours=payload.daily_capacity_hours,
        timezone=payload.timezone.strip() or "UTC",
        is_active=True,
        must_change_password=payload.must_change_password,
        has_initial_password=False,
    )
    db.add(user)
    await db.flush()

    for did in payload.department_ids:
        dept = await db.get(Department, did)
        if dept is not None:
            db.add(UserDepartment(user_id=user.id, department_id=did))

    await write_audit(
        db,
        user_id=auth.user.id,
        action="user.created",
        target_type="user",
        target_id=str(user.id),
        ip=client_ip_from_request(request),
        detail={"username": user.username, "role": target_role.name},
    )
    await db.commit()
    await _sync_project_users_index(db, app_db, ctx)
    await db.refresh(user)
    return await _build_user_out(db, app_db, user)


@router.get("/users/{user_id}", response_model=UserOut)
async def get_user(
    user_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> UserOut:
    if auth.user.id != user_id and not auth.has_any_scope("user.view"):
        raise AppError("forbidden", "Missing permission 'user.view'", status_code=403)
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("user", str(user_id))
    return await _build_user_out(db, app_db, user)


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: UUID,
    payload: UserUpdateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> UserOut:
    await require_not_archived(auth)
    is_self = auth.user.id == user_id
    can_manage = auth.has_any_scope("user.manage")
    if not is_self and not can_manage:
        raise AppError("forbidden", "Missing permission 'user.manage'", status_code=403)

    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("user", str(user_id))
    target_role = await db.get(Role, user.role_id)

    fields = payload.model_fields_set
    # Self-edit only allows safe profile fields unless user also has user.manage
    if not can_manage:
        forbidden_self = fields - {"full_name", "email", "timezone"}
        if forbidden_self:
            raise AppError(
                "forbidden",
                f"Cannot modify protected user fields: {sorted(forbidden_self)}",
                status_code=403,
            )

    if target_role and target_role.name == "admin" and auth.role.name != "admin" and not is_self:
        raise AppError(
            "forbidden", "Only administrators can modify admin accounts", status_code=403
        )

    if "full_name" in fields and payload.full_name is not None:
        user.full_name = payload.full_name.strip() or user.full_name
    if "email" in fields:
        user.email = payload.email.strip() if payload.email else None
    if "timezone" in fields and payload.timezone is not None:
        user.timezone = payload.timezone.strip() or "UTC"
    if "daily_capacity_hours" in fields and payload.daily_capacity_hours is not None:
        user.daily_capacity_hours = payload.daily_capacity_hours

    new_role = target_role
    if "role_id" in fields and payload.role_id is not None:
        new_role = await db.get(Role, payload.role_id)
        if new_role is None:
            raise NotFoundError("role", str(payload.role_id))
        if new_role.name == "admin" and auth.role.name != "admin":
            raise AppError(
                "forbidden", "Only administrators can assign admin role", status_code=403
            )
        user.role_id = new_role.id

    if "company_id" in fields:
        if payload.company_id is not None:
            comp = await db.get(Company, payload.company_id)
            if comp is None:
                raise NotFoundError("company", str(payload.company_id))
        user.company_id = payload.company_id

    if new_role and new_role.name == "client":
        comp = await db.get(Company, user.company_id) if user.company_id else None
        if comp is None or comp.kind not in ("external", "client"):
            raise AppError(
                "invalid_user",
                "Client users must belong to an external company",
                status_code=400,
            )

    action = "user.updated"
    if "is_active" in fields and payload.is_active is not None:
        if user.id == auth.user.id and not payload.is_active:
            raise AppError(
                "invalid_request", "You cannot deactivate your own account", status_code=400
            )
        if user.is_active != payload.is_active:
            action = "user.activated" if payload.is_active else "user.deactivated"
        user.is_active = payload.is_active
        if not payload.is_active:
            await revoke_all_user_sessions(db, user.id)

    await write_audit(
        db,
        user_id=auth.user.id,
        action=action,
        target_type="user",
        target_id=str(user.id),
        ip=client_ip_from_request(request),
        detail={"fields": sorted(fields)},
    )
    await db.commit()
    await _sync_project_users_index(db, app_db, ctx)
    await db.refresh(user)
    return await _build_user_out(db, app_db, user)


@router.post("/users/{user_id}/reset-password", response_model=UserOut)
async def reset_user_password(
    user_id: UUID,
    payload: UserResetPasswordRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("user.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> UserOut:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("user", str(user_id))
    target_role = await db.get(Role, user.role_id)
    if target_role and target_role.name == "admin" and auth.role.name != "admin":
        raise AppError(
            "forbidden", "Only administrators can reset an admin password", status_code=403
        )

    validate_password(payload.new_password, user.username)
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = payload.must_change_password
    user.has_initial_password = False
    await revoke_all_user_sessions(db, user.id)

    await write_audit(
        db,
        user_id=auth.user.id,
        action="auth.password_reset",
        target_type="user",
        target_id=str(user.id),
        ip=client_ip_from_request(request),
        detail={"must_change_password": payload.must_change_password},
    )
    await db.commit()
    await db.refresh(user)
    return await _build_user_out(db, app_db, user)


@router.put("/users/{user_id}/departments", response_model=UserOut)
async def set_user_departments(
    user_id: UUID,
    payload: UserDepartmentsPutRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("user.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> UserOut:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("user", str(user_id))
    await db.execute(delete(UserDepartment).where(UserDepartment.user_id == user_id))
    seen: set[UUID] = set()
    for did in payload.department_ids:
        if did in seen:
            continue
        dept = await db.get(Department, did)
        if dept is not None:
            db.add(UserDepartment(user_id=user_id, department_id=did))
            seen.add(did)
    await write_audit(
        db,
        user_id=auth.user.id,
        action="user.departments_updated",
        target_type="user",
        target_id=str(user_id),
        ip=client_ip_from_request(request),
        detail={"department_ids": [str(d) for d in seen]},
    )
    await db.commit()
    await db.refresh(user)
    return await _build_user_out(db, app_db, user)


@router.post("/users/{user_id}/avatar", response_model=UserOut)
async def upload_user_avatar(
    user_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    file: UploadFile = File(...),
) -> UserOut:
    await require_not_archived(auth)
    if auth.user.id != user_id and not auth.has_any_scope("user.manage"):
        raise AppError("forbidden", "Cannot upload avatar for another user", status_code=403)
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("user", str(user_id))

    raw = await file.read(_MAX_AVATAR_BYTES + 1)
    if len(raw) > _MAX_AVATAR_BYTES:
        raise AppError("file_too_large", "Avatar exceeds 2 MB limit", status_code=400)

    avatars_dir = (ctx.pipeline_dir / "avatars").resolve()
    avatars_dir.mkdir(parents=True, exist_ok=True)
    dest = (avatars_dir / f"{user_id}.png").resolve()
    try:
        dest.relative_to(avatars_dir)
    except ValueError as exc:
        raise AppError("invalid_path", "Invalid avatar path", status_code=400) from exc

    def _convert_and_save() -> None:
        try:
            with Image.open(io.BytesIO(raw)) as im:
                rgb = im.convert("RGBA")
                rgb.thumbnail((128, 128), Image.Resampling.LANCZOS)
                rgb.save(dest, format="PNG")
        except Exception as exc:
            raise AppError(
                "invalid_image", f"Unsupported avatar image: {exc}", status_code=400
            ) from exc

    await asyncio.to_thread(_convert_and_save)
    user.avatar_file = f"{user_id}.png"
    await db.commit()
    await db.refresh(user)
    return await _build_user_out(db, app_db, user)


@router.get("/users/{user_id}/avatar")
async def get_user_avatar(
    user_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    _ = auth
    user = await db.get(User, user_id)
    if user is None or not user.avatar_file:
        raise NotFoundError("avatar", str(user_id))
    avatars_dir = (ctx.pipeline_dir / "avatars").resolve()
    candidate = (avatars_dir / Path(user.avatar_file).name).resolve()
    try:
        candidate.relative_to(avatars_dir)
    except ValueError as exc:
        raise NotFoundError("avatar", str(user_id)) from exc
    if not candidate.is_file():
        raise NotFoundError("avatar", str(user_id))
    return Response(content=await asyncio.to_thread(candidate.read_bytes), media_type="image/png")


# --- Companies CRUD ---


@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[CompanyOut]:
    stmt = select(Company).options(selectinload(Company.departments)).order_by(Company.name.asc())
    if auth.role.name == "client":
        if auth.user.company_id is None:
            return []
        stmt = stmt.where(Company.id == auth.user.company_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [_company_to_out(c) for c in rows]


@router.post("/companies", response_model=CompanyOut, status_code=201)
async def create_company(
    payload: CompanyCreateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("user.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompanyOut:
    name = payload.name.strip()
    short = payload.short_code.strip().upper()[:16]
    if not name or not short:
        raise AppError(
            "invalid_request", "Company name and short code are required", status_code=400
        )
    dup = (
        await db.execute(
            select(Company).where((Company.name == name) | (Company.short_code == short))
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise ConflictError("Company name or short code already exists")

    comp = Company(
        name=name,
        short_code=short,
        kind=payload.kind,
        color=payload.color.strip() or "--series-1",
        notes=payload.notes.strip(),
    )
    db.add(comp)
    await db.flush()
    for did in payload.department_ids:
        if await db.get(Department, did) is not None:
            db.add(CompanyDepartment(company_id=comp.id, department_id=did))

    await write_audit(
        db,
        user_id=auth.user.id,
        action="company.created",
        target_type="company",
        target_id=str(comp.id),
        ip=client_ip_from_request(request),
        detail={"name": name, "kind": payload.kind},
    )
    await db.commit()
    loaded = (
        await db.execute(
            select(Company).where(Company.id == comp.id).options(selectinload(Company.departments))
        )
    ).scalar_one()
    return _company_to_out(loaded)


@router.patch("/companies/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: UUID,
    payload: CompanyUpdateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("user.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompanyOut:
    comp = (
        await db.execute(
            select(Company)
            .where(Company.id == company_id)
            .options(selectinload(Company.departments))
        )
    ).scalar_one_or_none()
    if comp is None:
        raise NotFoundError("company", str(company_id))
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        comp.name = payload.name.strip() or comp.name
    if "short_code" in fields and payload.short_code is not None:
        comp.short_code = payload.short_code.strip().upper()[:16] or comp.short_code
    if "kind" in fields and payload.kind is not None:
        comp.kind = payload.kind
    if "color" in fields and payload.color is not None:
        comp.color = payload.color.strip() or comp.color
    if "notes" in fields and payload.notes is not None:
        comp.notes = payload.notes.strip()

    await write_audit(
        db,
        user_id=auth.user.id,
        action="company.updated",
        target_type="company",
        target_id=str(comp.id),
        ip=client_ip_from_request(request),
        detail={"fields": sorted(fields)},
    )
    await db.commit()
    await db.refresh(comp)
    return _company_to_out(comp)


@router.delete("/companies/{company_id}", status_code=204)
async def delete_company(
    company_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("user.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    comp = await db.get(Company, company_id)
    if comp is None:
        raise NotFoundError("company", str(company_id))
    await write_audit(
        db,
        user_id=auth.user.id,
        action="company.deleted",
        target_type="company",
        target_id=str(company_id),
        ip=client_ip_from_request(request),
        detail={"name": comp.name},
    )
    await db.delete(comp)
    await db.commit()
    return Response(status_code=204)


@router.put("/companies/{company_id}/departments", response_model=CompanyOut)
async def put_company_departments(
    company_id: UUID,
    payload: CompanyDepartmentsPutRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("user.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompanyOut:
    comp = (
        await db.execute(
            select(Company)
            .where(Company.id == company_id)
            .options(selectinload(Company.departments))
        )
    ).scalar_one_or_none()
    if comp is None:
        raise NotFoundError("company", str(company_id))
    await db.execute(delete(CompanyDepartment).where(CompanyDepartment.company_id == company_id))
    seen: set[UUID] = set()
    for did in payload.department_ids:
        if did in seen:
            continue
        if await db.get(Department, did) is not None:
            db.add(CompanyDepartment(company_id=company_id, department_id=did))
            seen.add(did)
    await write_audit(
        db,
        user_id=auth.user.id,
        action="company.departments_updated",
        target_type="company",
        target_id=str(company_id),
        ip=client_ip_from_request(request),
        detail={"department_ids": [str(d) for d in seen]},
    )
    await db.commit()
    loaded = (
        await db.execute(
            select(Company)
            .where(Company.id == company_id)
            .options(selectinload(Company.departments))
        )
    ).scalar_one()
    return _company_to_out(loaded)
