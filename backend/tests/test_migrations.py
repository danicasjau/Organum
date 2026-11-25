from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command


def test_alembic_upgrade_downgrade_sqlite(tmp_path: Path) -> None:
    db_file = tmp_path / "mig_test.db"
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{db_file.as_posix()}")

    command.upgrade(cfg, "head")
    sync_engine = create_engine(f"sqlite:///{db_file.as_posix()}")
    tables = set(inspect(sync_engine).get_table_names())
    assert {
        "users",
        "project_meta",
        "departments",
        "department_default_tasks",
        "entities",
        "tags",
        "entity_tags",
        "entity_data",
        "entity_departments",
        "tasks",
        "task_links",
        "products",
        "product_versions",
        "files",
        "artifacts",
        "annotations",
        "annotation_revisions",
        "jobs",
    }.issubset(tables)
    sync_engine.dispose()

    command.downgrade(cfg, "base")
    sync_engine = create_engine(f"sqlite:///{db_file.as_posix()}")
    tables_after = set(inspect(sync_engine).get_table_names())
    assert "files" not in tables_after
    assert "entities" not in tables_after
    sync_engine.dispose()

    command.upgrade(cfg, "head")


@pytest.mark.postgres
def test_alembic_upgrade_downgrade_postgres() -> None:
    docker_mod = pytest.importorskip("docker")
    try:
        client = docker_mod.from_env()
        client.ping()
    except Exception:
        pytest.skip("Docker daemon unavailable for PostgreSQL testcontainer")

    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:16-alpine") as pg:
        url = pg.get_connection_url().replace("postgresql+psycopg2://", "postgresql+asyncpg://")
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")
        command.upgrade(cfg, "head")
