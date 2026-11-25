from __future__ import annotations

import asyncio
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from app.core.errors import AppError, NotFoundError

_SENSITIVE_COL_PAIRS: frozenset[tuple[str, str]] = frozenset(
    {
        ("users", "password_hash"),
        ("sessions", "token_hash"),
        ("sessions", "csrf_token"),
    }
)
_SENSITIVE_NAME_RE = re.compile(r"(password|token_hash|csrf_token|secret|api_key)", re.IGNORECASE)


def _is_sensitive_column(col_name: str, table_name: str | None = None) -> bool:
    if table_name and (table_name.lower(), col_name.lower()) in _SENSITIVE_COL_PAIRS:
        return True
    return bool(_SENSITIVE_NAME_RE.search(col_name))


def _serialize_cell(value: Any, *, redacted: bool) -> Any:
    if redacted:
        return "[REDACTED]"
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    return str(value)


def _open_readonly_sqlite(db_path: Path) -> sqlite3.Connection:
    if not db_path.is_file():
        raise NotFoundError("project_db", str(db_path))
    conn = sqlite3.connect(
        f"file:{db_path.as_posix()}?mode=ro",
        uri=True,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON;")
    conn.execute("PRAGMA busy_timeout = 3000;")
    return conn


def _install_readonly_authorizer(conn: sqlite3.Connection) -> None:
    allowed = {
        sqlite3.SQLITE_SELECT,
        sqlite3.SQLITE_READ,
        sqlite3.SQLITE_FUNCTION,
    }
    recursive = getattr(sqlite3, "SQLITE_RECURSIVE", None)
    if isinstance(recursive, int):
        allowed.add(recursive)

    def _authorizer(
        action: int,
        arg1: str | None,
        arg2: str | None,
        _db_name: str | None,
        _trigger: str | None,
    ) -> int:
        if action not in allowed:
            return sqlite3.SQLITE_DENY
        if (
            action == sqlite3.SQLITE_READ
            and arg1
            and arg2
            and (arg1.lower(), arg2.lower()) in _SENSITIVE_COL_PAIRS
        ):
            return sqlite3.SQLITE_IGNORE
        return sqlite3.SQLITE_OK

    conn.set_authorizer(_authorizer)


def _strip_literals_and_comments(sql: str) -> str:
    """Replace SQL string/identifier literals and comments to detect multi-statements."""
    out: list[str] = []
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if ch == "-" and nxt == "-":
            while i < n and sql[i] != "\n":
                i += 1
            out.append(" ")
            continue
        if ch == "/" and nxt == "*":
            i += 2
            while i + 1 < n and not (sql[i] == "*" and sql[i + 1] == "/"):
                i += 1
            i += 2
            out.append(" ")
            continue
        if ch in {"'", '"', "`"}:
            quote = ch
            i += 1
            while i < n:
                if sql[i] == quote:
                    if i + 1 < n and sql[i + 1] == quote:
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            out.append(" ")
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _list_tables_sync(db_path: Path) -> list[dict[str, Any]]:
    conn = _open_readonly_sqlite(db_path)
    try:
        table_rows = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        ).fetchall()
        results: list[dict[str, Any]] = []
        for tr in table_rows:
            tname = str(tr["name"])
            quoted = '"' + tname.replace('"', '""') + '"'
            count_row = conn.execute(f"SELECT COUNT(*) AS cnt FROM {quoted}").fetchone()
            col_rows = conn.execute(f"PRAGMA table_info({quoted})").fetchall()
            cols = [
                {
                    "name": str(c["name"]),
                    "type": str(c["type"] or "TEXT"),
                    "pk": bool(c["pk"]),
                    "redacted": _is_sensitive_column(str(c["name"]), tname),
                }
                for c in col_rows
            ]
            results.append(
                {
                    "name": tname,
                    "row_count": int(count_row["cnt"]) if count_row else 0,
                    "columns": cols,
                }
            )
        return results
    finally:
        conn.close()


