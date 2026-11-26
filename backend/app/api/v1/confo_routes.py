"""CR04 §3 Confo API: custom typed entity columns, batch cell edits and CSV import."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_project_context
from app.core.errors import AppError
from app.core.project_registry import ProjectContext
from app.core.security import client_ip_from_request, get_project_auth, require
from app.models.confo import ConfoColumn
from app.models.project_db import Entity
from app.schemas.api import (
    ConfoCellsPatch,
    ConfoCellsResult,
    ConfoColumnCreate,
    ConfoColumnOut,
    ConfoColumnUpdate,
    ConfoGridOut,
    ConfoImportCommitOut,
    ConfoImportMappingIn,
    ConfoImportPreviewOut,
    ConfoImportRequest,
    ConfoImportRowOut,
    ConfoReorderRequest,
    ConfoRowOut,
)
from app.services import confo_service as svc
from app.services.auth_service import write_audit
from app.services.entity_service import create_entity_atomic, soft_delete_entity
from app.services.permissions import AuthContext

router = APIRouter(prefix="/confo", tags=["confo"])


def _column_out(col: ConfoColumn, auth: AuthContext) -> ConfoColumnOut:
    return ConfoColumnOut(
        id=col.id,
        key=col.key,
        label=col.label,
        col_type=col.col_type,
        options=list(col.options_json or []),
        default_text=col.default_text,
        validation=dict(col.validation_json or {}),
        sort_order=col.sort_order,
        is_visible=col.is_visible,
        edit_roles=list(col.edit_roles or []),
        can_edit=svc.can_edit_values(auth) and svc.column_editable_by(col, auth),
        deleted_at=col.deleted_at,
    )


async def _audit(
    db: AsyncSession, auth: AuthContext, request: Request, action: str, target: str, detail: Any
) -> None:
    await write_audit(
        db,
        user_id=auth.user.id,
        action=action,
        target_type="confo",
        target_id=target,
        ip=client_ip_from_request(request),
        detail=detail,
    )


# ------------------------------------------------------------------------------ grid


@router.get("", response_model=ConfoGridOut)
async def get_confo_grid(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ConfoGridOut:
    svc.assert_can_view(auth)
    await svc.purge_expired_columns(db)
    await db.commit()
    columns = await svc.list_columns(db)
    visible = await svc.visible_entity_ids(db, auth)
    stmt = select(Entity).where(Entity.archived_at.is_(None)).order_by(Entity.rel_path)
    if visible is not None:
        stmt = stmt.where(Entity.id.in_(visible or [uuid.UUID(int=0)]))
    entities = (await db.execute(stmt)).scalars().all()
    values = await svc.load_values(db, columns, [e.id for e in entities])
    lookup = await svc.build_lookup(db) if any(c.default_text for c in columns) else None
    defaults = {
        c.key: svc.serialize_value(c.col_type, svc.effective_default(c, lookup))
        for c in columns
        if lookup is not None and c.default_text
    }
    rows: list[ConfoRowOut] = []
    for ent in entities:
        vals: dict[str, Any] = {}
        for col in columns:
            stored = values.get((col.id, ent.id))
            if stored is not None:
                vals[col.key] = svc.serialize_value(
                    col.col_type, svc.read_value(col.col_type, stored)
                )
            elif col.key in defaults:
                vals[col.key] = defaults[col.key]
        rows.append(
            ConfoRowOut(
                entity_id=ent.id,
                name=ent.name,
                rel_path=ent.rel_path,
                entity_type=ent.entity_type,
                values=vals,
            )
        )
    return ConfoGridOut(
        columns=[_column_out(c, auth) for c in columns],
        rows=rows,
        can_edit=svc.can_edit_values(auth),
        can_manage=svc.can_manage_columns(auth),
        can_create_entities=auth.has_any_scope("entity.manage"),
    )


@router.patch("/cells", response_model=ConfoCellsResult)
async def patch_confo_cells(
    payload: ConfoCellsPatch,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ConfoCellsResult:
    svc.assert_can_view(auth)
    visible = await svc.visible_entity_ids(db, auth)
    changes = [svc.CellChange(c.entity_id, c.column_key, c.value) for c in payload.changes]
    applied, issues = await svc.apply_changes(db, auth, changes, allowed_entities=visible)
    if issues:
        await db.rollback()
        raise AppError(
            "invalid_cells",
            f"{len(issues)} cell(s) failed validation; nothing was saved",
            status_code=422,
            details=[i.as_dict() for i in issues],
        )
    if applied:
        await _audit(db, auth, request, "confo.cells.update", "cells", {"changes": applied})
    await db.commit()
    return ConfoCellsResult(applied=applied)


# ------------------------------------------------------------------------------ columns


@router.get("/columns/trash", response_model=list[ConfoColumnOut])
async def list_deleted_columns(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ConfoColumnOut]:
    svc.assert_can_manage(auth)
    return [_column_out(c, auth) for c in await svc.list_columns(db, deleted=True)]


@router.post("/columns", response_model=ConfoColumnOut, status_code=201)
async def create_confo_column(
    payload: ConfoColumnCreate,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ConfoColumnOut:
    svc.assert_can_manage(auth)
    key = payload.key.strip().lower()
    svc.validate_definition(
        key=key, col_type=payload.col_type, options=payload.options, validation=payload.validation
    )
    await svc.ensure_key_free(db, key)
    count = len(await svc.list_columns(db))
    col = ConfoColumn(
        id=uuid.uuid4(),
        key=key,
        label=payload.label.strip(),
        col_type=payload.col_type,
        options_json=[o.strip() for o in payload.options if o.strip()],
        default_text=(payload.default_text or "").strip() or None,
        validation_json=payload.validation,
        sort_order=count,
        is_visible=payload.is_visible,
        edit_roles=payload.edit_roles,
        created_by=auth.user.id,
    )
    if col.default_text:
        try:
            svc.parse_cell(col, col.default_text, await svc.build_lookup(db))
        except svc.CellError as err:
            raise AppError("invalid_column", f"Default value: {err.message}", 400) from err
    db.add(col)
    await db.flush()
    await _audit(db, auth, request, "confo.column.create", key, {"type": col.col_type})
    await db.commit()
    return _column_out(col, auth)


@router.patch("/columns/{column_id}", response_model=ConfoColumnOut)
async def update_confo_column(
    column_id: UUID,
    payload: ConfoColumnUpdate,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ConfoColumnOut:
    svc.assert_can_manage(auth)
    col = await svc.get_column(db, column_id)
    if col.deleted_at is not None:
        raise AppError("column_deleted", "Restore the column before editing it", 409)
    before = {"key": col.key, "label": col.label, "type": col.col_type}
    new_key = payload.key.strip().lower() if payload.key else col.key
    new_type = payload.col_type or col.col_type
    if new_type != col.col_type and await svc.column_has_values(db, col.id):
        raise AppError(
            "column_type_locked",
            "The type cannot change while the column holds values; clear them first",
            status_code=409,
        )
    options = payload.options if payload.options is not None else list(col.options_json or [])
    validation = payload.validation if payload.validation is not None else col.validation_json
    svc.validate_definition(key=new_key, col_type=new_type, options=options, validation=validation)
    if new_key != col.key:
        await svc.ensure_key_free(db, new_key, exclude_id=col.id)
    col.key, col.col_type = new_key, new_type
    col.options_json = [o.strip() for o in options if o.strip()]
    col.validation_json = dict(validation or {})
    if payload.label is not None:
        col.label = payload.label.strip()
    if payload.default_text is not None:
        col.default_text = payload.default_text.strip() or None
    if payload.is_visible is not None:
        col.is_visible = payload.is_visible
    if payload.edit_roles is not None:
        col.edit_roles = payload.edit_roles
    if col.default_text:
        try:
            svc.parse_cell(col, col.default_text, await svc.build_lookup(db))
        except svc.CellError as err:
            raise AppError("invalid_column", f"Default value: {err.message}", 400) from err
    await _audit(
        db, auth, request, "confo.column.update", col.key, {"before": before, "after": col.key}
    )
    await db.commit()
    return _column_out(col, auth)


@router.put("/columns/order", response_model=list[ConfoColumnOut])
async def reorder_confo_columns(
    payload: ConfoReorderRequest,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ConfoColumnOut]:
    svc.assert_can_manage(auth)
    cols = {c.id: c for c in await svc.list_columns(db)}
    for idx, cid in enumerate(payload.ids):
        if cid in cols:
            cols[cid].sort_order = idx
    await db.commit()
    return [_column_out(c, auth) for c in await svc.list_columns(db)]


@router.delete("/columns/{column_id}", status_code=204)
async def delete_confo_column(
    column_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Soft delete: values are kept for 30 days and the column can be restored."""
    svc.assert_can_manage(auth)
    col = await svc.get_column(db, column_id)
    col.deleted_at = datetime.now(UTC)
    await _audit(db, auth, request, "confo.column.delete", col.key, {})
    await db.commit()
    return Response(status_code=204)


