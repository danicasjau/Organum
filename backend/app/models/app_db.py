from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, String, Text, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.base import TimestampMixin, utc_now


class AppBase(DeclarativeBase):
    """Declarative base for application-wide SQLite tables (data/app.db)."""


class KnownProject(AppBase):
    __tablename__ = "known_projects"

    uuid: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    last_opened: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        nullable=False,
    )


class Launcher(TimestampMixin, AppBase):
    __tablename__ = "launchers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    extension: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    executable_path: Mapped[str] = mapped_column(Text, nullable=False)
    args_template: Mapped[str] = mapped_column(Text, default="{file}", nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class UiPref(AppBase):
    __tablename__ = "ui_prefs"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
        nullable=False,
    )


class UserProjectIndex(AppBase):
    """Per-username index across known projects used for 'Projects working on'."""

    __tablename__ = "user_project_index"

    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_uuid: Mapped[str] = mapped_column(String(36), primary_key=True, index=True)
    project_name: Mapped[str] = mapped_column(String(128), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
        nullable=False,
    )


