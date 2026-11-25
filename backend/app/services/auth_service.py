from __future__ import annotations

import contextlib
import hashlib
import hmac
import secrets
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import argon2
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Response
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.settings import Settings
from app.models.app_db import KnownProject
from app.models.user import AuditLog, User, UserSession
from app.services.launcher_service import is_loopback_client

SESSION_COOKIE_NAME = "organum_session"
CSRF_COOKIE_NAME = "organum_csrf"

_HASHER = argon2.PasswordHasher(type=argon2.Type.ID)
_DUMMY_HASH: str = _HASHER.hash("organum-dummy-constant-time-verification-value")

# Curated common-password blocklist (lowercased)
_COMMON_PASSWORDS: frozenset[str] = frozenset(
    {
        "1234567890",
        "12345678901",
        "123456789012",
        "0987654321",
        "password123",
        "password1234",
        "password!1",
        "qwerty1234",
        "qwertyuiop",
        "admin12345",
        "administrator",
        "letmein123",
        "welcome123",
        "changeme12",
        "changeme123",
        "iloveyou12",
        "trustno123",
        "abc1234567",
        "1111111111",
        "0000000000",
        "aaaaaaaaaa",
        "organum123",
        "organum2026",
        "passw0rd12",
        "p@ssword12",
        "sunshine12",
        "princess12",
        "dragon1234",
        "monkey1234",
        "shadow1234",
        "master1234",
        "superman12",
        "michael123",
        "jennifer12",
        "computer12",
        "michelle12",
        "jessica123",
        "pepper1234",
        "12345qwert",
        "qazwsxedcr",
        "zxcvbnmasd",
        "football12",
        "baseball12",
        "starwars12",
        "pokemon123",
        "naruto1234",
        "access1234",
        "secret1234",
    }
)


