"""CR04 §3 Confo: typed custom entity columns, cell edits and CSV import.

Every write path (grid edit, paste, CSV import) goes through `parse_cell` so validation is
identical everywhere, and every batch is all-or-nothing: if any cell fails, nothing is stored
and the caller gets one error per failing cell.
"""

from __future__ import annotations

import csv
import io
import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.confo import CONFO_COLUMN_TYPES, ConfoColumn, ConfoValue, ConfoValueItem
from app.models.project_db import Entity, Task
from app.models.user import User
from app.services.permissions import AuthContext, visible_task_ids

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TRASH_RETENTION = timedelta(days=30)
MAX_IMPORT_BYTES = 10 * 1024 * 1024
MAX_IMPORT_ROWS = 20000
_TRUE = {"true", "yes", "y", "1", "x", "si", "sí", "on", "✓"}
_FALSE = {"false", "no", "n", "0", "off", ""}
_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

# Header names recognised as entity identity columns during CSV import (lower-case).
ID_HEADERS = {"id", "uuid", "entity_id", "entity_uuid"}
PATH_HEADERS = {"path", "rel_path", "entity_path", "folder", "folder_path"}
NAME_HEADERS = {"entity", "name", "entity_name", "shot", "asset"}


class CellError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# ---------------------------------------------------------------------------- lookup context


@dataclass
class LookupContext:
    """Name/uuid lookups used to resolve user and entity reference cells."""

    users: dict[str, UUID] = field(default_factory=dict)
    entities_by_id: dict[UUID, Entity] = field(default_factory=dict)
    entities_by_path: dict[str, Entity] = field(default_factory=dict)
    entities_by_name: dict[str, list[Entity]] = field(default_factory=dict)


async def build_lookup(db: AsyncSession) -> LookupContext:
    ctx = LookupContext()
    for u in (await db.execute(select(User).where(User.is_active.is_(True)))).scalars().all():
        for k in (str(u.id), u.username.lower(), u.full_name.strip().lower()):
            ctx.users.setdefault(k, u.id)
    ents = (await db.execute(select(Entity).where(Entity.archived_at.is_(None)))).scalars().all()
    for e in ents:
        ctx.entities_by_id[e.id] = e
        ctx.entities_by_path[e.rel_path.strip("/").lower()] = e
        ctx.entities_by_name.setdefault(e.name.lower(), []).append(e)
    return ctx


# ---------------------------------------------------------------------------- parsing


def _as_text(raw: Any) -> str:
    return raw.strip() if isinstance(raw, str) else str(raw).strip()


def _parse_number(text: str, *, integer: bool) -> float | int:
    clean = text.replace(" ", "").replace("_", "")
    if "," in clean and "." not in clean:
        clean = clean.replace(",", ".")  # European decimal comma: "3,5"
    try:
        num = float(clean)
    except ValueError as exc:
        raise CellError("Not a whole number" if integer else "Not a number") from exc
    if integer:
        if not num.is_integer():
            raise CellError("Not a whole number")
        return int(num)
    return num


def _parse_date(text: str) -> date:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise CellError("Not a date (use YYYY-MM-DD or DD/MM/YYYY)")


def _match_option(text: str, options: Sequence[str]) -> str:
    for opt in options:
        if opt.lower() == text.lower():
            return opt
    raise CellError(f"'{text}' is not an option ({', '.join(options) or 'no options defined'})")


def _resolve_entity(text: str, lookup: LookupContext) -> UUID:
    try:
        as_id = UUID(text)
        if as_id in lookup.entities_by_id:
            return as_id
    except ValueError:
        pass
    by_path = lookup.entities_by_path.get(text.strip("/").lower())
    if by_path is not None:
        return by_path.id
    named = lookup.entities_by_name.get(text.lower(), [])
    if len(named) == 1:
        return named[0].id
    if len(named) > 1:
        raise CellError(f"Entity name '{text}' is ambiguous; use its path")
    raise CellError(f"Unknown entity '{text}'")