def _browse_table_sync(
    db_path: Path,
    table_name: str,
    *,
    page: int,
    page_size: int,
    sort: str | None,
    sort_dir: str,
    filter_text: str | None,
) -> dict[str, Any]:
    conn = _open_readonly_sqlite(db_path)
    try:
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
        ).fetchone()
        if exists is None:
            raise NotFoundError("db_table", table_name)

        quoted_tbl = '"' + table_name.replace('"', '""') + '"'
        col_info = conn.execute(f"PRAGMA table_info({quoted_tbl})").fetchall()
        cols = [
            {
                "name": str(c["name"]),
                "type": str(c["type"] or "TEXT"),
                "pk": bool(c["pk"]),
                "redacted": _is_sensitive_column(str(c["name"]), table_name),
            }
            for c in col_info
        ]
        col_names = [c["name"] for c in cols]
        redacted_map = {c["name"]: bool(c["redacted"]) for c in cols}

        where_sql = ""
        params: list[Any] = []
        if filter_text and filter_text.strip():
            needle = f"%{filter_text.strip()}%"
            searchable = [c["name"] for c in cols if not c["redacted"]]
            if searchable:
                clauses = [
                    f'CAST("{cname.replace(chr(34), chr(34) * 2)}" AS TEXT) LIKE ?'
                    for cname in searchable
                ]
                where_sql = " WHERE (" + " OR ".join(clauses) + ")"
                params.extend([needle] * len(searchable))

        total_row = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM {quoted_tbl}{where_sql}", params
        ).fetchone()
        total = int(total_row["cnt"]) if total_row else 0

        order_col = (
            sort if sort and sort in col_names and not redacted_map.get(sort) else col_names[0]
        )
        quoted_order = '"' + order_col.replace('"', '""') + '"'
        dir_sql = "DESC" if sort_dir.lower() == "desc" else "ASC"
        offset = max(0, (page - 1) * page_size)

        _install_readonly_authorizer(conn)
        sql_stmt = (
            f"SELECT * FROM {quoted_tbl}{where_sql} "
            f"ORDER BY {quoted_order} {dir_sql} LIMIT ? OFFSET ?"
        )
        rows = conn.execute(sql_stmt, [*params, page_size, offset]).fetchall()

        out_rows = [
            [_serialize_cell(row[cname], redacted=redacted_map[cname]) for cname in col_names]
            for row in rows
        ]
        return {
            "table": table_name,
            "columns": cols,
            "rows": out_rows,
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    finally:
        conn.close()


def _execute_sql_sync(
    db_path: Path,
    sql: str,
    *,
    max_rows: int = 1000,
    timeout_sec: float = 5.0,
) -> dict[str, Any]:
    raw = sql.strip()
    if not raw:
        raise AppError("invalid_sql", "SQL query cannot be empty", 400)

    stripped = _strip_literals_and_comments(raw).strip()
    if stripped.endswith(";"):
        stripped = stripped[:-1].strip()
    if ";" in stripped:
        raise AppError("invalid_sql", "Only a single SELECT statement is allowed", 400)

    head = stripped.split(None, 1)[0].upper() if stripped else ""
    if head not in {"SELECT", "WITH"}:
        raise AppError("forbidden_sql", "Only read-only SELECT queries are permitted", 400)

    clean_exec = raw.rstrip()
    if clean_exec.endswith(";"):
        clean_exec = clean_exec[:-1].rstrip()

    t0 = time.monotonic()
    deadline = t0 + timeout_sec
    conn = _open_readonly_sqlite(db_path)
    try:
        _install_readonly_authorizer(conn)

        def _progress() -> int:
            return 1 if time.monotonic() > deadline else 0

        conn.set_progress_handler(_progress, 1000)
        try:
            cur = conn.execute(clean_exec)
            col_names = [str(d[0]) for d in (cur.description or ())]
            fetched = cur.fetchmany(max_rows + 1)
        except sqlite3.OperationalError as exc:
            msg = str(exc)
            if "interrupted" in msg.lower():
                raise AppError(
                    "sql_timeout", f"Query exceeded {timeout_sec:.0f}s timeout", 408
                ) from exc
            raise AppError("sql_error", msg, 400) from exc
        except sqlite3.DatabaseError as exc:
            raise AppError("forbidden_sql", str(exc), 400) from exc

        truncated = len(fetched) > max_rows
        rows_slice = fetched[:max_rows]
        redacted_cols = [_is_sensitive_column(cn) for cn in col_names]
        out_rows = [
            [_serialize_cell(val, redacted=redacted_cols[idx]) for idx, val in enumerate(row)]
            for row in rows_slice
        ]
        elapsed_ms = round((time.monotonic() - t0) * 1000.0, 2)
        return {
            "columns": col_names,
            "rows": out_rows,
            "row_count": len(out_rows),
            "truncated": truncated,
            "elapsed_ms": elapsed_ms,
        }
    finally:
        conn.close()


async def list_db_tables(db_path: Path) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_list_tables_sync, db_path)


async def browse_db_table(
    db_path: Path,
    table_name: str,
    *,
    page: int = 1,
    page_size: int = 50,
    sort: str | None = None,
    sort_dir: str = "asc",
    filter_text: str | None = None,
) -> dict[str, Any]:
    return await asyncio.to_thread(
        _browse_table_sync,
        db_path,
        table_name,
        page=page,
        page_size=page_size,
        sort=sort,
        sort_dir=sort_dir,
        filter_text=filter_text,
    )


async def execute_readonly_sql(
    db_path: Path,
    sql: str,
    *,
    max_rows: int = 1000,
    timeout_sec: float = 5.0,
) -> dict[str, Any]:
    return await asyncio.to_thread(
        _execute_sql_sync,
        db_path,
        sql,
        max_rows=max_rows,
        timeout_sec=timeout_sec,
    )