@router.post("/columns/{column_id}/restore", response_model=ConfoColumnOut)
async def restore_confo_column(
    column_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ConfoColumnOut:
    svc.assert_can_manage(auth)
    col = await svc.get_column(db, column_id)
    col.deleted_at = None
    col.sort_order = len(await svc.list_columns(db))
    await _audit(db, auth, request, "confo.column.restore", col.key, {})
    await db.commit()
    return _column_out(col, auth)


@router.delete("/columns/{column_id}/purge", status_code=204)
async def purge_confo_column(
    column_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    svc.assert_can_manage(auth)
    col = await svc.get_column(db, column_id)
    if col.deleted_at is None:
        raise AppError("column_active", "Delete the column before purging it", 409)
    await _audit(db, auth, request, "confo.column.purge", col.key, {})
    await db.delete(col)
    await db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------------------ import


async def _plan(
    payload: ConfoImportRequest,
    auth: AuthContext,
    db: AsyncSession,
    ctx: ProjectContext,
    *,
    create_missing: bool | None = None,
) -> svc.ImportPlan:
    return await svc.plan_import(
        db,
        auth,
        csv_text=payload.csv_text,
        match_by=payload.match_by,
        match_header=payload.match_header,
        mapping=(
            [svc.ImportMappingItem(**m.model_dump()) for m in payload.mapping]
            if payload.mapping is not None
            else None
        ),
        create_missing=payload.create_missing if create_missing is None else create_missing,
        skip_unmatched=payload.skip_unmatched,
        production_dir=ctx.production_dir,
    )


def _preview_out(plan: svc.ImportPlan) -> ConfoImportPreviewOut:
    return ConfoImportPreviewOut(
        headers=plan.headers,
        match_by=plan.match_by,
        match_header=plan.match_header,
        mapping=[
            ConfoImportMappingIn(
                header=m.header,
                target_key=m.target_key,
                new_label=m.new_label,
                new_type=m.new_type,
                new_options=m.new_options,
            )
            for m in plan.mapping
        ],
        rows=[
            ConfoImportRowOut(
                line=r.line,
                identity=r.identity,
                status=r.status,
                entity_id=r.entity_id,
                entity_name=r.entity_name,
                message=r.message,
                cells=r.cells,
            )
            for r in plan.rows
        ],
        errors=[e.as_dict() for e in plan.errors],
        summary=plan.summary,
    )


@router.post("/import/preview", response_model=ConfoImportPreviewOut)
async def preview_confo_import(
    payload: ConfoImportRequest,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
) -> ConfoImportPreviewOut:
    svc.assert_can_view(auth)
    plan = await _plan(payload, auth, db, ctx)
    await db.rollback()
    return _preview_out(plan)


@router.post("/import/commit", response_model=ConfoImportCommitOut)
async def commit_confo_import(
    payload: ConfoImportRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("confo.edit", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
) -> ConfoImportCommitOut:
    """All-or-nothing: any error in the plan aborts before anything is written."""
    svc.assert_can_view(auth)
    plan = await _plan(payload, auth, db, ctx)
    if plan.errors:
        await db.rollback()
        raise AppError(
            "invalid_import",
            f"{len(plan.errors)} problem(s) found; nothing was imported",
            status_code=422,
            details=[e.as_dict() for e in plan.errors],
        )

    # Entities first (each creation is its own disk + DB transaction), then all values in one.
    created: list[Entity] = []
    try:
        for row in plan.to_create:
            ident = row.identity.strip().strip("/")
            parent, _, name = ident.rpartition("/") if plan.match_by == "path" else ("", "", ident)
            created.append(await create_entity_atomic(db, ctx, name=name, parent_rel_path=parent))
        if created:
            plan = await _plan(payload, auth, db, ctx, create_missing=False)
            if plan.errors:
                raise AppError(
                    "invalid_import",
                    "Import changed while running; nothing was imported",
                    status_code=409,
                    details=[e.as_dict() for e in plan.errors],
                )
        for col in plan.new_columns:
            col.sort_order = len(await svc.list_columns(db))
            col.created_by = auth.user.id
            db.add(col)
            await db.flush()
        visible = await svc.visible_entity_ids(db, auth)
        if visible is not None:
            visible |= {e.id for e in created}
        applied, issues = await svc.apply_changes(
            db,
            auth,
            plan.changes,
            allowed_entities=visible,
            line_of=plan.line_of_change,
        )
        if issues:
            raise AppError(
                "invalid_import",
                f"{len(issues)} cell(s) failed validation; nothing was imported",
                status_code=422,
                details=[i.as_dict() for i in issues],
            )
        await _audit(
            db,
            auth,
            request,
            "confo.import",
            "import",
            {
                "rows": len(plan.rows),
                "cells": len(applied),
                "new_columns": [c.key for c in plan.new_columns],
                "created_entities": [e.rel_path for e in created],
            },
        )
        await db.commit()
    except Exception:
        await db.rollback()
        for ent in created:  # best-effort compensation for entities created on disk
            try:
                await soft_delete_entity(db, ctx, ent.id)
            except Exception:
                await db.rollback()
        raise
    return ConfoImportCommitOut(
        updated_cells=len(applied),
        created_columns=[c.key for c in plan.new_columns],
        created_entities=len(created),
    )
