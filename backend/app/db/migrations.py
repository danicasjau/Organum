from __future__ import annotations

from pathlib import Path

from alembic.config import Config

from alembic import command

_ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def upgrade_project_db(db_url: str) -> None:
    """Run Alembic migrations up to head for a project database URL."""
    cfg = Config(str(_ALEMBIC_INI))
    cfg.set_main_option("sqlalchemy.url", db_url)
    command.upgrade(cfg, "head")

