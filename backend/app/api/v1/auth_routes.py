from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_db, get_db, get_project_registry, get_settings_dep
from app.core.errors import AppError
from app.core.project_registry import ProjectRegistry
from app.core.security import (
    client_ip_from_request,
    get_current_auth_allow_password_change,
    get_optional_auth,
    get_project_auth_allow_password_change,
)
from app.core.settings import Settings
from app.models.app_db import KnownProject, UserProjectIndex
from app.models.user import User
from app.schemas.api import (
    AuthMeOut,
    BootstrapInfoOut,
    ChangePasswordRequest,
    LoginProjectOption,
    LoginRequest,
    StaleProjectOut,
)
from app.services.auth_service import (
    SESSION_COOKIE_NAME,
    clear_auth_cookies,
    clear_failed_logins,
    create_user_session,
    is_locked_out,
    parse_session_cookie,
    record_failed_login,
    revoke_all_user_sessions,
    revoke_session_by_raw_token,
    set_auth_cookies,
    validate_password,
    verify_dummy_password,
    verify_password,
    write_audit,
)
from app.services.permissions import AuthContext, serialize_auth_payload

global_auth_router = APIRouter(prefix="/auth", tags=["auth"])
project_auth_router = APIRouter(prefix="/auth", tags=["auth"])


async def _projects_for_username(app_db: AsyncSession, username: str) -> list[dict[str, str]]:
    rows = (
        (
            await app_db.execute(
                select(UserProjectIndex)
                .where(UserProjectIndex.username == username)
                .order_by(UserProjectIndex.project_name.asc())
            )
        )
        .scalars()
        .all()
    )
    return [{"project_uuid": r.project_uuid, "project_name": r.project_name} for r in rows]


