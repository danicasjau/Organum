"""auth, users, roles, capacities, companies, project settings, shares

Revision ID: 0003_auth_users_roles_companies
Revises: 0002_entity_centered
Create Date: 2026-11-25 08:15:00.000000
"""

from __future__ import annotations

import os
import re
import uuid
from collections.abc import Sequence

import argon2
import sqlalchemy as sa

from alembic import op

revision: str = "0003_auth_users_roles_companies"
down_revision: str | Sequence[str] | None = "0002_entity_centered"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ROLE_SEEDS: list[tuple[str, str, int]] = [
    ("admin", "Administrator", 100),
    ("producer", "Production", 80),
    ("director", "Director", 75),
    ("supervisor", "Supervisor", 60),
    ("lead", "Lead", 50),
    ("artist", "Artist", 40),
    ("external", "External", 20),
    ("client", "Client", 10),
]


def _default_short_code(name: str, used: set[str]) -> str:
    letters = re.sub(r"[^A-Za-z0-9]", "", name).upper()
    base = (letters[:3] if len(letters) >= 3 else (letters + "XXX")[:3]) or "DPT"
    cand = base
    idx = 1
    while cand in used:
        cand = f"{base[:2]}{idx}"
        idx += 1
    used.add(cand)
    return cand


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_roles_name", "roles", ["name"], unique=True)

    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.Uuid(), nullable=False),
        sa.Column("permission_key", sa.String(length=64), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "permission_key"),
    )

    op.create_table(
        "capacity_permissions",
        sa.Column("assignment_role", sa.String(length=16), nullable=False),
        sa.Column("permission_key", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("assignment_role", "permission_key"),
    )

    op.create_table(
        "companies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("short_code", sa.String(length=16), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("short_code"),
    )

    op.create_table(
        "company_departments",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("department_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("company_id", "department_id"),
    )
    op.create_index(
        "ix_company_departments_company_id", "company_departments", ["company_id"], unique=False
    )
    op.create_index(
        "ix_company_departments_department_id",
        "company_departments",
        ["department_id"],
        unique=False,
    )

    # Seed the 8 default system roles before altering users so migrated rows get valid role_id
    role_ids: dict[str, uuid.UUID] = {}
    roles_table = sa.table(
        "roles",
        sa.column("id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("label", sa.String()),
        sa.column("rank", sa.Integer()),
        sa.column("is_system", sa.Boolean()),
    )
    seed_rows = []
    for r_name, r_label, r_rank in _ROLE_SEEDS:
        rid = uuid.uuid5(uuid.NAMESPACE_DNS, f"organum.role.{r_name}")
        role_ids[r_name] = rid
        seed_rows.append(
            {"id": rid, "name": r_name, "label": r_label, "rank": r_rank, "is_system": True}
        )
    op.bulk_insert(roles_table, seed_rows)

    # Add new columns to users (nullable initially), backfill, then tighten schema
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("full_name", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("email", sa.String(length=256), nullable=True))
        batch_op.add_column(sa.Column("password_hash", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("role_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("company_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("avatar_file", sa.String(length=256), nullable=True))
        batch_op.add_column(
            sa.Column(
                "daily_capacity_hours",
                sa.Float(),
                server_default=sa.text("8.0"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column("timezone", sa.String(length=64), server_default="UTC", nullable=False)
        )
        batch_op.add_column(
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False)
        )
        batch_op.add_column(
            sa.Column(
                "must_change_password",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "has_initial_password",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))

    bind = op.get_bind()
    existing_users = bind.execute(
        sa.text("SELECT id, username, display_name FROM users")
    ).fetchall()
    if existing_users:
        init_pw = os.environ.get("ORGANUM_INITIAL_ADMIN_PASSWORD") or "magicadmin**"
        hasher = argon2.PasswordHasher(type=argon2.Type.ID)
        admin_hash = hasher.hash(init_pw)
        promoted_id: str | None = None
        for row in existing_users:
            if str(row[1]) in ("artist", "admin"):
                promoted_id = str(row[0])
                break
        if promoted_id is None:
            promoted_id = str(existing_users[0][0])

        for row in existing_users:
            uid_val = row[0]
            if str(uid_val) == promoted_id:
                bind.execute(
                    sa.text(
                        "UPDATE users SET username = :u, full_name = :fn, password_hash = :ph, "
                        "role_id = :rid, must_change_password = :mcp, has_initial_password = :hip, "
                        "is_active = :act WHERE id = :uid"
                    ),
                    {
                        "u": "admin",
                        "fn": "Administrator",
                        "ph": admin_hash,
                        "rid": role_ids["admin"].hex
                        if isinstance(uid_val, str) and "-" not in uid_val
                        else role_ids["admin"],
                        "mcp": True,
                        "hip": True,
                        "act": True,
                        "uid": uid_val,
                    },
                )
            else:
                bind.execute(
                    sa.text(
                        "UPDATE users SET full_name = :fn, password_hash = :ph, "
                        "role_id = :rid, must_change_password = :mcp, has_initial_password = :hip, "
                        "is_active = :act WHERE id = :uid"
                    ),
                    {
                        "fn": str(row[2] or row[1]),
                        "ph": admin_hash,
                        "rid": role_ids["artist"].hex
                        if isinstance(uid_val, str) and "-" not in uid_val
                        else role_ids["artist"],
                        "mcp": True,
                        "hip": True,
                        "act": True,
                        "uid": uid_val,
                    },
                )

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("full_name", existing_type=sa.String(length=128), nullable=False)
        batch_op.alter_column("password_hash", existing_type=sa.Text(), nullable=False)
        batch_op.alter_column("role_id", existing_type=sa.Uuid(), nullable=False)
        batch_op.drop_column("display_name")
        batch_op.drop_column("role")
        batch_op.create_foreign_key(
            "fk_users_role_id", "roles", ["role_id"], ["id"], ondelete="RESTRICT"
        )
        batch_op.create_foreign_key(
            "fk_users_company_id", "companies", ["company_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_index("ix_users_role_id", ["role_id"], unique=False)
        batch_op.create_index("ix_users_company_id", ["company_id"], unique=False)

    op.create_table(
        "user_departments",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("department_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "department_id"),
    )
    op.create_index("ix_user_departments_user_id", "user_departments", ["user_id"], unique=False)
    op.create_index(
        "ix_user_departments_department_id", "user_departments", ["department_id"], unique=False
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_sessions_token_hash", "sessions", ["token_hash"], unique=True)
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False)

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.String(length=128), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("detail_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_action", "audit_log", ["action"], unique=False)
    op.create_index("ix_audit_log_at", "audit_log", ["at"], unique=False)
    op.create_index("ix_audit_log_user_id", "audit_log", ["user_id"], unique=False)

    op.create_table(
        "task_assignments",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("assignment_role", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("rule_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", "user_id", "assignment_role"),
    )
    op.create_index("ix_task_assignments_task_id", "task_assignments", ["task_id"], unique=False)
    op.create_index("ix_task_assignments_user_id", "task_assignments", ["user_id"], unique=False)

    op.create_table(
        "task_shares",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("shared_by", sa.Uuid(), nullable=True),
        sa.Column(
            "shared_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shared_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", "company_id"),
    )
    op.create_index("ix_task_shares_company_id", "task_shares", ["company_id"], unique=False)
    op.create_index("ix_task_shares_task_id", "task_shares", ["task_id"], unique=False)

    op.create_table(
        "version_shares",
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("shared_by", sa.Uuid(), nullable=True),
        sa.Column(
            "shared_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shared_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["version_id"], ["product_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("version_id", "company_id"),
    )
    op.create_index("ix_version_shares_company_id", "version_shares", ["company_id"], unique=False)
    op.create_index("ix_version_shares_version_id", "version_shares", ["version_id"], unique=False)

    # Extend departments with short_code & color
    with op.batch_alter_table("departments") as batch_op:
        batch_op.add_column(
            sa.Column("short_code", sa.String(length=8), server_default="", nullable=False)
        )
        batch_op.add_column(
            sa.Column("color", sa.String(length=32), server_default="--series-1", nullable=False)
        )

    dept_rows = bind.execute(sa.text("SELECT id, name FROM departments")).fetchall()
    used_codes: set[str] = set()
    palette_tokens = [f"--series-{i}" for i in range(1, 8)]
    for idx, drow in enumerate(dept_rows):
        sc = _default_short_code(str(drow[1]), used_codes)
        col = palette_tokens[idx % len(palette_tokens)]
        bind.execute(
            sa.text("UPDATE departments SET short_code = :sc, color = :col WHERE id = :did"),
            {"sc": sc, "col": col, "did": drow[0]},
        )

    # Extend project_meta with workflow/security settings
    with op.batch_alter_table("project_meta") as batch_op:
        batch_op.add_column(
            sa.Column("status", sa.String(length=16), server_default="active", nullable=False)
        )
        batch_op.add_column(
            sa.Column("hours_per_day", sa.Float(), server_default=sa.text("8.0"), nullable=False)
        )
        batch_op.add_column(
            sa.Column(
                "working_days",
                sa.JSON(),
                server_default=sa.text("'[1, 2, 3, 4, 5]'"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "task_code_pattern",
                sa.String(length=128),
                server_default="{entity_folder}_{dept_short}_{task_folder}",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "require_version_to_submit",
                sa.Boolean(),
                server_default=sa.text("1"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "enforce_dependencies_in_gantt",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "admin_sql_console_enabled",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "link_dependency_depth",
                sa.Integer(),
                server_default=sa.text("1"),
                nullable=False,
            )
        )

    # Extend annotations with visibility ('internal' | 'client')
    with op.batch_alter_table("annotations") as batch_op:
        batch_op.add_column(
            sa.Column("visibility", sa.String(length=16), server_default="internal", nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("annotations") as batch_op:
        batch_op.drop_column("visibility")

    with op.batch_alter_table("project_meta") as batch_op:
        batch_op.drop_column("link_dependency_depth")
        batch_op.drop_column("admin_sql_console_enabled")
        batch_op.drop_column("enforce_dependencies_in_gantt")
        batch_op.drop_column("require_version_to_submit")
        batch_op.drop_column("task_code_pattern")
        batch_op.drop_column("working_days")
        batch_op.drop_column("hours_per_day")
        batch_op.drop_column("status")

    with op.batch_alter_table("departments") as batch_op:
        batch_op.drop_column("color")
        batch_op.drop_column("short_code")

    op.drop_index("ix_version_shares_version_id", table_name="version_shares")
    op.drop_index("ix_version_shares_company_id", table_name="version_shares")
    op.drop_table("version_shares")

    op.drop_index("ix_task_shares_task_id", table_name="task_shares")
    op.drop_index("ix_task_shares_company_id", table_name="task_shares")
    op.drop_table("task_shares")

    op.drop_index("ix_task_assignments_user_id", table_name="task_assignments")
    op.drop_index("ix_task_assignments_task_id", table_name="task_assignments")
    op.drop_table("task_assignments")

    op.drop_index("ix_audit_log_user_id", table_name="audit_log")
    op.drop_index("ix_audit_log_at", table_name="audit_log")
    op.drop_index("ix_audit_log_action", table_name="audit_log")
    op.drop_table("audit_log")

    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_index("ix_sessions_token_hash", table_name="sessions")
    op.drop_table("sessions")

    op.drop_index("ix_user_departments_department_id", table_name="user_departments")
    op.drop_index("ix_user_departments_user_id", table_name="user_departments")
    op.drop_table("user_departments")

    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("display_name", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("role", sa.String(length=32), nullable=True))

    bind = op.get_bind()
    bind.execute(
        sa.text("UPDATE users SET display_name = COALESCE(full_name, username), role = 'reviewer'")
    )

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("display_name", existing_type=sa.String(length=128), nullable=False)
        batch_op.alter_column("role", existing_type=sa.String(length=32), nullable=False)
        batch_op.drop_constraint("fk_users_company_id", type_="foreignkey")
        batch_op.drop_constraint("fk_users_role_id", type_="foreignkey")
        batch_op.drop_index("ix_users_company_id")
        batch_op.drop_index("ix_users_role_id")
        batch_op.drop_column("last_login_at")
        batch_op.drop_column("has_initial_password")
        batch_op.drop_column("must_change_password")
        batch_op.drop_column("is_active")
        batch_op.drop_column("timezone")
        batch_op.drop_column("daily_capacity_hours")
        batch_op.drop_column("avatar_file")
        batch_op.drop_column("company_id")
        batch_op.drop_column("role_id")
        batch_op.drop_column("password_hash")
        batch_op.drop_column("email")
        batch_op.drop_column("full_name")

    op.drop_index("ix_company_departments_department_id", table_name="company_departments")
    op.drop_index("ix_company_departments_company_id", table_name="company_departments")
    op.drop_table("company_departments")
    op.drop_table("companies")
    op.drop_table("capacity_permissions")
    op.drop_table("role_permissions")
    op.drop_index("ix_roles_name", table_name="roles")
    op.drop_table("roles")