def parse_cell(col: ConfoColumn, raw: Any, lookup: LookupContext) -> Any:
    """Parse and validate one raw cell value. Returns the typed value, or None to clear."""
    rules: dict[str, Any] = col.validation_json or {}
    empty = raw is None or (isinstance(raw, str) and not raw.strip()) or raw == []
    if empty:
        if rules.get("required"):
            raise CellError("Required")
        return None
    t = col.col_type

    if t == "boolean":
        if isinstance(raw, bool):
            return raw
        low = _as_text(raw).lower()
        if low in _TRUE:
            return True
        if low in _FALSE:
            return False
        raise CellError("Not a yes/no value")

    if t in ("integer", "float"):
        if isinstance(raw, bool):
            raise CellError("Not a number")
        num: float | int = (
            (int(raw) if t == "integer" and float(raw).is_integer() else raw)
            if isinstance(raw, int | float)
            else _parse_number(_as_text(raw), integer=t == "integer")
        )
        if t == "integer" and not float(num).is_integer():
            raise CellError("Not a whole number")
        if rules.get("min") is not None and num < float(rules["min"]):
            raise CellError(f"Must be at least {rules['min']}")
        if rules.get("max") is not None and num > float(rules["max"]):
            raise CellError(f"Must be at most {rules['max']}")
        return int(num) if t == "integer" else float(num)

    if t == "multiselect":
        items = raw if isinstance(raw, list) else re.split(r"[,;|]", _as_text(raw))
        out: list[str] = []
        for it in items:
            txt = _as_text(it)
            if not txt:
                continue
            canonical = _match_option(txt, col.options_json or [])
            if canonical not in out:
                out.append(canonical)
        if not out and rules.get("required"):
            raise CellError("Required")
        return out or None

    text = _as_text(raw)
    if t == "date":
        return raw if isinstance(raw, date) else _parse_date(text)
    if t == "select":
        return _match_option(text, col.options_json or [])
    if t == "user":
        uid = lookup.users.get(text.lower()) or lookup.users.get(text)
        if uid is None:
            raise CellError(f"Unknown user '{text}'")
        return uid
    if t == "entity":
        return _resolve_entity(text, lookup)
    if t == "color":
        m = _HEX_RE.match(text)
        if not m:
            raise CellError("Not a colour (use #RRGGBB)")
        hexv = m.group(1).lower()
        if len(hexv) == 3:
            hexv = "".join(c * 2 for c in hexv)
        return f"#{hexv}"
    if t == "url":
        candidate = text if "://" in text else f"https://{text}"
        parsed = urlparse(candidate)
        if parsed.scheme not in ("http", "https") or "." not in parsed.netloc:
            raise CellError("Not a web address")
        return candidate

    # text
    if rules.get("max_length") and len(text) > int(rules["max_length"]):
        raise CellError(f"Longer than {rules['max_length']} characters")
    if rules.get("regex"):
        try:
            if not re.fullmatch(str(rules["regex"]), text):
                raise CellError(f"Does not match pattern {rules['regex']}")
        except re.error as exc:
            raise CellError("Column validation pattern is invalid") from exc
    return text


