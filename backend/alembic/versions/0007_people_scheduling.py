"""working hours, activation periods, company comments and member links

Revision ID: 0007_people_scheduling
Revises: 0006_confo
Create Date: 2026-11-26 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_people_scheduling"
down_revision: str | Sequence[str] | None = "0006_confo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _fk(table: str, ondelete: str = "CASCADE") -> sa.ForeignKey:
    return sa.ForeignKey(f"{table}.id", ondelete=ondelete)


def upgrade() -> None:
    op.create_table(
        "user_work_hours",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), _fk("users"), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_min", sa.Integer(), nullable=False),
        sa.Column("end_min", sa.Integer(), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 1 AND 7", name="ck_work_hours_weekday"),
        sa.CheckConstraint(
            "start_min >= 0 AND end_min <= 1440 AND start_min < end_min",
            name="ck_work_hours_range",
        ),
    )
    op.create_index("ix_user_work_hours_user_id", "user_work_hours", ["user_id"])

    op.create_table(
        "user_work_exceptions",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), _fk("users"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("start_min", sa.Integer(), nullable=True),
        sa.Column("end_min", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(length=256), server_default="", nullable=False),
    )
    op.create_index("ix_user_work_exceptions_user_id", "user_work_exceptions", ["user_id"])
    op.create_index("ix_user_work_exceptions_day", "user_work_exceptions", ["day"])

    op.create_table(
        "activation_periods",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("department_id", sa.Uuid(), _fk("departments"), nullable=True),
        sa.Column("company_id", sa.Uuid(), _fk("companies"), nullable=True),
        sa.Column("user_id", sa.Uuid(), _fk("users"), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=256), server_default="", nullable=False),
        sa.Column("created_by", sa.Uuid(), _fk("users", "SET NULL"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("start_date <= end_date", name="ck_activation_dates"),
        sa.CheckConstraint(
            "(CASE WHEN department_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN company_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN user_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_activation_single_target",
        ),
    )
    for col in ("department_id", "company_id", "user_id"):
        op.create_index(f"ix_activation_periods_{col}", "activation_periods", [col])

    op.create_table(
        "company_comments",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), _fk("companies"), nullable=False),
        sa.Column("author_id", sa.Uuid(), _fk("users", "SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_company_comments_company_id", "company_comments", ["company_id"])

    op.create_table(
        "company_members",
        sa.Column("company_id", sa.Uuid(), _fk("companies"), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), _fk("users"), primary_key=True, nullable=False),
        sa.UniqueConstraint("company_id", "user_id", name="uq_company_member"),
    )
    op.create_index("ix_company_members_user_id", "company_members", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_company_members_user_id", table_name="company_members")
    op.drop_table("company_members")
    op.drop_index("ix_company_comments_company_id", table_name="company_comments")
    op.drop_table("company_comments")
    for col in ("department_id", "company_id", "user_id"):
        op.drop_index(f"ix_activation_periods_{col}", table_name="activation_periods")
    op.drop_table("activation_periods")
    op.drop_index("ix_user_work_exceptions_day", table_name="user_work_exceptions")
    op.drop_index("ix_user_work_exceptions_user_id", table_name="user_work_exceptions")
    op.drop_table("user_work_exceptions")
    op.drop_index("ix_user_work_hours_user_id", table_name="user_work_hours")
    op.drop_table("user_work_hours")
