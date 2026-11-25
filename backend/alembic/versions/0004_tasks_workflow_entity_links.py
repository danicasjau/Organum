"""tasks, workflow fields, time logs, comments, reviews, events, entity links, templates

Revision ID: 0004_tasks_workflow_entity_links
Revises: 0003_auth_users_roles_companies
Create Date: 2026-11-25 10:15:00.000000
"""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_tasks_workflow_entity_links"
down_revision: str | Sequence[str] | None = "0003_auth_users_roles_companies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _sanitize_code_token(raw: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]+", "_", raw).strip("_") or "X"


def upgrade() -> None:
    with op.batch_alter_table("department_default_tasks") as batch:
        batch.add_column(
            sa.Column("needs_lead_review", sa.Boolean(), server_default=sa.true(), nullable=False)
        )
        batch.add_column(
            sa.Column("needs_sup_review", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
        batch.add_column(
            sa.Column(
                "needs_client_review", sa.Boolean(), server_default=sa.false(), nullable=False
            )
        )
        batch.add_column(
            sa.Column(
                "default_priority",
                sa.String(length=16),
                server_default="normal",
                nullable=False,
            )
        )
        batch.add_column(sa.Column("default_bid_hours", sa.Float(), nullable=True))
        batch.add_column(sa.Column("default_complexity", sa.Integer(), nullable=True))

    op.drop_index("ix_tasks_assigned_to_user_id", table_name="tasks")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("assigned_to_user_id")
        batch.drop_column("due_date")
        batch.add_column(sa.Column("task_code", sa.String(length=128), nullable=True))
        batch.add_column(
            sa.Column("task_name", sa.String(length=256), server_default="", nullable=False)
        )
        batch.add_column(sa.Column("parent_entity_type", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("description", sa.Text(), server_default="", nullable=False))
        batch.add_column(sa.Column("status_before_hold", sa.String(length=32), nullable=True))
        batch.add_column(
            sa.Column("priority", sa.String(length=16), server_default="normal", nullable=False)
        )
        batch.add_column(
            sa.Column("needs_lead_review", sa.Boolean(), server_default=sa.true(), nullable=False)
        )
        batch.add_column(
            sa.Column("needs_sup_review", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
        batch.add_column(
            sa.Column(
                "needs_client_review", sa.Boolean(), server_default=sa.false(), nullable=False
            )
        )
        batch.add_column(sa.Column("complexity_rating", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("ideal_start_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("actual_start_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("ideal_finish_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("actual_finish_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("bid_hours", sa.Float(), nullable=True))
        batch.add_column(sa.Column("logged_hours", sa.Float(), server_default="0", nullable=False))
        batch.add_column(
            sa.Column("retake_count", sa.Integer(), server_default="0", nullable=False)
        )
        batch.add_column(sa.Column("latest_version_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("approved_version_id", sa.Uuid(), nullable=True))

    # Backfill task_code, task_name, parent_entity_type, status, and latest_version_id
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT
                t.id,
                t.name,
                t.folder_name,
                t.status,
                e.folder_name AS ent_folder,
                e.entity_type AS ent_type,
                d.name AS dept_name,
                d.short_code AS dept_short,
                d.folder_name AS dept_folder
            FROM tasks t
            JOIN entities e ON e.id = t.entity_id
            JOIN departments d ON d.id = t.department_id
            ORDER BY t.created_at ASC, t.id ASC
            """
        )
    ).fetchall()

    used_codes: set[str] = set()
    for row in rows:
        tid, tname, tfolder, tstatus, efolder, etype, dname, dshort, dfolder = row
        short = _sanitize_code_token(str(dshort or dfolder or "DPT")).upper()
        base = f"{_sanitize_code_token(str(efolder))}_{short}_{_sanitize_code_token(str(tfolder))}"
        code = base[:120]
        suffix = 2
        while code.lower() in used_codes:
            code = f"{base[:110]}_{suffix}"
            suffix += 1
        used_codes.add(code.lower())

        full_tname = f"{dname} - {tname}"
        clean_status = str(tstatus) if tstatus else "RDY"

        latest_row = bind.execute(
            sa.text(
                """
                SELECT pv.id
                FROM product_versions pv
                JOIN products p ON p.id = pv.product_id
                WHERE p.task_id = :tid
                ORDER BY pv.version_number DESC
                LIMIT 1
                """
            ),
            {"tid": tid},
        ).fetchone()
        latest_vid = latest_row[0] if latest_row is not None else None

        bind.execute(
            sa.text(
                """
                UPDATE tasks
                SET task_code = :code,
                    task_name = :tname,
                    parent_entity_type = :etype,
                    status = :status,
                    latest_version_id = :lvid
                WHERE id = :tid
                """
            ),
            {
                "code": code,
                "tname": full_tname,
                "etype": etype,
                "status": clean_status,
                "lvid": latest_vid,
                "tid": tid,
            },
        )

    bind.execute(sa.text("UPDATE project_meta SET schema_version = 4"))

    with op.batch_alter_table("tasks") as batch:
        batch.alter_column("task_code", existing_type=sa.String(length=128), nullable=False)
        batch.alter_column(
            "status",
            existing_type=sa.String(length=32),
            server_default="RDY",
            nullable=False,
        )
        batch.create_foreign_key(
            "fk_tasks_latest_ver",
            "product_versions",
            ["latest_version_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_foreign_key(
            "fk_tasks_approved_ver",
            "product_versions",
            ["approved_version_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index("ix_tasks_task_code", "tasks", ["task_code"], unique=True)
    op.create_index("ix_tasks_parent_entity_type", "tasks", ["parent_entity_type"], unique=False)
    op.create_index("ix_tasks_status", "tasks", ["status"], unique=False)
    op.create_index("ix_tasks_priority", "tasks", ["priority"], unique=False)
    op.create_index("ix_tasks_ideal_start_date", "tasks", ["ideal_start_date"], unique=False)
    op.create_index("ix_tasks_ideal_finish_date", "tasks", ["ideal_finish_date"], unique=False)
    op.create_index("ix_tasks_dept_status", "tasks", ["department_id", "status"], unique=False)
    op.create_index("ix_tasks_entity_dept", "tasks", ["entity_id", "department_id"], unique=False)

    op.create_table(
        "task_dependencies",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("upstream_task_id", sa.Uuid(), nullable=False),
        sa.Column("threshold", sa.String(length=16), nullable=False),
        sa.Column("from_entity_link", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["upstream_task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("task_id", "upstream_task_id"),
    )
    op.create_index("ix_task_dependencies_task_id", "task_dependencies", ["task_id"], unique=False)
    op.create_index(
        "ix_task_dependencies_upstream_task_id",
        "task_dependencies",
        ["upstream_task_id"],
        unique=False,
    )

    op.create_table(
        "task_tags",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", "tag_id"),
    )
    op.create_index("ix_task_tags_task_id", "task_tags", ["task_id"], unique=False)
    op.create_index("ix_task_tags_tag_id", "task_tags", ["tag_id"], unique=False)

    op.create_table(
        "time_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("hours", sa.Float(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_time_logs_task_id", "time_logs", ["task_id"], unique=False)
    op.create_index("ix_time_logs_user_id", "time_logs", ["user_id"], unique=False)
    op.create_index("ix_time_logs_work_date", "time_logs", ["work_date"], unique=False)

    op.create_table(
        "task_comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("visibility", sa.String(length=16), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=True),
        sa.Column("file_id", sa.Uuid(), nullable=True),
        sa.Column("annotation_id", sa.Uuid(), nullable=True),
        sa.Column("frame", sa.Integer(), nullable=True),
        sa.Column("review_decision", sa.String(length=16), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_id"], ["task_comments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["version_id"], ["product_versions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["annotation_id"], ["annotations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_comments_task_id", "task_comments", ["task_id"], unique=False)
    op.create_index("ix_task_comments_author_id", "task_comments", ["author_id"], unique=False)
    op.create_index("ix_task_comments_visibility", "task_comments", ["visibility"], unique=False)
    op.create_index("ix_task_comments_created_at", "task_comments", ["created_at"], unique=False)

    op.create_table(
        "task_reviews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("round_no", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=True),
        sa.Column("stage", sa.String(length=16), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("reviewer_id", sa.Uuid(), nullable=True),
        sa.Column("acted_as", sa.String(length=64), nullable=False),
        sa.Column("on_behalf_of", sa.String(length=128), nullable=True),
        sa.Column("comment_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["product_versions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["comment_id"], ["task_comments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_reviews_task_id", "task_reviews", ["task_id"], unique=False)
    op.create_index("ix_task_reviews_created_at", "task_reviews", ["created_at"], unique=False)

    op.create_table(
        "task_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("acted_as", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("field", sa.String(length=64), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_events_task_id", "task_events", ["task_id"], unique=False)
    op.create_index("ix_task_events_at", "task_events", ["at"], unique=False)

    op.create_table(
        "entity_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_entity_id", sa.Uuid(), nullable=False),
        sa.Column("target_entity_id", sa.Uuid(), nullable=False),
        sa.Column("link_type", sa.String(length=64), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["source_entity_id"], ["entities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_entity_id"], ["entities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_entity_id", "target_entity_id", "link_type", name="uq_entity_link_triple"
        ),
    )
    op.create_index(
        "ix_entity_links_source_entity_id", "entity_links", ["source_entity_id"], unique=False
    )
    op.create_index(
        "ix_entity_links_target_entity_id", "entity_links", ["target_entity_id"], unique=False
    )

    op.create_table(
        "dependency_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("upstream_department_id", sa.Uuid(), nullable=False),
        sa.Column("upstream_task_name", sa.String(length=128), nullable=True),
        sa.Column("downstream_department_id", sa.Uuid(), nullable=False),
        sa.Column("downstream_task_name", sa.String(length=128), nullable=True),
        sa.Column("threshold", sa.String(length=16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["upstream_department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["downstream_department_id"], ["departments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_dependency_templates_upstream_department_id",
        "dependency_templates",
        ["upstream_department_id"],
        unique=False,
    )
    op.create_index(
        "ix_dependency_templates_downstream_department_id",
        "dependency_templates",
        ["downstream_department_id"],
        unique=False,
    )

    op.create_table(
        "saved_views",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("view_kind", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_views_user_id", "saved_views", ["user_id"], unique=False)
    op.create_index("ix_saved_views_view_kind", "saved_views", ["view_kind"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_saved_views_view_kind", table_name="saved_views")
    op.drop_index("ix_saved_views_user_id", table_name="saved_views")
    op.drop_table("saved_views")

    op.drop_index(
        "ix_dependency_templates_downstream_department_id", table_name="dependency_templates"
    )
    op.drop_index(
        "ix_dependency_templates_upstream_department_id", table_name="dependency_templates"
    )
    op.drop_table("dependency_templates")

    op.drop_index("ix_entity_links_target_entity_id", table_name="entity_links")
    op.drop_index("ix_entity_links_source_entity_id", table_name="entity_links")
    op.drop_table("entity_links")

    op.drop_index("ix_task_events_at", table_name="task_events")
    op.drop_index("ix_task_events_task_id", table_name="task_events")
    op.drop_table("task_events")

    op.drop_index("ix_task_reviews_created_at", table_name="task_reviews")
    op.drop_index("ix_task_reviews_task_id", table_name="task_reviews")
    op.drop_table("task_reviews")

    op.drop_index("ix_task_comments_created_at", table_name="task_comments")
    op.drop_index("ix_task_comments_visibility", table_name="task_comments")
    op.drop_index("ix_task_comments_author_id", table_name="task_comments")
    op.drop_index("ix_task_comments_task_id", table_name="task_comments")
    op.drop_table("task_comments")

    op.drop_index("ix_time_logs_work_date", table_name="time_logs")
    op.drop_index("ix_time_logs_user_id", table_name="time_logs")
    op.drop_index("ix_time_logs_task_id", table_name="time_logs")
    op.drop_table("time_logs")

    op.drop_index("ix_task_tags_tag_id", table_name="task_tags")
    op.drop_index("ix_task_tags_task_id", table_name="task_tags")
    op.drop_table("task_tags")

    op.drop_index("ix_task_dependencies_upstream_task_id", table_name="task_dependencies")
    op.drop_index("ix_task_dependencies_task_id", table_name="task_dependencies")
    op.drop_table("task_dependencies")

    op.drop_index("ix_tasks_entity_dept", table_name="tasks")
    op.drop_index("ix_tasks_dept_status", table_name="tasks")
    op.drop_index("ix_tasks_ideal_finish_date", table_name="tasks")
    op.drop_index("ix_tasks_ideal_start_date", table_name="tasks")
    op.drop_index("ix_tasks_priority", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_index("ix_tasks_parent_entity_type", table_name="tasks")
    op.drop_index("ix_tasks_task_code", table_name="tasks")

    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint("fk_tasks_approved_ver", type_="foreignkey")
        batch.drop_constraint("fk_tasks_latest_ver", type_="foreignkey")
        batch.drop_column("approved_version_id")
        batch.drop_column("latest_version_id")
        batch.drop_column("retake_count")
        batch.drop_column("logged_hours")
        batch.drop_column("bid_hours")
        batch.drop_column("actual_finish_date")
        batch.drop_column("ideal_finish_date")
        batch.drop_column("actual_start_date")
        batch.drop_column("ideal_start_date")
        batch.drop_column("complexity_rating")
        batch.drop_column("needs_client_review")
        batch.drop_column("needs_sup_review")
        batch.drop_column("needs_lead_review")
        batch.drop_column("priority")
        batch.drop_column("status_before_hold")
        batch.drop_column("description")
        batch.drop_column("parent_entity_type")
        batch.drop_column("task_name")
        batch.drop_column("task_code")
        batch.alter_column(
            "status",
            existing_type=sa.String(length=32),
            server_default=None,
            nullable=True,
        )
        batch.add_column(sa.Column("assigned_to_user_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))

    op.create_index("ix_tasks_assigned_to_user_id", "tasks", ["assigned_to_user_id"], unique=False)

    with op.batch_alter_table("department_default_tasks") as batch:
        batch.drop_column("default_complexity")
        batch.drop_column("default_bid_hours")
        batch.drop_column("default_priority")
        batch.drop_column("needs_client_review")
        batch.drop_column("needs_sup_review")
        batch.drop_column("needs_lead_review")

    op.get_bind().execute(sa.text("UPDATE project_meta SET schema_version = 3"))
