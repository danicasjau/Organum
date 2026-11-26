"""project setting: styled XLSX exports (on by default)

Revision ID: 0009_styled_exports
Revises: 0008_schedule_versions
Create Date: 2026-11-26 18:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_styled_exports"
down_revision: str | Sequence[str] | None = "0008_schedule_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("project_meta") as batch:
        batch.add_column(
            sa.Column("styled_exports", sa.Boolean(), server_default=sa.true(), nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("project_meta") as batch:
        batch.drop_column("styled_exports")
