from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, utc_now


class TaskDependency(Base):
    """Blocking finish-to-start dependency connecting two tasks across or within entities."""

    __tablename__ = "task_dependencies"

    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    upstream_task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    threshold: Mapped[str] = mapped_column(
        String(16), default="APP", nullable=False
    )  # 'APP' | 'PUBLISHED' | 'ANY_STATUS'
    from_entity_link: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        nullable=False,
    )


class TaskTag(Base):
    """Many-to-many join linking tasks to canonical Tag rows."""

    __tablename__ = "task_tags"

    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class TimeLog(Base):
    """Worked time entry for a task; sum cached onto tasks.logged_hours."""

    __tablename__ = "time_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    work_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    hours: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        nullable=False,
    )


class TaskComment(Base):
    """Threaded note, review comment, or media/annotation reference on a task."""

    __tablename__ = "task_comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("task_comments.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(
        String(16), default="note", nullable=False
    )  # 'note' | 'review' | 'media'
    visibility: Mapped[str] = mapped_column(
        String(16), default="internal", index=True, nullable=False
    )  # 'internal' | 'client'
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("product_versions.id", ondelete="SET NULL"), nullable=True
    )
    file_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    annotation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("annotations.id", ondelete="SET NULL"), nullable=True
    )
    frame: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        index=True,
        nullable=False,
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TaskReview(Base):
    """Per-round review decision across lead, supervisor, and client stages."""

    __tablename__ = "task_reviews"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    round_no: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("product_versions.id", ondelete="SET NULL"), nullable=True
    )
    stage: Mapped[str] = mapped_column(String(16), nullable=False)  # 'lead' | 'sup' | 'client'
    decision: Mapped[str] = mapped_column(
        String(16), nullable=False
    )  # 'pending' | 'approved' | 'retake'
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acted_as: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    on_behalf_of: Mapped[str | None] = mapped_column(String(128), nullable=True)
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("task_comments.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        index=True,
        nullable=False,
    )


class TaskEvent(Base):
    """Append-only history log of field and status transitions on a task."""

    __tablename__ = "task_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        index=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acted_as: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    source: Mapped[str] = mapped_column(
        String(16), default="user", nullable=False
    )  # 'user' | 'rule' | 'system'
    field: Mapped[str] = mapped_column(String(64), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)


class EntityLink(Base):
    """Directed production relation: source_entity -> target_entity (acyclic)."""

    __tablename__ = "entity_links"
    __table_args__ = (
        UniqueConstraint(
            "source_entity_id",
            "target_entity_id",
            "link_type",
            name="uq_entity_link_triple",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    source_entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), index=True, nullable=False
    )
    target_entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), index=True, nullable=False
    )
    link_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class DependencyTemplate(TimestampMixin, Base):
    """Template mapping upstream->downstream departments/tasks when suggesting link deps."""

    __tablename__ = "dependency_templates"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    upstream_department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    upstream_task_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    downstream_department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    downstream_task_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    threshold: Mapped[str] = mapped_column(String(16), default="APP", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class SavedView(TimestampMixin, Base):
    """Per-user saved filter/layout presets for Tasks views."""

    __tablename__ = "saved_views"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    view_kind: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class Rule(TimestampMixin, Base):
    """Declarative rule evaluated on production triggers or manually in dry-run/apply mode."""

    __tablename__ = "rules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", index=True, nullable=False
    )
    trigger: Mapped[str] = mapped_column(
        String(32), default="manual", nullable=False
    )  # 'entity_created' | 'task_created' | 'link_created' | 'manual'
    conditions_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    actions_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