def serialize_value(col_type: str, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return value


def read_value(col_type: str, row: ConfoValue) -> Any:
    match col_type:
        case "integer":
            return row.value_int
        case "float":
            return row.value_float
        case "boolean":
            return row.value_bool
        case "date":
            return row.value_date
        case "user":
            return row.value_user_id
        case "entity":
            return row.value_entity_id
        case "multiselect":
            return [i.item for i in row.items] or None
        case _:
            return row.value_text


def write_value(col_type: str, row: ConfoValue, value: Any) -> None:
    row.value_text = row.value_int = row.value_float = None
    row.value_bool = row.value_date = row.value_user_id = row.value_entity_id = None
    row.items = []
    match col_type:
        case "integer":
            row.value_int = int(value)
        case "float":
            row.value_float = float(value)
        case "boolean":
            row.value_bool = bool(value)
        case "date":
            row.value_date = value
        case "user":
            row.value_user_id = value
        case "entity":
            row.value_entity_id = value
        case "multiselect":
            row.items = [ConfoValueItem(item=v, sort_order=i) for i, v in enumerate(value)]
        case _:
            row.value_text = str(value)


def effective_default(col: ConfoColumn, lookup: LookupContext) -> Any:
    if not col.default_text:
        return None
    try:
        return parse_cell(col, col.default_text, lookup)
    except CellError:
        return None


# ---------------------------------------------------------------------------- permissions


def can_view_confo(auth: AuthContext) -> bool:
    if auth.role.name == "admin":
        return True
    return auth.permissions.get("task.view", "none") not in ("none", "shared")


def assert_can_view(auth: AuthContext) -> None:
    if not can_view_confo(auth):
        raise AppError("forbidden", "Confo is not available for this role", status_code=403)


def can_edit_values(auth: AuthContext) -> bool:
    return can_view_confo(auth) and auth.has_any_scope("confo.edit")


def can_manage_columns(auth: AuthContext) -> bool:
    if auth.role.name == "admin":
        return True
    return can_edit_values(auth) and auth.permissions.get("confo.edit") == "all"


def assert_can_manage(auth: AuthContext) -> None:
    if not can_manage_columns(auth):
        raise AppError(
            "forbidden", "Managing Confo columns needs 'confo.edit' on all", status_code=403
        )


def column_editable_by(col: ConfoColumn, auth: AuthContext) -> bool:
    if auth.role.name == "admin":
        return True
    return not col.edit_roles or auth.role.name in col.edit_roles


async def visible_entity_ids(db: AsyncSession, auth: AuthContext) -> set[UUID] | None:
    """None = every entity; otherwise entities where the user can see at least one task."""
    task_ids = await visible_task_ids(db, auth, "task.view")
    if task_ids is None:
        return None
    if not task_ids:
        return set()
    rows = (
        (await db.execute(select(Task.entity_id).where(Task.id.in_(task_ids)).distinct()))
        .scalars()
        .all()
    )
    return set(rows)


# ---------------------------------------------------------------------------- columns


async def purge_expired_columns(db: AsyncSession) -> None:
    cutoff = datetime.now(UTC) - TRASH_RETENTION
    expired = (
        (
            await db.execute(
                select(ConfoColumn).where(
                    ConfoColumn.deleted_at.is_not(None), ConfoColumn.deleted_at < cutoff
                )
            )
        )
        .scalars()
        .all()
    )
    for col in expired:
        await db.delete(col)


async def list_columns(db: AsyncSession, *, deleted: bool = False) -> list[ConfoColumn]:
    stmt = select(ConfoColumn).where(
        ConfoColumn.deleted_at.is_not(None) if deleted else ConfoColumn.deleted_at.is_(None)
    )
    return list(
        (await db.execute(stmt.order_by(ConfoColumn.sort_order, ConfoColumn.label))).scalars().all()
    )


async def get_column(db: AsyncSession, column_id: UUID) -> ConfoColumn:
    col = await db.get(ConfoColumn, column_id)
    if col is None:
        raise NotFoundError("confo_column", str(column_id))
    return col


def validate_definition(
    *,
    key: str,
    col_type: str,
    options: list[str],
    validation: dict[str, Any],
) -> None:
    if not KEY_RE.match(key):
        raise AppError(
            "invalid_column",
            "Key must start with a letter and use only a-z, 0-9 and _ (max 64)",
            status_code=400,
        )
    if col_type not in CONFO_COLUMN_TYPES:
        raise AppError("invalid_column", f"Unknown column type '{col_type}'", status_code=400)
    if col_type in ("select", "multiselect"):
        clean = [o.strip() for o in options if o.strip()]
        if not clean:
            raise AppError("invalid_column", "Select columns need options", status_code=400)
        if len({o.lower() for o in clean}) != len(clean):
            raise AppError("invalid_column", "Options must be unique", status_code=400)
    if validation.get("regex"):
        try:
            re.compile(str(validation["regex"]))
        except re.error as exc:
            raise AppError("invalid_column", f"Invalid pattern: {exc}", status_code=400) from exc


async def ensure_key_free(db: AsyncSession, key: str, *, exclude_id: UUID | None = None) -> None:
    existing = (
        await db.execute(select(ConfoColumn).where(ConfoColumn.key == key))
    ).scalar_one_or_none()
    if existing is not None and existing.id != exclude_id:
        if existing.deleted_at is not None:
            raise ConflictError(
                f"Column key '{key}' belongs to a deleted column: restore or purge it first"
            )
        raise ConflictError(f"Column key '{key}' already exists")


async def column_has_values(db: AsyncSession, column_id: UUID) -> bool:
    row = (
        await db.execute(select(ConfoValue.id).where(ConfoValue.column_id == column_id).limit(1))
    ).first()
    return row is not None


# ---------------------------------------------------------------------------- grid + cells


@dataclass
class CellChange:
    entity_id: UUID
    column_key: str
    value: Any


@dataclass
class CellIssue:
    entity_id: str
    column_key: str
    message: str
    line: int | None = None

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "entity_id": self.entity_id,
            "column_key": self.column_key,
            "message": self.message,
        }
        if self.line is not None:
            out["line"] = self.line
        return out


