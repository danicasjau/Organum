from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlparse
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_db, get_project_registry, get_settings_dep
from app.core.errors import AppError
from app.core.project_registry import ProjectRegistry
from app.core.settings import Settings
from app.models.project_db import ProjectMeta
from app.models.user import User, UserSession
from app.services.auth_service import (
    CSRF_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    constant_time_equal,
    hash_session_token,
    parse_session_cookie,
)
from app.services.launcher_service import is_loopback_client
from app.services.permissions import (
    WRITE_PERMISSION_KEYS,
    AuthContext,
    load_user_permissions_bundle,
)

_MUTATING_METHODS: frozenset[str] = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def check_origin(request: Request, settings: Settings) -> None:
    """Validate Origin header (if present) on all mutating HTTP requests."""
    if request.method not in _MUTATING_METHODS:
        return
    origin = request.headers.get("origin")
    if not origin:
        return
    parsed = urlparse(origin)
    if not parsed.scheme or not parsed.netloc:
        raise AppError("forbidden", "Invalid Origin header", status_code=403)
    normalized = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"

    allowed = {o.rstrip("/").lower() for o in settings.cors_origins}
    req_host = request.url.hostname
    req_port = request.url.port
    req_scheme = request.url.scheme.lower()
    if req_host:
        netloc = f"{req_host}:{req_port}" if req_port else req_host
        allowed.add(f"{req_scheme}://{netloc.lower()}")
    if normalized in allowed:
        return
    # Allow loopback origin <-> loopback server (e.g. Vite proxy on different port)
    if parsed.hostname and is_loopback_client(parsed.hostname) and is_loopback_client(req_host):
        return
    raise AppError("forbidden", "Cross-origin request rejected", status_code=403)


def check_csrf(request: Request, session: UserSession) -> None:
    """Enforce double-submit CSRF token header matching cookie and session on mutating calls."""
    if request.method not in _MUTATING_METHODS:
        return
    cookie_csrf = request.cookies.get(CSRF_COOKIE_NAME)
    header_csrf = request.headers.get("x-csrf-token")
    if not cookie_csrf or not header_csrf:
        raise AppError("csrf_failed", "Missing CSRF token", status_code=403)
    if not constant_time_equal(cookie_csrf, header_csrf) or not constant_time_equal(
        header_csrf, session.csrf_token
    ):
        raise AppError("csrf_failed", "Invalid CSRF token", status_code=403)


async def _resolve_auth_from_cookie(
    request: Request,
    app_db: AsyncSession,
    registry: ProjectRegistry,
    settings: Settings,
    *,
    require_csrf: bool = True,
    allow_must_change: bool = False,
) -> AuthContext | None:
    check_origin(request, settings)
    parsed = parse_session_cookie(request.cookies.get(SESSION_COOKIE_NAME))
    if parsed is None:
        return None
    proj_uuid, raw_token = parsed

    try:
        ctx = await registry.get_project(proj_uuid, app_db)
    except AppError:
        return None

    token_hash = hash_session_token(raw_token)
    now = datetime.now(UTC)

    async with ctx.session_factory() as db:
        sess = (
            await db.execute(select(UserSession).where(UserSession.token_hash == token_hash))
        ).scalar_one_or_none()
        if sess is None or sess.revoked_at is not None:
            return None
        expires_at = _ensure_utc(sess.expires_at)
        last_seen = _ensure_utc(sess.last_seen_at)
        if now >= expires_at or (now - last_seen) > timedelta(hours=settings.session_idle_hours):
            sess.revoked_at = now
            await db.commit()
            return None

        user = await db.get(User, sess.user_id)
        if user is None or not user.is_active:
            return None

        if require_csrf:
            check_csrf(request, sess)

        if (now - last_seen) > timedelta(seconds=60):
            sess.last_seen_at = now
            await db.commit()

        meta = (
            await db.execute(select(ProjectMeta).where(ProjectMeta.uuid == proj_uuid))
        ).scalar_one_or_none()
        proj_status = meta.status if meta is not None else "active"

        role, perms, caps, comp_depts, user_depts, my_caps = await load_user_permissions_bundle(
            db, user
        )

        auth = AuthContext(
            user=user,
            role=role,
            project_uuid=proj_uuid,
            project_status=proj_status,
            session=sess,
            permissions=perms,
            capacity_permissions=caps,
            user_company_dept_ids=comp_depts,
            user_dept_ids=user_depts,
            my_task_capacities=my_caps,
        )
        if not allow_must_change and user.must_change_password:
            raise AppError(
                "password_change_required",
                "You must change your initial or temporary password before continuing",
                status_code=403,
            )
        return auth


async def get_optional_auth(
    request: Request,
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> AuthContext | None:
    return await _resolve_auth_from_cookie(request, app_db, registry, settings)


async def get_current_auth(
    request: Request,
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> AuthContext:
    auth = await _resolve_auth_from_cookie(request, app_db, registry, settings)
    if auth is None:
        raise AppError("unauthorized", "Authentication required", status_code=401)
    return auth


async def get_current_auth_allow_password_change(
    request: Request,
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> AuthContext:
    auth = await _resolve_auth_from_cookie(
        request, app_db, registry, settings, allow_must_change=True
    )
    if auth is None:
        raise AppError("unauthorized", "Authentication required", status_code=401)
    return auth


async def get_project_auth(
    project_uuid: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
) -> AuthContext:
    if auth.project_uuid != project_uuid:
        raise AppError(
            "unauthorized",
            "Session is not valid for this project; sign in to this project first",
            status_code=401,
        )
    return auth


async def get_project_auth_allow_password_change(
    project_uuid: str,
    auth: Annotated[AuthContext, Depends(get_current_auth_allow_password_change)],
) -> AuthContext:
    if auth.project_uuid != project_uuid:
        raise AppError(
            "unauthorized",
            "Session is not valid for this project; sign in to this project first",
            status_code=401,
        )
    return auth


def require(permission_key: str, *, write: bool = False) -> Callable[..., Awaitable[AuthContext]]:
    """FastAPI dependency factory enforcing role-level scope != 'none' and archive lock."""

    async def _dependency(
        auth: Annotated[AuthContext, Depends(get_project_auth)],
    ) -> AuthContext:
        if (
            (write or permission_key in WRITE_PERMISSION_KEYS)
            and auth.project_status == "archived"
            and auth.role.name != "admin"
        ):
            raise AppError(
                "forbidden",
                "Project is archived and read-only for non-administrators",
                status_code=403,
            )
        if not auth.has_any_scope(permission_key):
            raise AppError(
                "forbidden",
                f"Missing required permission '{permission_key}'",
                status_code=403,
            )
        return auth

    return _dependency


async def require_not_archived(auth: AuthContext) -> None:
    if auth.project_status == "archived" and auth.role.name != "admin":
        raise AppError(
            "forbidden",
            "Project is archived and read-only for non-administrators",
            status_code=403,
        )


def client_ip_from_request(request: Request) -> str:
    return request.client.host if request.client and request.client.host else "unknown"


# Backwards-compatible alias type if imported anywhere by legacy code
def require_admin_global() -> Callable[..., Awaitable[AuthContext]]:
    async def _dep(auth: Annotated[AuthContext, Depends(get_current_auth)]) -> AuthContext:
        if auth.role.name != "admin":
            raise AppError("forbidden", "Administrator privileges required", status_code=403)
        return auth

    return _dep


def get_current_user_id(auth: AuthContext) -> UUID:
    return auth.user.id
