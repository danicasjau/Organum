from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_settings_dep
from app.core.errors import AppError
from app.core.settings import Settings
from app.models.user import User


def create_access_token(
    user_id: UUID,
    username: str,
    settings: Settings,
    expires_minutes: int = 60 * 24,
) -> str:
    """Create a signed JWT token for future multi-user support."""
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "username": username,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    """Decode and validate a JWT access token."""
    try:
        decoded: dict[str, Any] = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        return decoded
    except jwt.PyJWTError as exc:
        raise AppError("unauthorized", "Invalid authentication token", status_code=401) from exc


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """Resolve current user via Bearer JWT if supplied, else return the seeded single user."""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        claims = decode_access_token(token, settings)
        user_id = UUID(str(claims["sub"]))
        user = await db.get(User, user_id)
        if user is None:
            raise AppError("unauthorized", "User not found", status_code=401)
        return user

    result = await db.execute(select(User).where(User.username == settings.default_user_username))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            username=settings.default_user_username,
            display_name=settings.default_user_display_name,
            role="reviewer",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return user

