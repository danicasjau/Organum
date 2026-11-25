"""entity-centered production tables

Revision ID: 0002_entity_centered
Revises: 0001_initial
Create Date: 2026-11-23 23:58:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_entity_centered"
down_revision: str | Sequence[str] | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_meta",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
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
        sa.UniqueConstraint("uuid"),
    )

    op.create_table(
        "departments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("folder_name", sa.String(length=128), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
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
        sa.UniqueConstraint("folder_name"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "department_default_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("department_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("folder_name", sa.String(length=128), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("department_id", "name", name="uq_dept_default_task_name"),
    )
    op.create_index(
        "ix_department_default_tasks_department_id",
        "department_default_tasks",
        ["department_id"],
        unique=False,
    )

    op.create_table(
        "entities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("folder_name", sa.String(length=128), nullable=False),
        sa.Column("rel_path", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("thumbnail_file_id", sa.Uuid(), nullable=True),
        sa.Column("thumbnail_source", sa.String(length=16), nullable=False),
        sa.Column("is_missing", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint("rel_path"),
    )
    op.create_index("ix_entities_entity_type", "entities", ["entity_type"], unique=False)
    op.create_index("ix_entities_name", "entities", ["name"], unique=False)

    op.create_table(
        "tags",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
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

    op.create_table(
        "entity_tags",
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["entity_id"], ["entities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("entity_id", "tag_id"),
    )
    op.create_index("ix_entity_tags_entity_id", "entity_tags", ["entity_id"], unique=False)
    op.create_index("ix_entity_tags_tag_id", "entity_tags", ["tag_id"], unique=False)

    op.create_table(
        "entity_data",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value_type", sa.String(length=16), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(["entity_id"], ["entities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity_id", "key", name="uq_entity_data_key"),
    )
    op.create_index("ix_entity_data_entity_id", "entity_data", ["entity_id"], unique=False)

    op.create_table(
        "entity_departments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("department_id", sa.Uuid(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entity_id"], ["entities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity_id", "department_id", name="uq_entity_department"),
    )
    op.create_index(
        "ix_entity_departments_department_id",
        "entity_departments",
        ["department_id"],
        unique=False,
    )
    op.create_index(
        "ix_entity_departments_entity_id", "entity_departments", ["entity_id"], unique=False
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_department_id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("department_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("folder_name", sa.String(length=128), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("assigned_to_user_id", sa.Uuid(), nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["entity_department_id"], ["entity_departments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["entity_id"], ["entities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity_department_id", "name", name="uq_ent_dept_task"),
    )
    op.create_index("ix_tasks_assigned_to_user_id", "tasks", ["assigned_to_user_id"], unique=False)
    op.create_index("ix_tasks_department_id", "tasks", ["department_id"], unique=False)
    op.create_index(
        "ix_tasks_entity_department_id", "tasks", ["entity_department_id"], unique=False
    )
    op.create_index("ix_tasks_entity_id", "tasks", ["entity_id"], unique=False)

    op.create_table(
        "task_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("linked_task_id", sa.Uuid(), nullable=False),
        sa.Column("link_type", sa.String(length=32), nullable=True),
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
        sa.ForeignKeyConstraint(["linked_task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_links_linked_task_id", "task_links", ["linked_task_id"], unique=False)
    op.create_index("ix_task_links_task_id", "task_links", ["task_id"], unique=False)

    # Recreate files table for entity-centered products/versions before dropping legacy hierarchy
    op.drop_index("ix_files_version_id", table_name="files")
    op.drop_index("ix_files_sha256", table_name="files")
    op.drop_table("files")

    op.drop_index("ix_versions_product_id", table_name="versions")
    op.drop_index("ix_versions_author_id", table_name="versions")
    op.drop_table("versions")
    op.drop_index("ix_products_asset_id", table_name="products")
    op.drop_table("products")
    op.drop_index("ix_assets_project_id", table_name="assets")
    op.drop_table("assets")
    op.drop_index("ix_projects_name", table_name="projects")
    op.drop_table("projects")

    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("master_version_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_products_task_id", "products", ["task_id"], unique=True)

    op.create_table(
        "product_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=32), nullable=False),
        sa.Column("rel_path", sa.Text(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("source_json", sa.JSON(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "version_number", name="uq_product_version_number"),
    )
    op.create_index(
        "ix_product_versions_created_by_user_id",
        "product_versions",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_product_versions_product_id", "product_versions", ["product_id"], unique=False
    )

    op.create_table(
        "files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_version_id", sa.Uuid(), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("filename", sa.String(length=256), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("mtime", sa.Float(), nullable=False),
        sa.Column("detected_format", sa.String(length=64), nullable=False),
        sa.Column("media_kind", sa.String(length=32), nullable=False),
        sa.Column("colorspace_override", sa.String(length=64), nullable=True),
        sa.Column("probe_json", sa.JSON(), nullable=True),
        sa.Column("is_sequence", sa.Boolean(), nullable=False),
        sa.Column("sequence_pattern", sa.String(length=256), nullable=True),
        sa.Column("sequence_kind", sa.String(length=16), server_default="none", nullable=False),
        sa.Column(
            "sequence_kind_user_override",
            sa.Boolean(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("frame_start", sa.Integer(), nullable=True),
        sa.Column("frame_end", sa.Integer(), nullable=True),
        sa.Column("frame_count", sa.Integer(), nullable=True),
        sa.Column("is_missing", sa.Boolean(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["product_version_id"], ["product_versions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("relative_path"),
    )
    op.create_index("ix_files_product_version_id", "files", ["product_version_id"], unique=False)
    op.create_index("ix_files_sha256", "files", ["sha256"], unique=False)

    with op.batch_alter_table("annotations", recreate="always") as batch_op:
        batch_op.add_column(
            sa.Column("coord_space", sa.String(length=16), server_default="image", nullable=False)
        )
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "annotation_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("annotation_id", sa.Uuid(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("snapshot_json", sa.JSON(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["annotation_id"], ["annotations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("annotation_id", "revision_no", name="uq_annotation_revision_no"),
    )
    op.create_index(
        "ix_annotation_revisions_annotation_id",
        "annotation_revisions",
        ["annotation_id"],
        unique=False,
    )
    op.create_index(
        "ix_annotation_revisions_author_id",
        "annotation_revisions",
        ["author_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_annotation_revisions_author_id", table_name="annotation_revisions")
    op.drop_index("ix_annotation_revisions_annotation_id", table_name="annotation_revisions")
    op.drop_table("annotation_revisions")

    with op.batch_alter_table("annotations", recreate="always") as batch_op:
        batch_op.drop_column("deleted_at")
        batch_op.drop_column("coord_space")

    op.drop_index("ix_files_sha256", table_name="files")
    op.drop_index("ix_files_product_version_id", table_name="files")
    op.drop_table("files")

    op.drop_index("ix_product_versions_product_id", table_name="product_versions")
    op.drop_index("ix_product_versions_created_by_user_id", table_name="product_versions")
    op.drop_table("product_versions")
    op.drop_index("ix_products_task_id", table_name="products")
    op.drop_table("products")

    op.drop_index("ix_task_links_task_id", table_name="task_links")
    op.drop_index("ix_task_links_linked_task_id", table_name="task_links")
    op.drop_table("task_links")
    op.drop_index("ix_tasks_entity_id", table_name="tasks")
    op.drop_index("ix_tasks_entity_department_id", table_name="tasks")
    op.drop_index("ix_tasks_department_id", table_name="tasks")
    op.drop_index("ix_tasks_assigned_to_user_id", table_name="tasks")
    op.drop_table("tasks")
    op.drop_index("ix_entity_departments_entity_id", table_name="entity_departments")
    op.drop_index("ix_entity_departments_department_id", table_name="entity_departments")
    op.drop_table("entity_departments")
    op.drop_index("ix_entity_data_entity_id", table_name="entity_data")
    op.drop_table("entity_data")
    op.drop_index("ix_entity_tags_tag_id", table_name="entity_tags")
    op.drop_index("ix_entity_tags_entity_id", table_name="entity_tags")
    op.drop_table("entity_tags")
    op.drop_table("tags")
    op.drop_index("ix_entities_name", table_name="entities")
    op.drop_index("ix_entities_entity_type", table_name="entities")
    op.drop_table("entities")
    op.drop_index(
        "ix_department_default_tasks_department_id", table_name="department_default_tasks"
    )
    op.drop_table("department_default_tasks")
    op.drop_table("departments")
    op.drop_table("project_meta")

    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
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
    )
    op.create_index("ix_projects_name", "projects", ["name"], unique=True)

    op.create_table(
        "assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_asset_project_name"),
    )
    op.create_index("ix_assets_project_id", "assets", ["project_id"], unique=False)

    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("product_type", sa.String(length=64), nullable=False),
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
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id", "name", name="uq_product_asset_name"),
    )
    op.create_index("ix_products_asset_id", "products", ["asset_id"], unique=False)

    op.create_table(
        "versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "number", name="uq_version_product_number"),
    )
    op.create_index("ix_versions_author_id", "versions", ["author_id"], unique=False)
    op.create_index("ix_versions_product_id", "versions", ["product_id"], unique=False)

    op.create_table(
        "files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("filename", sa.String(length=256), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("mtime", sa.Float(), nullable=False),
        sa.Column("detected_format", sa.String(length=64), nullable=False),
        sa.Column("media_kind", sa.String(length=32), nullable=False),
        sa.Column("colorspace_override", sa.String(length=64), nullable=True),
        sa.Column("probe_json", sa.JSON(), nullable=True),
        sa.Column("is_sequence", sa.Boolean(), nullable=False),
        sa.Column("sequence_pattern", sa.String(length=256), nullable=True),
        sa.Column("frame_start", sa.Integer(), nullable=True),
        sa.Column("frame_end", sa.Integer(), nullable=True),
        sa.Column("frame_count", sa.Integer(), nullable=True),
        sa.Column("is_missing", sa.Boolean(), nullable=False),
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
        sa.ForeignKeyConstraint(["version_id"], ["versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("relative_path"),
    )
    op.create_index("ix_files_sha256", "files", ["sha256"], unique=False)
    op.create_index("ix_files_version_id", "files", ["version_id"], unique=False)
