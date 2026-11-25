from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
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


class Annotation(TimestampMixin, Base):
    """Saved 2D, 3D, or audio annotation bound to a file version."""

    __tablename__ = "annotations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    file_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("files.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # '2d' | '3d' | 'audio'
    coord_space: Mapped[str] = mapped_column(
        String(16), default="image", nullable=False
    )  # 'image' | 'uv' | 'plane' | 'world'
    frame_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frame_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_base: Mapped[float | None] = mapped_column(Float, nullable=True)
    note_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    vector_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    plane_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    camera_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    visibility: Mapped[str] = mapped_column(
        String(16), default="internal", server_default="internal", nullable=False
    )  # 'internal' | 'client'
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AnnotationRevision(Base):
    """Append-only revision audit log for annotations (§11)."""

    __tablename__ = "annotation_revisions"
    __table_args__ = (
        UniqueConstraint("annotation_id", "revision_no", name="uq_annotation_revision_no"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    annotation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("annotations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        nullable=False,
    )
