from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def ensure_sqlite_parent_dir(database_url: str) -> None:
    """Create the parent folder of a file-based SQLite URL so a fresh checkout can start."""
    if not database_url.startswith("sqlite"):
        return
    _, _, raw_path = database_url.partition(":///")
    if not raw_path or raw_path.startswith(":memory:"):
        return
    Path(raw_path.split("?", 1)[0]).parent.mkdir(parents=True, exist_ok=True)


def create_engine_and_sessionmaker(
    database_url: str,
    echo: bool = False,
) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """Create async SQLAlchemy engine and session factory for SQLite or PostgreSQL."""
    is_sqlite = database_url.startswith("sqlite")
    connect_args: dict[str, Any] = (
        {"check_same_thread": False, "timeout": 15.0} if is_sqlite else {}
    )
    engine = create_async_engine(
        database_url,
        echo=echo,
        pool_pre_ping=True,
        connect_args=connect_args,
    )

    if is_sqlite:

        @event.listens_for(engine.sync_engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    return engine, session_factory
