"""milestones, schedule drafts and schedule versions

Revision ID: 0008_schedule_versions
Revises: 0007_people_scheduling
Create Date: 2026-11-26 15:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_schedule_versions"
down_revision: str | Sequence[str] | None = "0007_people_scheduling"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts() -> list[sa.Column[sa.DateTime]]:
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
        "milestones",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=16), server_default="milestone", nullable=False),
        sa.Column(
            "department_id",
            sa.Uuid(),
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column(
            "entity_id", sa.Uuid(), sa.ForeignKey("entities.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column(
            "task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column(
            "company_id",
            sa.Uuid(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("status", sa.String(length=8), server_default="open", nullable=False),
        sa.Column("client_visible", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        *_ts(),
        sa.CheckConstraint("kind IN ('deliver', 'milestone')", name="ck_milestone_kind"),
        sa.CheckConstraint("status IN ('open', 'done')", name="ck_milestone_status"),
        sa.CheckConstraint(
            "(CASE WHEN department_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN user_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN entity_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN task_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN company_id IS NULL THEN 0 ELSE 1 END) <= 1",
            name="ck_milestone_single_target",
        ),
    )
    for col in ("date", "department_id", "user_id", "entity_id", "task_id", "company_id"):
        op.create_index(f"ix_milestones_{col}", "milestones", [col])

    op.create_table(
        "schedule_versions",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column(
            "author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("is_starred", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("snapshot_json", sa.JSON(), nullable=False),
        sa.Column("diff_summary_json", sa.JSON(), nullable=False),
        sa.UniqueConstraint("number", name="uq_schedule_versions_number"),
    )

    op.create_table(
        "schedule_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "base_version_id",
            sa.Uuid(),
            sa.ForeignKey("schedule_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *_ts(),
        sa.UniqueConstraint("user_id", name="uq_schedule_draft_user"),
    )
    op.create_index("ix_schedule_drafts_user_id", "schedule_drafts", ["user_id"])

    op.create_table(
        "schedule_draft_changes",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "draft_id",
            sa.Uuid(),
            sa.ForeignKey("schedule_drafts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("op", sa.String(length=8), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("base_json", sa.JSON(), nullable=True),
        sa.Column("label", sa.String(length=256), server_default="", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("kind IN ('task', 'milestone', 'activation')", name="ck_draft_kind"),
        sa.CheckConstraint("op IN ('create', 'update', 'delete', 'assign')", name="ck_draft_op"),
    )
    op.create_index("ix_schedule_draft_changes_draft_id", "schedule_draft_changes", ["draft_id"])


def downgrade() -> None:
    op.drop_index("ix_schedule_draft_changes_draft_id", table_name="schedule_draft_changes")
    op.drop_table("schedule_draft_changes")
    op.drop_index("ix_schedule_drafts_user_id", table_name="schedule_drafts")
    op.drop_table("schedule_drafts")
    op.drop_table("schedule_versions")
    for col in ("date", "department_id", "user_id", "entity_id", "task_id", "company_id"):
        op.drop_index(f"ix_milestones_{col}", table_name="milestones")
    op.drop_table("milestones")