def hash_password(password: str) -> str:
    """Hash a plaintext password using Argon2id."""
    return _HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Verify a plaintext password against an Argon2id hash in constant time."""
    try:
        return bool(_HASHER.verify(password_hash, password))
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def verify_dummy_password(password: str) -> None:
    """Perform constant-time Argon2id work when a username does not exist."""
    with contextlib.suppress(VerifyMismatchError, VerificationError, InvalidHashError):
        _HASHER.verify(_DUMMY_HASH, password)


def validate_password(password: str, username: str) -> None:
    """Enforce CR03 password policy: >= 10 chars, != username, not common."""
    if len(password) < 10:
        raise AppError(
            "weak_password",
            "Password must be at least 10 characters long",
            status_code=400,
        )
    if len(password) > 256:
        raise AppError(
            "weak_password",
            "Password must not exceed 256 characters",
            status_code=400,
        )
    if password.strip().lower() == username.strip().lower():
        raise AppError(
            "weak_password",
            "Password cannot be the same as the username",
            status_code=400,
        )
    if password.strip().lower() in _COMMON_PASSWORDS:
        raise AppError(
            "weak_password",
            "Password is too common; choose a stronger passphrase",
            status_code=400,
        )


def hash_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


# In-memory brute-force lockout state: key -> [attempt_timestamps, locked_until]
_FAILED_ATTEMPTS: dict[tuple[str, str, str], list[datetime]] = defaultdict(list)
_LOCKED_UNTIL: dict[tuple[str, str, str], datetime] = {}


def reset_lockouts() -> None:
    """Reset in-memory lockout counters (for tests)."""
    _FAILED_ATTEMPTS.clear()
    _LOCKED_UNTIL.clear()


def is_locked_out(project_uuid: str, username: str, ip: str) -> bool:
    key = (project_uuid, username.strip().lower(), ip)
    until = _LOCKED_UNTIL.get(key)
    if until is None:
        return False
    now = datetime.now(UTC)
    if now >= until:
        _LOCKED_UNTIL.pop(key, None)
        _FAILED_ATTEMPTS.pop(key, None)
        return False
    return True


def record_failed_login(
    project_uuid: str,
    username: str,
    ip: str,
    *,
    max_attempts: int = 5,
    lockout_minutes: int = 15,
) -> bool:
    """Record a failed login attempt and return True if now locked out."""
    key = (project_uuid, username.strip().lower(), ip)
    now = datetime.now(UTC)
    window_start = now - timedelta(minutes=lockout_minutes)
    recent = [ts for ts in _FAILED_ATTEMPTS[key] if ts > window_start]
    recent.append(now)
    _FAILED_ATTEMPTS[key] = recent
    if len(recent) >= max_attempts:
        _LOCKED_UNTIL[key] = now + timedelta(minutes=lockout_minutes)
        return True
    return False


def clear_failed_logins(project_uuid: str, username: str, ip: str) -> None:
    key = (project_uuid, username.strip().lower(), ip)
    _FAILED_ATTEMPTS.pop(key, None)
    _LOCKED_UNTIL.pop(key, None)


def parse_session_cookie(cookie_value: str | None) -> tuple[str, str] | None:
    if not cookie_value or "." not in cookie_value:
        return None
    project_uuid, raw_token = cookie_value.split(".", 1)
    if not project_uuid or not raw_token:
        return None
    return project_uuid, raw_token


def set_auth_cookies(
    response: Response,
    *,
    project_uuid: str,
    raw_token: str,
    csrf_token: str,
    settings: Settings,
) -> None:
    max_age = settings.session_absolute_days * 24 * 3600
    secure = settings.environment.lower() == "production"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=f"{project_uuid}.{raw_token}",
        max_age=max_age,
        httponly=True,
        samesite="strict",
        secure=secure,
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        max_age=max_age,
        httponly=False,
        samesite="strict",
        secure=secure,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")


async def create_user_session(
    db: AsyncSession,
    *,
    user_id: UUID,
    ip: str | None,
    user_agent: str | None,
    settings: Settings,
) -> tuple[UserSession, str, str]:
    """Create a fresh opaque 256-bit session and CSRF token; store only SHA-256 token hash."""
    raw_token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    sess = UserSession(
        user_id=user_id,
        token_hash=hash_session_token(raw_token),
        csrf_token=csrf_token,
        ip=ip,
        user_agent=(user_agent or "")[:256] or None,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=settings.session_absolute_days),
    )
    db.add(sess)
    await db.flush()
    return sess, raw_token, csrf_token


async def revoke_session_by_raw_token(db: AsyncSession, raw_token: str) -> None:
    now = datetime.now(UTC)
    t_hash = hash_session_token(raw_token)
    await db.execute(
        update(UserSession)
        .where(UserSession.token_hash == t_hash, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def revoke_all_user_sessions(
    db: AsyncSession,
    user_id: UUID,
    *,
    except_session_id: UUID | None = None,
) -> None:
    now = datetime.now(UTC)
    stmt = (
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    await db.execute(stmt)


async def cleanup_expired_sessions(db: AsyncSession) -> None:
    now = datetime.now(UTC)
    await db.execute(delete(UserSession).where(UserSession.expires_at < now))


async def write_audit(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    ip: str | None = None,
    detail: dict[str, Any] | None = None,
) -> AuditLog:
    row = AuditLog(
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        ip=ip,
        detail_json=detail or {},
    )
    db.add(row)
    await db.flush()
    return row


def constant_time_equal(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


async def verify_startup_security(
    settings: Settings,
    app_db: AsyncSession,
    project_registry: Any,
) -> None:
    """Refuse non-loopback bind if any project user still has the initial password."""
    if is_loopback_client(settings.bind_host):
        return

    known_rows = (await app_db.execute(select(KnownProject))).scalars().all()
    for row in known_rows:
        proj_dir = Path(row.path)
        if not (proj_dir / "00_Pipeline" / "project.json").is_file():
            continue
        ctx = await project_registry.get_project(row.uuid, app_db)
        async with ctx.session_factory() as proj_db:
            flagged = (
                (
                    await proj_db.execute(
                        select(User).where(
                            User.has_initial_password.is_(True), User.is_active.is_(True)
                        )
                    )
                )
                .scalars()
                .first()
            )
            if flagged is not None:
                raise RuntimeError(
                    "Refusing non-loopback bind while an account still uses the initial password"
                )
