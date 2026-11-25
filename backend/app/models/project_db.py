from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, utc_now


class ProjectMeta(TimestampMixin, Base):
    __tablename__ = "project_meta"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="active", server_default="active", nullable=False
    )  # 'active' | 'on_hold' | 'completed' | 'archived'
    hours_per_day: Mapped[float] = mapped_column(Float, default=8.0, nullable=False)
    working_days: Mapped[list[int]] = mapped_column(
        JSON, default=lambda: [1, 2, 3, 4, 5], nullable=False
    )
    task_code_pattern: Mapped[str] = mapped_column(
        String(128), default="{entity_folder}_{dept_short}_{task_folder}", nullable=False
    )
    require_version_to_submit: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    enforce_dependencies_in_gantt: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    admin_sql_console_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    link_dependency_depth: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class Department(TimestampMixin, Base):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    folder_name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    short_code: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    color: Mapped[str] = mapped_column(String(32), default="--series-1", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    default_tasks: Mapped[list[DepartmentDefaultTask]] = relationship(
        back_populates="department",
        cascade="all, delete-orphan",
        order_by="DepartmentDefaultTask.sort_order.asc()",
    )


class DepartmentDefaultTask(TimestampMixin, Base):
    __tablename__ = "department_default_tasks"
    __table_args__ = (
        UniqueConstraint("department_id", "name", name="uq_dept_default_task_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    folder_name: Mapped[str] = mapped_column(String(128), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    department: Mapped[Department] = relationship(back_populates="default_tasks")


class Entity(TimestampMixin, Base):
    __tablename__ = "entities"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    folder_name: Mapped[str] = mapped_column(String(128), nullable=False)
    rel_path: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_file_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    thumbnail_source: Mapped[str] = mapped_column(String(16), default="auto", nullable=False)
    is_missing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    departments: Mapped[list[EntityDepartment]] = relationship(
        back_populates="entity",
        cascade="all, delete-orphan",
        order_by="EntityDepartment.sort_order.asc()",
    )


class Tag(TimestampMixin, Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)


class EntityTag(Base):
    __tablename__ = "entity_tags"

    entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class EntityData(TimestampMixin, Base):
    __tablename__ = "entity_data"
    __table_args__ = (UniqueConstraint("entity_id", "key", name="uq_entity_data_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), index=True, nullable=False
    )
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    value_type: Mapped[str] = mapped_column(String(16), default="str", nullable=False)
    value_text: Mapped[str] = mapped_column(Text, default="", nullable=False)


class EntityDepartment(TimestampMixin, Base):
    __tablename__ = "entity_departments"
    __table_args__ = (
        UniqueConstraint("entity_id", "department_id", name="uq_entity_department"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), index=True, nullable=False
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    entity: Mapped[Entity] = relationship(back_populates="departments")
    department: Mapped[Department] = relationship()
    tasks: Mapped[list[Task]] = relationship(
        back_populates="entity_department",
        cascade="all, delete-orphan",
        order_by="Task.sort_order.asc()",
    )


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("entity_department_id", "name", name="uq_ent_dept_task"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    entity_department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entity_departments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), index=True, nullable=False
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    folder_name: Mapped[str] = mapped_column(String(128), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    entity_department: Mapped[EntityDepartment] = relationship(back_populates="tasks")
    product: Mapped[Product | None] = relationship(
        back_populates="task", uselist=False, cascade="all, delete-orphan"
    )


class TaskLink(TimestampMixin, Base):
    __tablename__ = "task_links"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    linked_task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    link_type: Mapped[str | None] = mapped_column(String(32), nullable=True)


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    master_version_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    task: Mapped[Task] = relationship(back_populates="product")
    versions: Mapped[list[ProductVersion]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductVersion.version_number.desc()",
    )


class ProductVersion(TimestampMixin, Base):
    __tablename__ = "product_versions"
    __table_args__ = (
        UniqueConstraint("product_id", "version_number", name="uq_product_version_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(32), nullable=False)
    rel_path: Mapped[str] = mapped_column(Text, nullable=False)
    comment: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )

    product: Mapped[Product] = relationship(back_populates="versions")
    files: Mapped[list[FileEntry]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )


class FileEntry(TimestampMixin, Base):
    __tablename__ = "files"
    __table_args__ = (Index("ix_files_sha256", "sha256"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("product_versions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    relative_path: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mtime: Mapped[float] = mapped_column(Float, nullable=False)
    detected_format: Mapped[str] = mapped_column(String(64), default="unsupported", nullable=False)
    media_kind: Mapped[str] = mapped_column(String(32), default="unsupported", nullable=False)
    colorspace_override: Mapped[str | None] = mapped_column(String(64), nullable=True)
    probe_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    is_sequence: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sequence_pattern: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sequence_kind: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    sequence_kind_user_override: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    frame_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frame_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frame_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_missing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    version: Mapped[ProductVersion] = relationship(back_populates="files")


def _keep_utc_now_used() -> datetime:
    return utc_now()

