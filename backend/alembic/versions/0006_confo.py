"""confo custom typed entity columns

Revision ID: 0006_confo
Revises: 0005_rules_engine
Create Date: 2026-11-26 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_confo"
down_revision: str | Sequence[str] | None = "0005_rules_engine"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column[sa.DateTime]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "confo_columns",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("col_type", sa.String(length=16), nullable=False),
        sa.Column("options_json", sa.JSON(), nullable=False),
        sa.Column("default_text", sa.Text(), nullable=True),
        sa.Column("validation_json", sa.JSON(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_visible", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("edit_roles", sa.JSON(), nullable=False),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("key", name="uq_confo_columns_key"),
    )
    op.create_table(
        "confo_values",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "column_id",
            sa.Uuid(),
            sa.ForeignKey("confo_columns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "entity_id", sa.Uuid(), sa.ForeignKey("entities.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_int", sa.Integer(), nullable=True),
        sa.Column("value_float", sa.Float(), nullable=True),
        sa.Column("value_bool", sa.Boolean(), nullable=True),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column(
            "value_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "value_entity_id",
            sa.Uuid(),
            sa.ForeignKey("entities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        *_timestamps(),
        sa.UniqueConstraint("column_id", "entity_id", name="uq_confo_value_cell"),
    )
    op.create_index("ix_confo_values_column_id", "confo_values", ["column_id"])
    op.create_index("ix_confo_values_entity_id", "confo_values", ["entity_id"])
    op.create_table(
        "confo_value_items",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "value_id",
            sa.Uuid(),
            sa.ForeignKey("confo_values.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item", sa.String(length=128), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index("ix_confo_value_items_value_id", "confo_value_items", ["value_id"])


def downgrade() -> None:
    op.drop_index("ix_confo_value_items_value_id", table_name="confo_value_items")
    op.drop_table("confo_value_items")
    op.drop_index("ix_confo_values_entity_id", table_name="confo_values")
    op.drop_index("ix_confo_values_column_id", table_name="confo_values")
    op.drop_table("confo_values")
    op.drop_table("confo_columns")
