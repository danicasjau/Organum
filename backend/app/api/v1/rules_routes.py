from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.errors import AppError, NotFoundError
from app.core.security import client_ip_from_request, get_project_auth, require
from app.models.project_db import ProjectMeta
from app.models.tasks import Rule
from app.models.user import User
from app.schemas.api import (
    ReorderRequest,
    RuleApplyOut,
    RuleApplyRequest,
    RuleChangePreviewOut,
    RuleCreateRequest,
    RuleOut,
    RulePreviewOut,
    RulePreviewRequest,
    RuleUpdateRequest,
)
from app.services.auth_service import write_audit
from app.services.permissions import AuthContext
from app.services.rules_engine import (
    VALID_TRIGGERS,
    format_rule_sentence,
    plan_and_apply_rules,
    validate_actions_json,
    validate_conditions_json,
)

router = APIRouter(prefix="/rules", tags=["rules"])


async def _user_lookup(db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(select(User.id, User.username))).all()
    return {str(uid): str(uname) for uid, uname in rows}


def _to_out(r: Rule, users_map: dict[str, str]) -> RuleOut:
    trig = cast(Literal["entity_created", "task_created", "link_created", "manual"], r.trigger)
    return RuleOut(
        id=r.id,
        name=r.name,
        enabled=r.enabled,
        sort_order=r.sort_order,
        trigger=trig,
        conditions_json=dict(r.conditions_json or {}),
        actions_json=list(r.actions_json or []),
        sentence=format_rule_sentence(
            trig, r.conditions_json or {}, r.actions_json or [], users_map
        ),
        created_by=r.created_by,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


@router.get("", response_model=list[RuleOut])
async def list_rules(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[RuleOut]:
    if not auth.has_any_scope("rules.manage") and not auth.has_any_scope("role.manage"):
        raise AppError("forbidden", "Missing permission 'rules.manage'", status_code=403)
    rows = (
        (await db.execute(select(Rule).order_by(Rule.sort_order.asc(), Rule.created_at.asc())))
        .scalars()
        .all()
    )
    users_map = await _user_lookup(db)
    return [_to_out(r, users_map) for r in rows]


@router.post("", response_model=RuleOut, status_code=201)
async def create_rule(
    payload: RuleCreateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("rules.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RuleOut:
    if payload.trigger not in VALID_TRIGGERS:
        raise AppError("invalid_rule", f"Invalid trigger '{payload.trigger}'", 400)
    conds = validate_conditions_json(payload.conditions_json)
    actions = validate_actions_json(payload.actions_json)

    existing = (await db.execute(select(Rule))).scalars().all()
    sort_order = (
        payload.sort_order
        if payload.sort_order
        else (max((r.sort_order for r in existing), default=-1) + 1)
    )

    rule = Rule(
        name=payload.name.strip(),
        enabled=payload.enabled,
        sort_order=sort_order,
        trigger=payload.trigger,
        conditions_json=conds,
        actions_json=actions,
        created_by=auth.user.id,
    )
    db.add(rule)
    await db.flush()
    await write_audit(
        db,
        user_id=auth.user.id,
        action="rule.created",
        target_type="rule",
        target_id=str(rule.id),
        ip=client_ip_from_request(request),
        detail={"name": rule.name, "trigger": rule.trigger},
    )
    await db.commit()
    await db.refresh(rule)
    return _to_out(rule, await _user_lookup(db))


@router.put("/reorder", response_model=list[RuleOut])
async def reorder_rules(
    payload: ReorderRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("rules.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[RuleOut]:
    rows = (await db.execute(select(Rule))).scalars().all()
    by_id = {r.id: r for r in rows}
    for idx, rid in enumerate(payload.ids):
        if rid in by_id:
            by_id[rid].sort_order = idx
    await write_audit(
        db,
        user_id=auth.user.id,
        action="rule.reordered",
        target_type="rule",
        target_id="list",
        ip=client_ip_from_request(request),
        detail={"ids": [str(x) for x in payload.ids]},
    )
    await db.commit()
    ordered = sorted(rows, key=lambda r: (r.sort_order, r.created_at))
    users_map = await _user_lookup(db)
    return [_to_out(r, users_map) for r in ordered]


@router.patch("/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: UUID,
    payload: RuleUpdateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("rules.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RuleOut:
    rule = await db.get(Rule, rule_id)
    if rule is None:
        raise NotFoundError("rule", str(rule_id))
    if payload.name is not None:
        rule.name = payload.name.strip() or rule.name
    if payload.enabled is not None:
        rule.enabled = payload.enabled
    if payload.sort_order is not None:
        rule.sort_order = payload.sort_order
    if payload.trigger is not None:
        if payload.trigger not in VALID_TRIGGERS:
            raise AppError("invalid_rule", f"Invalid trigger '{payload.trigger}'", 400)
        rule.trigger = payload.trigger
    if payload.conditions_json is not None:
        rule.conditions_json = validate_conditions_json(payload.conditions_json)
    if payload.actions_json is not None:
        rule.actions_json = validate_actions_json(payload.actions_json)

    await write_audit(
        db,
        user_id=auth.user.id,
        action="rule.updated",
        target_type="rule",
        target_id=str(rule.id),
        ip=client_ip_from_request(request),
        detail={"name": rule.name, "enabled": rule.enabled},
    )
    await db.commit()
    await db.refresh(rule)
    return _to_out(rule, await _user_lookup(db))


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("rules.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    rule = await db.get(Rule, rule_id)
    if rule is None:
        raise NotFoundError("rule", str(rule_id))
    await write_audit(
        db,
        user_id=auth.user.id,
        action="rule.deleted",
        target_type="rule",
        target_id=str(rule.id),
        ip=client_ip_from_request(request),
        detail={"name": rule.name},
    )
    await db.delete(rule)
    await db.commit()
    return Response(status_code=204)


@router.post("/preview", response_model=RulePreviewOut)
async def preview_rule(
    payload: RulePreviewRequest,
    auth: Annotated[AuthContext, Depends(require("rules.manage"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RulePreviewOut:
    _ = auth
    if (
        payload.rule_id is not None
        and payload.conditions_json is None
        and payload.actions_json is None
    ):
        rule = await db.get(Rule, payload.rule_id)
        if rule is None:
            raise NotFoundError("rule", str(payload.rule_id))
        target_rules = [rule]
        sentence = format_rule_sentence(
            rule.trigger, rule.conditions_json, rule.actions_json, await _user_lookup(db)
        )
    else:
        conds = validate_conditions_json(payload.conditions_json or {"op": "AND", "items": []})
        actions = validate_actions_json(payload.actions_json or [])
        temp = Rule(
            id=payload.rule_id or uuid.uuid4(),
            name="Preview rule",
            enabled=True,
            sort_order=0,
            trigger=payload.trigger,
            conditions_json=conds,
            actions_json=actions,
        )
        target_rules = [temp]
        sentence = format_rule_sentence(payload.trigger, conds, actions, await _user_lookup(db))

    meta = (await db.execute(select(ProjectMeta))).scalar_one_or_none()
    base_dt = meta.created_at.date() if meta and meta.created_at else date.today()
    res = await plan_and_apply_rules(
        db,
        target_rules,
        entity_ids=payload.entity_ids,
        task_ids=payload.task_ids,
        dry_run=True,
        project_base_date=base_dt,
    )
    return RulePreviewOut(
        matched_tasks=int(res["matched_tasks"]),
        changes=[RuleChangePreviewOut(**c) for c in res["changes"]],
        sentence=sentence,
    )


@router.post("/apply", response_model=RuleApplyOut)
async def apply_rules(
    payload: RuleApplyRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("rules.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RuleApplyOut:
    stmt = (
        select(Rule)
        .where(Rule.enabled.is_(True))
        .order_by(Rule.sort_order.asc(), Rule.created_at.asc())
    )
    if payload.rule_ids:
        stmt = (
            select(Rule)
            .where(Rule.id.in_(payload.rule_ids))
            .order_by(Rule.sort_order.asc(), Rule.created_at.asc())
        )
    rules = list((await db.execute(stmt)).scalars().all())
    meta = (await db.execute(select(ProjectMeta))).scalar_one_or_none()
    base_dt = meta.created_at.date() if meta and meta.created_at else date.today()

    res = await plan_and_apply_rules(
        db,
        rules,
        actor_user_id=auth.user.id,
        entity_ids=payload.entity_ids,
        task_ids=payload.task_ids,
        dry_run=False,
        project_base_date=base_dt,
    )
    await write_audit(
        db,
        user_id=auth.user.id,
        action="rule.applied",
        target_type="rule",
        target_id=",".join(str(r.id) for r in rules[:5]) or "none",
        ip=client_ip_from_request(request),
        detail={
            "rule_count": len(rules),
            "matched_tasks": res["matched_tasks"],
            "applied_count": res["applied_count"],
        },
    )
    await db.commit()
    return RuleApplyOut(
        matched_tasks=int(res["matched_tasks"]),
        applied_count=int(res["applied_count"]),
        changes=[RuleChangePreviewOut(**c) for c in res["changes"]],
    )