async def load_values(
    db: AsyncSession, columns: Sequence[ConfoColumn], entity_ids: Iterable[UUID] | None
) -> dict[tuple[UUID, UUID], ConfoValue]:
    if not columns:
        return {}
    stmt = select(ConfoValue).where(ConfoValue.column_id.in_([c.id for c in columns]))
    if entity_ids is not None:
        ids = list(entity_ids)
        if not ids:
            return {}
        stmt = stmt.where(ConfoValue.entity_id.in_(ids))
    rows = (await db.execute(stmt)).scalars().all()
    return {(r.column_id, r.entity_id): r for r in rows}


async def apply_changes(
    db: AsyncSession,
    auth: AuthContext,
    changes: Sequence[CellChange],
    *,
    lookup: LookupContext | None = None,
    allowed_entities: set[UUID] | None = None,
    line_of: dict[int, int] | None = None,
) -> tuple[list[dict[str, Any]], list[CellIssue]]:
    """Validate every change; if all pass, stage them (caller commits). Returns (applied, issues).

    `applied` items carry before/after values for the audit log and client-side undo.
    """
    lookup = lookup or await build_lookup(db)
    cols = {c.key: c for c in await list_columns(db)}
    issues: list[CellIssue] = []
    parsed: list[tuple[CellChange, ConfoColumn, Any]] = []
    for idx, ch in enumerate(changes):
        line = line_of.get(idx) if line_of else None
        col = cols.get(ch.column_key)
        eid = str(ch.entity_id)
        if col is None:
            issues.append(CellIssue(eid, ch.column_key, "Unknown column", line))
            continue
        if ch.entity_id not in lookup.entities_by_id or (
            allowed_entities is not None and ch.entity_id not in allowed_entities
        ):
            issues.append(CellIssue(eid, ch.column_key, "Entity not found or not visible", line))
            continue
        if not column_editable_by(col, auth):
            issues.append(CellIssue(eid, ch.column_key, "Your role cannot edit this column", line))
            continue
        try:
            parsed.append((ch, col, parse_cell(col, ch.value, lookup)))
        except CellError as err:
            issues.append(CellIssue(eid, ch.column_key, err.message, line))
    if issues:
        return [], issues

    existing = await load_values(
        db, list({c.id: c for _, c, _ in parsed}.values()), {ch.entity_id for ch, _, _ in parsed}
    )
    applied: list[dict[str, Any]] = []
    for ch, col, value in parsed:
        row = existing.get((col.id, ch.entity_id))
        before = serialize_value(col.col_type, read_value(col.col_type, row)) if row else None
        after = serialize_value(col.col_type, value)
        if before == after:
            continue
        if value is None:
            if row is not None:
                await db.delete(row)
                existing.pop((col.id, ch.entity_id), None)
        else:
            if row is None:
                row = ConfoValue(id=uuid.uuid4(), column_id=col.id, entity_id=ch.entity_id)
                db.add(row)
                existing[(col.id, ch.entity_id)] = row
            write_value(col.col_type, row, value)
            row.updated_by = auth.user.id
        applied.append(
            {
                "entity_id": str(ch.entity_id),
                "column_key": col.key,
                "before": before,
                "after": after,
            }
        )
    return applied, []


# ---------------------------------------------------------------------------- CSV import


@dataclass
class ImportMappingItem:
    header: str
    target_key: str | None = None  # existing column key, or the key of a new column
    new_label: str | None = None
    new_type: str | None = None
    new_options: list[str] = field(default_factory=list)


@dataclass
class ImportRow:
    line: int
    identity: str
    status: str  # matched | unmatched | ambiguous | create | duplicate
    entity_id: UUID | None
    entity_name: str | None
    message: str | None = None
    cells: dict[str, Any] = field(default_factory=dict)


