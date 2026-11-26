"""CR04 §5/§7: milestones, per-user schedule drafts and immutable schedule versions."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, utc_now

MILESTONE_TARGETS: tuple[str, ...] = ("department", "user", "entity", "task", "company")


class Milestone(TimestampMixin, Base):
    """A deliver date (final date) or milestone, optionally attached to one target."""

    __tablename__ = "milestones"
    __table_args__ = (
        CheckConstraint("kind IN ('deliver', 'milestone')", name="ck_milestone_kind"),
        CheckConstraint("status IN ('open', 'done')", name="ck_milestone_status"),
        CheckConstraint(
            "(CASE WHEN department_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN user_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN entity_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN task_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN company_id IS NULL THEN 0 ELSE 1 END) <= 1",
            name="ck_milestone_single_target",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="milestone", nullable=False)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), index=True, nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), index=True, nullable=True
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=True
    )
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(8), default="open", nullable=False)
    # Shared with client users (clients only ever see shared milestones).
    client_visible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    @property
    def target_kind(self) -> str:
        for kind in MILESTONE_TARGETS:
            if getattr(self, f"{kind}_id") is not None:
                return kind
        return "none"

    @property
    def target_id(self) -> uuid.UUID | None:
        kind = self.target_kind
        return None if kind == "none" else getattr(self, f"{kind}_id")


class ScheduleDraft(TimestampMixin, Base):
    """One pending (unsaved) schedule edit session per user."""

    __tablename__ = "schedule_drafts"
    __table_args__ = (UniqueConstraint("user_id", name="uq_schedule_draft_user"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Set when the draft was produced by "Jump to version".
    base_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("schedule_versions.id", ondelete="SET NULL"), nullable=True
    )

    changes: Mapped[list[ScheduleDraftChange]] = relationship(
        cascade="all, delete-orphan",
        order_by="ScheduleDraftChange.created_at.asc()",
        lazy="selectin",
    )


class ScheduleDraftChange(Base):
    """One pending change. `base_json` holds the live values when first touched (conflicts)."""

    __tablename__ = "schedule_draft_changes"
    __table_args__ = (
        CheckConstraint("kind IN ('task', 'milestone', 'activation')", name="ck_draft_kind"),
        CheckConstraint("op IN ('create', 'update', 'delete', 'assign')", name="ck_draft_op"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    draft_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("schedule_drafts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    op: Mapped[str] = mapped_column(String(8), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    base_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    label: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now(), nullable=False
    )


class ScheduleVersion(Base):
    """Immutable numbered snapshot (S0001, S0002, ...) of everything schedule-related."""

    __tablename__ = "schedule_versions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now(), nullable=False
    )
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Snapshot of tasks (dates + assignments), milestones and activation periods.
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    diff_summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    @property
    def label(self) -> str:
        return f"S{self.number:04d}"
