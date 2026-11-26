"""CR04 §3 Confo: user-defined, typed per-entity data columns.

Values live in explicit typed columns (one per storage kind) rather than a JSON blob, so
they can be filtered, sorted and constrained in SQL. Multi-select values are child rows.
"""

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
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

CONFO_COLUMN_TYPES: tuple[str, ...] = (
    "text",
    "integer",
    "float",
    "boolean",
    "select",
    "multiselect",
    "date",
    "url",
    "user",
    "color",
    "entity",
)


class ConfoColumn(TimestampMixin, Base):
    __tablename__ = "confo_columns"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    col_type: Mapped[str] = mapped_column(String(16), nullable=False)
    # Select / multiselect choices (column definition, not values).
    options_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    # Raw default, parsed with the column type; applies to entities with no stored value.
    default_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # {"required": bool, "min": num, "max": num, "regex": str, "max_length": int}
    validation_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Role names allowed to edit values (empty = anyone holding confo.edit).
    edit_roles: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ConfoValue(TimestampMixin, Base):
    __tablename__ = "confo_values"
    __table_args__ = (UniqueConstraint("column_id", "entity_id", name="uq_confo_value_cell"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    column_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("confo_columns.id", ondelete="CASCADE"), index=True, nullable=False
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="CASCADE"), index=True, nullable=False
    )
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_int: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value_float: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_bool: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    value_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    value_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    items: Mapped[list[ConfoValueItem]] = relationship(
        cascade="all, delete-orphan",
        order_by="ConfoValueItem.sort_order.asc()",
        lazy="selectin",
    )


class ConfoValueItem(Base):
    """One chosen option of a multi-select cell."""

    __tablename__ = "confo_value_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    value_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("confo_values.id", ondelete="CASCADE"), index=True, nullable=False
    )
    item: Mapped[str] = mapped_column(String(128), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