def read_csv(csv_text: str) -> tuple[list[str], list[list[str]]]:
    if len(csv_text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise AppError("import_too_large", "CSV is larger than 10 MB", status_code=413)
    text = csv_text.lstrip("﻿")
    sample = text[:4096]
    try:
        dialect: type[csv.Dialect] | csv.Dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        raise AppError("import_empty", "The CSV file has no rows", status_code=400)
    headers = [h.strip() for h in rows[0]]
    if len(set(h.lower() for h in headers if h)) != len([h for h in headers if h]):
        raise AppError("import_headers", "Duplicate column headers in CSV", status_code=400)
    body = rows[1:]
    if len(body) > MAX_IMPORT_ROWS:
        raise AppError("import_too_large", f"More than {MAX_IMPORT_ROWS} rows", status_code=413)
    return headers, body


def guess_identity(headers: Sequence[str]) -> tuple[str, str] | None:
    """Pick the best identity header: id beats path beats name."""
    lowered = {h.lower().strip(): h for h in headers}
    for kind, names in (("id", ID_HEADERS), ("path", PATH_HEADERS), ("name", NAME_HEADERS)):
        for n in names:
            if n in lowered:
                return kind, lowered[n]
    return None


def guess_mapping(headers: Sequence[str], columns: Sequence[ConfoColumn]) -> dict[str, str | None]:
    by_key = {c.key: c.key for c in columns}
    by_label = {c.label.strip().lower(): c.key for c in columns}
    identity = guess_identity(headers)
    out: dict[str, str | None] = {}
    for h in headers:
        if identity and h == identity[1]:
            out[h] = None
            continue
        norm = re.sub(r"[^a-z0-9]+", "_", h.strip().lower()).strip("_")
        out[h] = by_key.get(norm) or by_label.get(h.strip().lower())
    return out


def match_entity(kind: str, ident: str, lookup: LookupContext) -> tuple[str, Entity | None, str]:
    ident = ident.strip()
    if not ident:
        return "unmatched", None, "Empty identity cell"
    if kind == "id":
        try:
            ent = lookup.entities_by_id.get(UUID(ident))
        except ValueError:
            return "unmatched", None, f"'{ident}' is not a valid id"
        return ("matched", ent, "") if ent else ("unmatched", None, "No entity with this id")
    if kind == "path":
        ent = lookup.entities_by_path.get(ident.strip("/").lower())
        return ("matched", ent, "") if ent else ("unmatched", None, "No entity at this path")
    named = lookup.entities_by_name.get(ident.lower(), [])
    if len(named) == 1:
        return "matched", named[0], ""
    if len(named) > 1:
        paths = ", ".join(sorted(e.rel_path for e in named)[:4])
        return "ambiguous", None, f"{len(named)} entities share this name ({paths})"
    return "unmatched", None, "No entity with this name"


@dataclass
class ImportPlan:
    headers: list[str]
    match_by: str
    match_header: str | None
    mapping: list[ImportMappingItem]
    rows: list[ImportRow]
    errors: list[CellIssue]
    new_columns: list[ConfoColumn]
    changes: list[CellChange]
    line_of_change: dict[int, int]
    to_create: list[ImportRow]

    @property
    def summary(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for r in self.rows:
            counts[r.status] = counts.get(r.status, 0) + 1
        counts["rows"] = len(self.rows)
        counts["cells"] = len(self.changes)
        counts["errors"] = len(self.errors)
        return counts


async def plan_import(
    db: AsyncSession,
    auth: AuthContext,
    *,
    csv_text: str,
    match_by: str,
    match_header: str | None,
    mapping: list[ImportMappingItem] | None,
    create_missing: bool,
    skip_unmatched: bool,
    production_dir: Any,
) -> ImportPlan:
    """Parse, match and validate a CSV import without writing anything."""
    headers, body = read_csv(csv_text)
    columns = await list_columns(db)
    cols_by_key = {c.key: c for c in columns}

    if match_header:
        if match_by == "auto":
            low = match_header.strip().lower()
            match_by = "id" if low in ID_HEADERS else "path" if low in PATH_HEADERS else "name"
    else:
        guessed = guess_identity(headers)
        if guessed is None:
            raise AppError(
                "import_identity",
                "Choose which CSV column identifies the entity (id, path or name)",
                status_code=400,
            )
        if match_by == "auto":
            match_by = guessed[0]
        match_header = guessed[1]
    if match_by not in ("id", "path", "name"):
        raise AppError("import_identity", f"Unknown match mode '{match_by}'", status_code=400)
    if match_header not in headers:
        raise AppError("import_identity", f"Column '{match_header}' is not in the CSV", 400)
    ident_idx = headers.index(match_header)

    if mapping is None:
        guess = guess_mapping(headers, columns)
        mapping = [ImportMappingItem(header=h, target_key=guess.get(h)) for h in headers]
    mapping = [m for m in mapping if m.header != match_header]

    # Columns the import would create (validated now, created only on commit).
    new_columns: list[ConfoColumn] = []
    for m in mapping:
        if not m.target_key or m.target_key in cols_by_key or not m.new_type:
            continue
        assert_can_manage(auth)
        validate_definition(
            key=m.target_key,
            col_type=m.new_type,
            options=m.new_options,
            validation={},
        )
        await ensure_key_free(db, m.target_key)
        col = ConfoColumn(
            id=uuid.uuid4(),
            key=m.target_key,
            label=(m.new_label or m.header).strip()[:128] or m.target_key,
            col_type=m.new_type,
            options_json=[o.strip() for o in m.new_options if o.strip()],
            validation_json={},
            edit_roles=[],
            is_visible=True,
        )
        new_columns.append(col)
        cols_by_key[col.key] = col
    unknown = [m.target_key for m in mapping if m.target_key and m.target_key not in cols_by_key]
    if unknown:
        raise AppError(
            "import_mapping",
            f"Unknown target column(s): {', '.join(unknown)} (pick a type to create them)",
            status_code=400,
        )
    active = [(headers.index(m.header), cols_by_key[m.target_key]) for m in mapping if m.target_key]
    if not active:
        raise AppError("import_mapping", "Map at least one CSV column", status_code=400)
    for _, col in active:
        if not column_editable_by(col, auth):
            raise AppError(
                "forbidden", f"Your role cannot edit column '{col.key}'", status_code=403
            )

    if create_missing:
        if match_by == "id":
            raise AppError("import_create", "New entities need a name or path column, not ids", 400)
        if not auth.has_any_scope("entity.manage"):
            raise AppError("forbidden", "Creating entities needs 'entity.manage'", 403)

    lookup = await build_lookup(db)
    visible = await visible_entity_ids(db, auth)
    rows: list[ImportRow] = []
    errors: list[CellIssue] = []
    changes: list[CellChange] = []
    line_of: dict[int, int] = {}
    seen: dict[str, int] = {}
    to_create: list[ImportRow] = []

    for i, raw_row in enumerate(body):
        line = i + 2
        ident = raw_row[ident_idx].strip() if ident_idx < len(raw_row) else ""
        status, ent, msg = match_entity(match_by, ident, lookup)
        if ent is not None and visible is not None and ent.id not in visible:
            status, ent, msg = "unmatched", None, "Entity not visible to you"
        if status == "unmatched" and create_missing and ident:
            status, msg = "create", "Will be created"
            if match_by == "path":
                parent = ident.strip("/").rpartition("/")[0]
                if parent and not (production_dir / parent).is_dir():
                    status, msg = "unmatched", f"Parent folder '{parent}' does not exist"
        key = (str(ent.id) if ent else ident.lower()) if status != "unmatched" else ""
        if key and key in seen:
            status, msg = "duplicate", f"Same entity as line {seen[key]}"
        elif key:
            seen[key] = line
        row = ImportRow(
            line=line,
            identity=ident,
            status=status,
            entity_id=ent.id if ent else None,
            entity_name=ent.name if ent else (ident if status == "create" else None),
            message=msg or None,
        )
        rows.append(row)
        if status in ("ambiguous", "duplicate") or (status == "unmatched" and not skip_unmatched):
            errors.append(CellIssue(ident, match_header, msg, line))
        if status not in ("matched", "create"):
            continue
        if status == "create":
            to_create.append(row)
        for col_idx, col in active:
            raw = raw_row[col_idx] if col_idx < len(raw_row) else ""
            if not raw.strip():
                continue  # empty cells leave stored values unchanged
            try:
                value = parse_cell(col, raw, lookup)
                row.cells[col.key] = serialize_value(col.col_type, value)
            except CellError as err:
                row.cells[col.key] = {"error": err.message, "raw": raw}
                errors.append(CellIssue(ident, col.key, err.message, line))
                continue
            if ent is not None:
                line_of[len(changes)] = line
                changes.append(CellChange(ent.id, col.key, raw))

    return ImportPlan(
        headers=headers,
        match_by=match_by,
        match_header=match_header,
        mapping=mapping,
        rows=rows,
        errors=errors,
        new_columns=new_columns,
        changes=changes,
        line_of_change=line_of,
        to_create=to_create,
    )


async def import_raw_rows(csv_text: str) -> list[list[str]]:
    return read_csv(csv_text)[1]


async def delete_values_for_entities(db: AsyncSession, entity_ids: Sequence[UUID]) -> None:
    if entity_ids:
        await db.execute(delete(ConfoValue).where(ConfoValue.entity_id.in_(entity_ids)))