@global_auth_router.get("/bootstrap", response_model=BootstrapInfoOut)
async def auth_bootstrap_info(
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> BootstrapInfoOut:
    """Return whether initial unauthenticated project creation is permitted + known projects."""
    rows = (
        (await app_db.execute(select(KnownProject).order_by(KnownProject.last_opened.desc())))
        .scalars()
        .all()
    )
    valid_projects: list[LoginProjectOption] = []
    stale_projects: list[StaleProjectOut] = []
    for r in rows:
        if (Path(r.path) / "00_Pipeline" / "project.json").is_file():
            valid_projects.append(LoginProjectOption(uuid=r.uuid, name=r.name))
        else:
            stale_projects.append(StaleProjectOut(uuid=r.uuid, name=r.name, path=r.path))
    bootstrap_allowed = len(valid_projects) == 0
    return BootstrapInfoOut(
        bootstrap_allowed=bootstrap_allowed,
        projects=valid_projects,
        # Paths are only disclosed while nobody can sign in anyway (bootstrap mode).
        stale_projects=stale_projects if bootstrap_allowed else [],
    )


@global_auth_router.get("/me", response_model=AuthMeOut)
async def auth_me_global(
    auth: Annotated[AuthContext, Depends(get_current_auth_allow_password_change)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> AuthMeOut:
    projs = await _projects_for_username(app_db, auth.user.username)
    return AuthMeOut.model_validate(serialize_auth_payload(auth, projects_working_on=projs))


@project_auth_router.post("/login", response_model=AuthMeOut)
async def login(
    project_uuid: str,
    payload: LoginRequest,
    request: Request,
    response: Response,
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
    _prev_auth: Annotated[AuthContext | None, Depends(get_optional_auth)] = None,
) -> AuthMeOut:
    # Enforce matching path and body project_uuid
    target_uuid = payload.project_uuid or project_uuid
    if target_uuid != project_uuid:
        raise AppError("invalid_request", "Project mismatch on login", status_code=400)

    ip = client_ip_from_request(request)
    username_clean = payload.username.strip()
    if is_locked_out(project_uuid, username_clean, ip):
        verify_dummy_password(payload.password)
        raise AppError(
            "unauthorized",
            "Invalid credentials or account temporarily locked",
            status_code=401,
        )

    ctx = await registry.get_project(project_uuid, app_db)

    async with ctx.session_factory() as db:
        # Rotate any previously held session cookie before issuing a new one
        prev_parsed = parse_session_cookie(request.cookies.get(SESSION_COOKIE_NAME))
        if prev_parsed is not None and prev_parsed[0] == project_uuid:
            await revoke_session_by_raw_token(db, prev_parsed[1])

        user = (
            await db.execute(select(User).where(User.username == username_clean))
        ).scalar_one_or_none()

        if user is None or not user.is_active:
            verify_dummy_password(payload.password)
            locked = record_failed_login(
                project_uuid,
                username_clean,
                ip,
                max_attempts=settings.lockout_max_attempts,
                lockout_minutes=settings.lockout_minutes,
            )
            await write_audit(
                db,
                user_id=user.id if user is not None else None,
                action="auth.login_failed",
                target_type="user",
                target_id=username_clean,
                ip=ip,
                detail={"locked": locked, "reason": "invalid_or_inactive"},
            )
            await db.commit()
            raise AppError(
                "unauthorized",
                "Invalid credentials or account temporarily locked",
                status_code=401,
            )

        if not verify_password(user.password_hash, payload.password):
            locked = record_failed_login(
                project_uuid,
                username_clean,
                ip,
                max_attempts=settings.lockout_max_attempts,
                lockout_minutes=settings.lockout_minutes,
            )
            await write_audit(
                db,
                user_id=user.id,
                action="auth.login_failed",
                target_type="user",
                target_id=str(user.id),
                ip=ip,
                detail={"locked": locked, "reason": "bad_password"},
            )
            await db.commit()
            raise AppError(
                "unauthorized",
                "Invalid credentials or account temporarily locked",
                status_code=401,
            )

        clear_failed_logins(project_uuid, username_clean, ip)
        user.last_login_at = datetime.now(UTC)
        sess, raw_token, csrf_token = await create_user_session(
            db,
            user_id=user.id,
            ip=ip,
            user_agent=request.headers.get("user-agent"),
            settings=settings,
        )
        await write_audit(
            db,
            user_id=user.id,
            action="auth.login",
            target_type="user",
            target_id=str(user.id),
            ip=ip,
            detail={"username": user.username, "must_change_password": user.must_change_password},
        )
        await db.commit()

        from app.models.project_db import ProjectMeta
        from app.services.permissions import load_user_permissions_bundle

        meta = (
            await db.execute(select(ProjectMeta).where(ProjectMeta.uuid == project_uuid))
        ).scalar_one_or_none()
        proj_status = meta.status if meta is not None else "active"
        role, perms, caps, comp_depts, user_depts, my_caps = await load_user_permissions_bundle(
            db, user
        )
        auth = AuthContext(
            user=user,
            role=role,
            project_uuid=project_uuid,
            project_status=proj_status,
            session=sess,
            permissions=perms,
            capacity_permissions=caps,
            user_company_dept_ids=comp_depts,
            user_dept_ids=user_depts,
            my_task_capacities=my_caps,
        )

    set_auth_cookies(
        response,
        project_uuid=project_uuid,
        raw_token=raw_token,
        csrf_token=csrf_token,
        settings=settings,
    )
    projs = await _projects_for_username(app_db, auth.user.username)
    return AuthMeOut.model_validate(serialize_auth_payload(auth, projects_working_on=projs))


@project_auth_router.get("/me", response_model=AuthMeOut)
async def auth_me_project(
    auth: Annotated[AuthContext, Depends(get_project_auth_allow_password_change)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> AuthMeOut:
    projs = await _projects_for_username(app_db, auth.user.username)
    return AuthMeOut.model_validate(serialize_auth_payload(auth, projects_working_on=projs))


@project_auth_router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    auth: Annotated[AuthContext, Depends(get_project_auth_allow_password_change)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    ip = client_ip_from_request(request)
    parsed = parse_session_cookie(request.cookies.get(SESSION_COOKIE_NAME))
    if parsed is not None:
        await revoke_session_by_raw_token(db, parsed[1])
    await write_audit(
        db,
        user_id=auth.user.id,
        action="auth.logout",
        target_type="user",
        target_id=str(auth.user.id),
        ip=ip,
    )
    await db.commit()
    clear_auth_cookies(response)
    response.status_code = 204
    return response


@project_auth_router.post("/change-password", response_model=AuthMeOut)
async def change_password(
    project_uuid: str,
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    auth: Annotated[AuthContext, Depends(get_project_auth_allow_password_change)],
    db: Annotated[AsyncSession, Depends(get_db)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> AuthMeOut:
    ip = client_ip_from_request(request)
    user = await db.get(User, auth.user.id)
    if user is None:
        raise AppError("unauthorized", "User not found", status_code=401)

    if not user.must_change_password:
        if not payload.current_password or not verify_password(
            user.password_hash, payload.current_password
        ):
            raise AppError("unauthorized", "Current password is incorrect", status_code=401)
    elif payload.current_password and not verify_password(
        user.password_hash, payload.current_password
    ):
        raise AppError("unauthorized", "Current password is incorrect", status_code=401)

    validate_password(payload.new_password, user.username)
    if verify_password(user.password_hash, payload.new_password):
        raise AppError(
            "weak_password",
            "New password must differ from the current password",
            status_code=400,
        )

    from app.services.auth_service import hash_password

    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.has_initial_password = False

    # Revoke ALL sessions (old + other devices) and rotate to a fresh session
    await revoke_all_user_sessions(db, user.id)
    new_sess, raw_token, csrf_token = await create_user_session(
        db,
        user_id=user.id,
        ip=ip,
        user_agent=request.headers.get("user-agent"),
        settings=settings,
    )
    await write_audit(
        db,
        user_id=user.id,
        action="auth.password_changed",
        target_type="user",
        target_id=str(user.id),
        ip=ip,
    )
    await db.commit()
    await db.refresh(user)

    set_auth_cookies(
        response,
        project_uuid=project_uuid,
        raw_token=raw_token,
        csrf_token=csrf_token,
        settings=settings,
    )
    auth.user = user
    auth.session = new_sess
    projs = await _projects_for_username(app_db, user.username)
    return AuthMeOut.model_validate(serialize_auth_payload(auth, projects_working_on=projs))
