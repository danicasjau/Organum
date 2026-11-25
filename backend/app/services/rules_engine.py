from __future__ import annotations

import concurrent.futures
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.project_db import (
    Department,
    Entity,
    EntityTag,
    ProjectMeta,
    Tag,
    Task,
)
from app.models.tasks import EntityLink, Rule, TaskDependency, TaskEvent, TaskTag
from app.models.user import TaskAssignment, User
from app.services.task_service import reevaluate_wtg_for_tasks, would_create_task_dependency_cycle
from app.services.workflow import DEPENDENCY_THRESHOLDS, PRIORITIES

VALID_TRIGGERS: frozenset[str] = frozenset(
    {"entity_created", "task_created", "link_created", "manual"}
)
VALID_CONDITION_FIELDS: frozenset[str] = frozenset(
    {
        "entity.name",
        "entity.type",
        "entity.tags",
        "entity.path",
        "entity.uses.name",
        "entity.used_in.name",
        "entity.uses.type",
        "department",
        "task.name",
        "task.code",
    }
)
VALID_CONDITION_OPS: frozenset[str] = frozenset(
    {"=", "!=", "contains", "starts_with", "in", "matches", ">", ">=", "<", "<="}
)
VALID_ACTION_TYPES: frozenset[str] = frozenset(
    {
        "assign",
        "set_priority",
        "set_bid_hours",
        "set_review_flags",
        "set_ideal_dates",
        "add_tag",
        "add_dependency",
    }
)

_NATURAL_TOKEN_RE = re.compile(r"^([A-Za-z_\-]*?)(\d+)$")
_NESTED_QUANTIFIER_RE = re.compile(r"\([^)]*[+*][^)]*\)[+*{]")
_MAX_REGEX_LEN = 256
_MAX_CONDITION_DEPTH = 2
_REGEX_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="rule-re")


@dataclass(slots=True)
class RuleContext:
    """In-memory snapshot of an entity+task tuple for pure rule evaluation."""

    entity_id: UUID
    entity_name: str
    entity_type: str | None
    entity_path: str
    entity_tags: list[str] = field(default_factory=list)
    uses_names: list[str] = field(default_factory=list)
    uses_types: list[str] = field(default_factory=list)
    used_in_names: list[str] = field(default_factory=list)
    task_id: UUID | None = None
    task_name: str = ""
    task_code: str = ""
    department_id: UUID | None = None
    department_name: str = ""
    department_folder: str = ""
    department_short_code: str = ""


def natural_compare(left: str, right: str) -> int | None:
    """
    Natural numeric comparison when both values share an identical alphabetic prefix
    and end with digits (`sh041 > sh040`, `sh1000 > sh040`, `ab041` vs `sh040` -> None).
    """
    m_l = _NATURAL_TOKEN_RE.match(left.strip())
    m_r = _NATURAL_TOKEN_RE.match(right.strip())
    if not m_l or not m_r:
        return None
    prefix_l, num_l = m_l.group(1), int(m_l.group(2))
    prefix_r, num_r = m_r.group(1), int(m_r.group(2))
    if prefix_l.lower() != prefix_r.lower():
        return None
    if num_l < num_r:
        return -1
    if num_l > num_r:
        return 1
    return 0


def safe_regex_match(pattern: str, text: str, timeout_sec: float = 0.05) -> bool:
    """Evaluate a length-limited regex with catastrophic-backtracking guard and timeout."""
    if len(pattern) > _MAX_REGEX_LEN:
        raise AppError("invalid_rule", f"Regex exceeds {_MAX_REGEX_LEN} characters", 400)
    if _NESTED_QUANTIFIER_RE.search(pattern):
        raise AppError("regex_timeout", "Regex pattern rejected (unsafe nested quantifiers)", 400)
    try:
        compiled = re.compile(pattern)
    except re.error as exc:
        raise AppError("invalid_rule", f"Invalid regex '{pattern}': {exc}", 400) from exc

    fut = _REGEX_EXECUTOR.submit(compiled.search, text)
    try:
        return fut.result(timeout=timeout_sec) is not None
    except concurrent.futures.TimeoutError as exc:
        fut.cancel()
        raise AppError("regex_timeout", "Regex evaluation timed out", 400) from exc


def validate_conditions_json(conds: Any, depth: int = 0) -> dict[str, Any]:
    """Validate recursive AND/OR rule conditions up to nesting depth 2."""
    if depth > _MAX_CONDITION_DEPTH:
        raise AppError(
            "invalid_rule",
            f"Condition nesting exceeds maximum depth of {_MAX_CONDITION_DEPTH}",
            400,
        )
    if not isinstance(conds, dict):
        raise AppError("invalid_rule", "conditions_json must be a JSON object", 400)
    op = str(conds.get("op", "AND")).upper()
    if op not in {"AND", "OR"}:
        raise AppError("invalid_rule", f"Condition group op must be AND or OR, got '{op}'", 400)
    items = conds.get("items", [])
    if not isinstance(items, list):
        raise AppError("invalid_rule", "Condition group 'items' must be a list", 400)

    clean_items: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise AppError("invalid_rule", "Each condition item must be an object", 400)
        if "items" in item:
            clean_items.append(validate_conditions_json(item, depth + 1))
            continue
        fld = str(item.get("field", "")).strip()
        cmp_op = str(item.get("operator", "")).strip()
        if fld not in VALID_CONDITION_FIELDS:
            raise AppError("invalid_rule", f"Unsupported condition field '{fld}'", 400)
        if cmp_op not in VALID_CONDITION_OPS:
            raise AppError("invalid_rule", f"Unsupported condition operator '{cmp_op}'", 400)
        val = item.get("value")
        if val is None:
            raise AppError("invalid_rule", f"Condition for '{fld}' requires a value", 400)
        if cmp_op == "matches":
            pat = str(val)
            if len(pat) > _MAX_REGEX_LEN:
                raise AppError("invalid_rule", f"Regex exceeds {_MAX_REGEX_LEN} chars", 400)
            if _NESTED_QUANTIFIER_RE.search(pat):
                raise AppError(
                    "regex_timeout", "Regex pattern rejected (unsafe nested quantifiers)", 400
                )
            try:
                re.compile(pat)
            except re.error as exc:
                raise AppError("invalid_rule", f"Invalid regex '{pat}': {exc}", 400) from exc
        clean_items.append({"field": fld, "operator": cmp_op, "value": val})
    return {"op": op, "items": clean_items}


def validate_actions_json(actions: Any) -> list[dict[str, Any]]:
    """Validate declarative THEN actions array."""
    if not isinstance(actions, list) or len(actions) == 0:
        raise AppError("invalid_rule", "actions_json must be a non-empty list", 400)
    cleaned: list[dict[str, Any]] = []
    for raw in actions:
        if not isinstance(raw, dict):
            raise AppError("invalid_rule", "Each rule action must be an object", 400)
        atype = str(raw.get("type", "")).strip()
        if atype not in VALID_ACTION_TYPES:
            raise AppError("invalid_rule", f"Unsupported action type '{atype}'", 400)
        if atype == "assign":
            role = str(raw.get("role", "artist")).strip()
            if role not in {"artist", "lead", "supervisor"}:
                raise AppError("invalid_rule", f"Invalid assignment role '{role}'", 400)
            if not raw.get("user_id") and not raw.get("username"):
                raise AppError("invalid_rule", "assign action requires user_id or username", 400)
        elif atype == "set_priority":
            prio = str(raw.get("priority", "")).strip()
            if prio not in PRIORITIES:
                raise AppError("invalid_rule", f"Invalid priority '{prio}'", 400)
        elif atype == "set_bid_hours":
            try:
                hrs = float(raw.get("bid_hours", -1))
            except (TypeError, ValueError) as exc:
                raise AppError("invalid_rule", "bid_hours must be numeric", 400) from exc
            if hrs < 0:
                raise AppError("invalid_rule", "bid_hours must be >= 0", 400)
        elif atype == "add_tag":
            if not str(raw.get("tag", "")).strip():
                raise AppError("invalid_rule", "add_tag requires a non-empty tag", 400)
        elif atype == "add_dependency":
            scope = str(raw.get("scope", "same")).strip()
            if scope not in {"same", "uses", "used_in"}:
                raise AppError("invalid_rule", f"Invalid dependency scope '{scope}'", 400)
            if not str(raw.get("upstream_department", "")).strip():
                raise AppError("invalid_rule", "add_dependency requires upstream_department", 400)
            thresh = str(raw.get("threshold", "APP")).strip()
            if thresh not in DEPENDENCY_THRESHOLDS:
                raise AppError("invalid_rule", f"Invalid dependency threshold '{thresh}'", 400)
        cleaned.append(dict(raw))
    return cleaned


def _extract_field_values(fld: str, ctx: RuleContext) -> list[str]:
    if fld == "entity.name":
        return [ctx.entity_name]
    if fld == "entity.type":
        return [ctx.entity_type or ""]
    if fld == "entity.tags":
        return list(ctx.entity_tags)
    if fld == "entity.path":
        return [ctx.entity_path]
    if fld == "entity.uses.name":
        return list(ctx.uses_names)
    if fld == "entity.used_in.name":
        return list(ctx.used_in_names)
    if fld == "entity.uses.type":
        return list(ctx.uses_types)
    if fld == "department":
        return [
            v for v in (ctx.department_name, ctx.department_folder, ctx.department_short_code) if v
        ]
    if fld == "task.name":
        return [ctx.task_name]
    if fld == "task.code":
        return [ctx.task_code]
    return []


def _compare_single(candidate: str, op: str, expected: Any) -> bool:
    exp_str = "" if expected is None else str(expected).strip()
    cand_norm = candidate.strip()

    if op == "=":
        return cand_norm.lower() == exp_str.lower()
    if op == "!=":
        return cand_norm.lower() != exp_str.lower()
    if op == "contains":
        return exp_str.lower() in cand_norm.lower()
    if op == "starts_with":
        return cand_norm.lower().startswith(exp_str.lower())
    if op == "in":
        items = (
            [str(x).strip().lower() for x in expected]
            if isinstance(expected, list)
            else [x.strip().lower() for x in exp_str.split(",") if x.strip()]
        )
        return cand_norm.lower() in items
    if op == "matches":
        return safe_regex_match(exp_str, candidate)
    if op in {">", ">=", "<", "<="}:
        nat = natural_compare(cand_norm, exp_str)
        if nat is None:
            # Try plain numeric if both are floats
            try:
                lf, rf = float(cand_norm), float(exp_str)
                nat = -1 if lf < rf else (1 if lf > rf else 0)
            except ValueError:
                return False
        if op == ">":
            return nat > 0
        if op == ">=":
            return nat >= 0
        if op == "<":
            return nat < 0
        return nat <= 0
    return False


def evaluate_conditions(conditions_json: dict[str, Any], ctx: RuleContext) -> bool:
    """Evaluate validated AND/OR conditions cleanly against `RuleContext`."""
    op = str(conditions_json.get("op", "AND")).upper()
    items = conditions_json.get("items", [])
    if not items:
        return True

    results: list[bool] = []
    for item in items:
        if "items" in item:
            results.append(evaluate_conditions(item, ctx))
            continue
        fld = str(item.get("field", ""))
        cmp_op = str(item.get("operator", "="))
        expected = item.get("value")
        candidates = _extract_field_values(fld, ctx)
        if cmp_op == "!=":
            # For list/multi-value fields, `!=` holds only when NO candidate matches
            matched = len(candidates) > 0 and all(
                _compare_single(c, "!=", expected) for c in candidates
            )
        else:
            matched = any(_compare_single(c, cmp_op, expected) for c in candidates)
        results.append(matched)

    return all(results) if op == "AND" else any(results)


def evaluate(rule: Rule | dict[str, Any], entity: Entity, task: Task, **extra: Any) -> bool:
    """Pure entrypoint matching CR03 §6 signature `evaluate(rule, entity, task)`."""
    conds = rule.conditions_json if isinstance(rule, Rule) else rule.get("conditions_json", {})
    ctx = RuleContext(
        entity_id=entity.id,
        entity_name=entity.name,
        entity_type=entity.entity_type,
        entity_path=entity.rel_path,
        entity_tags=list(extra.get("entity_tags", ())),
        uses_names=list(extra.get("uses_names", ())),
        uses_types=list(extra.get("uses_types", ())),
        used_in_names=list(extra.get("used_in_names", ())),
        task_id=task.id,
        task_name=task.name,
        task_code=task.task_code,
        department_id=task.department_id,
        department_name=str(extra.get("department_name", "")),
        department_folder=str(extra.get("department_folder", "")),
        department_short_code=str(extra.get("department_short_code", "")),
    )
    return evaluate_conditions(conds, ctx)


def _describe_conds(conds: dict[str, Any]) -> str:
    items = conds.get("items", [])
    if not items:
        return "always"
    op = str(conds.get("op", "AND")).upper()
    parts: list[str] = []
    for item in items:
        if "items" in item:
            parts.append(f"({_describe_conds(item)})")
        else:
            parts.append(f"{item.get('field')} {item.get('operator')} {item.get('value')}")
    return f" {op} ".join(parts)


def format_rule_sentence(
    trigger: str,
    conditions_json: dict[str, Any],
    actions_json: list[dict[str, Any]],
    user_lookup: dict[str, str] | None = None,
) -> str:
    """Render a deterministic plain-language sentence describing the rule."""
    cond_txt = _describe_conds(conditions_json)
    act_parts: list[str] = []
    for act in actions_json:
        atype = act.get("type", "")
        dept = act.get("department") or "any dept"
        tname = act.get("task_name") or "*"
        target = f"{dept}.{tname}"
        if atype == "assign":
            uid = str(act.get("user_id") or "")
            uname = (
                user_lookup.get(uid)
                if user_lookup and uid in user_lookup
                else str(act.get("username") or uid[:8])
            )
            act_parts.append(f"{target} assign {act.get('role', 'artist')} = {uname}")
        elif atype == "set_priority":
            act_parts.append(f"{target} priority = {act.get('priority')}")
        elif atype == "set_bid_hours":
            act_parts.append(f"{target} bid = {act.get('bid_hours')}h")
        elif atype == "set_review_flags":
            flags = []
            if "needs_lead_review" in act:
                flags.append(f"lead={act['needs_lead_review']}")
            if "needs_sup_review" in act:
                flags.append(f"sup={act['needs_sup_review']}")
            if "needs_client_review" in act:
                flags.append(f"client={act['needs_client_review']}")
            act_parts.append(f"{target} reviews ({', '.join(flags)})")
        elif atype == "set_ideal_dates":
            act_parts.append(
                f"{target} schedule +{act.get('start_offset_days', 0)}d for "
                f"{act.get('duration_days', 3)}d"
            )
        elif atype == "add_tag":
            act_parts.append(f"{target} +tag '{act.get('tag')}'")
        elif atype == "add_dependency":
            act_parts.append(
                f"{target} depends on ({act.get('scope', 'same')}, "
                f"{act.get('upstream_department')}, {act.get('threshold', 'APP')})"
            )
    return f"WHEN [{trigger}] IF {cond_txt} THEN {'; '.join(act_parts)}"


def _dept_matches(selector: Any, dept: Department | None) -> bool:
    if not selector:
        return True
    sel = str(selector).strip().lower()
    if sel in {"*", "any", "all"}:
        return True
    if dept is None:
        return False
    return sel in {
        str(dept.id).lower(),
        dept.name.lower(),
        dept.folder_name.lower(),
        dept.short_code.lower(),
    }


def _task_name_matches(selector: Any, task: Task) -> bool:
    if not selector:
        return True
    sel = str(selector).strip().lower()
    if sel in {"*", "any", "all"}:
        return True
    return sel in {task.name.lower(), task.folder_name.lower(), task.task_name.lower()}


async def plan_and_apply_rules(
    db: AsyncSession,
    rules: list[Rule],
    *,
    actor_user_id: UUID | None = None,
    entity_ids: list[UUID] | None = None,
    task_ids: list[UUID] | None = None,
    dry_run: bool = True,
    project_base_date: date | None = None,
) -> dict[str, Any]:
    """
    Shared engine for both dry-run previews and persisted rule application.
    Rules evaluate in `(sort_order, created_at, id)` order; later rules win on rule-sourced fields,
    while manual assignments/fields are preserved unless `override_manual=True`.
    """
    if not rules:
        return {"matched_tasks": 0, "changes": [], "applied_count": 0}

    ordered_rules = sorted(
        rules,
        key=lambda r: (r.sort_order, r.created_at.isoformat() if r.created_at else "", str(r.id)),
    )

    depts = {d.id: d for d in (await db.execute(select(Department))).scalars().all()}
    ents = {
        e.id: e
        for e in (await db.execute(select(Entity).where(Entity.archived_at.is_(None))))
        .scalars()
        .all()
    }
    users = (await db.execute(select(User))).scalars().all()
    users_by_id = {u.id: u for u in users}
    users_by_name = {u.username.lower(): u for u in users}

    # Entity tags map
    ent_tags_map: dict[UUID, list[str]] = {}
    tags_by_id = {t.id: t.name for t in (await db.execute(select(Tag))).scalars().all()}
    for et in (await db.execute(select(EntityTag))).scalars().all():
        tname = tags_by_id.get(et.tag_id)
        if tname:
            ent_tags_map.setdefault(et.entity_id, []).append(tname)

    # Active entity links
    links = (
        (await db.execute(select(EntityLink).where(EntityLink.is_active.is_(True)))).scalars().all()
    )
    uses_map: dict[UUID, list[Entity]] = {}
    used_in_map: dict[UUID, list[Entity]] = {}
    for lk in links:
        src_e = ents.get(lk.source_entity_id)
        dst_e = ents.get(lk.target_entity_id)
        if src_e and dst_e:
            uses_map.setdefault(dst_e.id, []).append(src_e)
            used_in_map.setdefault(src_e.id, []).append(dst_e)

    # Load candidate tasks (plus all project tasks for cross-entity dependency lookups)
    all_tasks = (await db.execute(select(Task))).scalars().all()
    tasks_by_id = {t.id: t for t in all_tasks}
    tasks_by_entity: dict[UUID, list[Task]] = {}
    for t in all_tasks:
        if t.entity_id in ents:
            tasks_by_entity.setdefault(t.entity_id, []).append(t)

    if task_ids is not None:
        id_set = set(task_ids)
        candidate_tasks = [t for t in all_tasks if t.id in id_set and t.entity_id in ents]
    elif entity_ids is not None:
        ent_set = set(entity_ids)
        candidate_tasks = [t for t in all_tasks if t.entity_id in ent_set and t.entity_id in ents]
    else:
        candidate_tasks = [t for t in all_tasks if t.entity_id in ents]

    cand_ids = [t.id for t in candidate_tasks]
    if not cand_ids:
        return {"matched_tasks": 0, "changes": [], "applied_count": 0}

    # Existing assignments for candidate tasks
    assign_rows = (
        (await db.execute(select(TaskAssignment).where(TaskAssignment.task_id.in_(cand_ids))))
        .scalars()
        .all()
    )
    manual_assigns: dict[tuple[UUID, str], set[UUID]] = {}
    rule_assigns: dict[tuple[UUID, str], set[UUID]] = {}
    for a in assign_rows:
        key = (a.task_id, a.assignment_role)
        if a.source == "manual":
            manual_assigns.setdefault(key, set()).add(a.user_id)
        else:
            rule_assigns.setdefault(key, set()).add(a.user_id)

    # Existing manual field events
    manual_fields: dict[UUID, set[str]] = {}
    ev_rows = (
        await db.execute(
            select(TaskEvent.task_id, TaskEvent.field).where(
                TaskEvent.task_id.in_(cand_ids),
                TaskEvent.source == "user",
            )
        )
    ).all()
    for tid, fld in ev_rows:
        manual_fields.setdefault(tid, set()).add(fld)

    # Existing task tags
    task_tag_names: dict[UUID, set[str]] = {}
    for tt in (
        (await db.execute(select(TaskTag).where(TaskTag.task_id.in_(cand_ids)))).scalars().all()
    ):
        nm = tags_by_id.get(tt.tag_id)
        if nm:
            task_tag_names.setdefault(tt.task_id, set()).add(nm)

    # Existing dependencies
    existing_deps = {
        (d.task_id, d.upstream_task_id)
        for d in (await db.execute(select(TaskDependency))).scalars().all()
    }
    planned_extra_edges: list[tuple[UUID, UUID]] = []

    base_dt = project_base_date or date.today()
    # In-memory staged state for later-rule-wins semantics during one run
    staged_assign: dict[
        tuple[UUID, str], tuple[UUID, UUID, bool]
    ] = {}  # (tid, role) -> (uid, rule_id, override)
    staged_field: dict[
        tuple[UUID, str], tuple[Any, UUID, str]
    ] = {}  # (tid, field) -> (val, rule_id, rule_name)
    staged_tags: list[tuple[UUID, str, Rule]] = []
    staged_deps: list[
        tuple[UUID, UUID, str, bool, Rule]
    ] = []  # (tid, up_id, thresh, from_link, rule)
    change_records: list[dict[str, Any]] = []
    matched_task_ids: set[UUID] = set()

    for rule in ordered_rules:
        for task in candidate_tasks:
            ent = ents[task.entity_id]
            dept = depts.get(task.department_id)
            uses = uses_map.get(ent.id, [])
            used_in = used_in_map.get(ent.id, [])
            ctx = RuleContext(
                entity_id=ent.id,
                entity_name=ent.name,
                entity_type=ent.entity_type,
                entity_path=ent.rel_path,
                entity_tags=ent_tags_map.get(ent.id, []),
                uses_names=[u.name for u in uses],
                uses_types=[u.entity_type for u in uses if u.entity_type],
                used_in_names=[u.name for u in used_in],
                task_id=task.id,
                task_name=task.name,
                task_code=task.task_code,
                department_id=task.department_id,
                department_name=dept.name if dept else "",
                department_folder=dept.folder_name if dept else "",
                department_short_code=dept.short_code if dept else "",
            )
            if not evaluate_conditions(rule.conditions_json, ctx):
                continue

            matched_task_ids.add(task.id)
            for act in rule.actions_json:
                if not _dept_matches(act.get("department"), dept) or not _task_name_matches(
                    act.get("task_name"), task
                ):
                    continue
                override_manual = bool(act.get("override_manual", False))
                atype = act.get("type", "")

                if atype == "assign":
                    role = str(act.get("role", "artist"))
                    uid_raw = act.get("user_id")
                    uname_raw = act.get("username")
                    target_user: User | None = None
                    if uid_raw:
                        try:
                            target_user = users_by_id.get(UUID(str(uid_raw)))
                        except ValueError:
                            target_user = None
                    if target_user is None and uname_raw:
                        target_user = users_by_name.get(str(uname_raw).strip().lower())
                    if target_user is None:
                        continue
                    key = (task.id, role)
                    has_manual = bool(manual_assigns.get(key))
                    if has_manual and not override_manual:
                        change_records.append(
                            {
                                "rule_id": rule.id,
                                "rule_name": rule.name,
                                "task_id": task.id,
                                "task_code": task.task_code,
                                "field": f"assign.{role}",
                                "old_value": ", ".join(
                                    users_by_id[u].username
                                    for u in manual_assigns[key]
                                    if u in users_by_id
                                ),
                                "new_value": target_user.username,
                                "skipped_manual": True,
                            }
                        )
                        continue
                    prev_users = [
                        users_by_id[u].username
                        for u in (manual_assigns.get(key, set()) | rule_assigns.get(key, set()))
                        if u in users_by_id
                    ]
                    if key in staged_assign:
                        prev_uid = staged_assign[key][0]
                        prev_users = (
                            [users_by_id[prev_uid].username] if prev_uid in users_by_id else []
                        )
                    staged_assign[key] = (target_user.id, rule.id, override_manual)
                    change_records.append(
                        {
                            "rule_id": rule.id,
                            "rule_name": rule.name,
                            "task_id": task.id,
                            "task_code": task.task_code,
                            "field": f"assign.{role}",
                            "old_value": ", ".join(prev_users) or None,
                            "new_value": target_user.username,
                            "skipped_manual": False,
                        }
                    )

                elif atype == "set_priority":
                    new_prio = str(act.get("priority", "normal"))
                    if "priority" in manual_fields.get(task.id, set()) and not override_manual:
                        change_records.append(
                            {
                                "rule_id": rule.id,
                                "rule_name": rule.name,
                                "task_id": task.id,
                                "task_code": task.task_code,
                                "field": "priority",
                                "old_value": task.priority,
                                "new_value": new_prio,
                                "skipped_manual": True,
                            }
                        )
                        continue
                    old_val = staged_field.get((task.id, "priority"), (task.priority,))[0]
                    if old_val != new_prio:
                        staged_field[(task.id, "priority")] = (new_prio, rule.id, rule.name)
                        change_records.append(
                            {
                                "rule_id": rule.id,
                                "rule_name": rule.name,
                                "task_id": task.id,
                                "task_code": task.task_code,
                                "field": "priority",
                                "old_value": str(old_val),
                                "new_value": new_prio,
                                "skipped_manual": False,
                            }
                        )

                elif atype == "set_bid_hours":
                    new_bid = float(act.get("bid_hours", 0.0))
                    if "bid_hours" in manual_fields.get(task.id, set()) and not override_manual:
                        continue
                    old_val = staged_field.get((task.id, "bid_hours"), (task.bid_hours,))[0]
                    if old_val != new_bid:
                        staged_field[(task.id, "bid_hours")] = (new_bid, rule.id, rule.name)
                        change_records.append(
                            {
                                "rule_id": rule.id,
                                "rule_name": rule.name,
                                "task_id": task.id,
                                "task_code": task.task_code,
                                "field": "bid_hours",
                                "old_value": None if old_val is None else str(old_val),
                                "new_value": str(new_bid),
                                "skipped_manual": False,
                            }
                        )

                elif atype == "set_review_flags":
                    for flag in ("needs_lead_review", "needs_sup_review", "needs_client_review"):
                        if flag not in act or act[flag] is None:
                            continue
                        new_b = bool(act[flag])
                        if flag in manual_fields.get(task.id, set()) and not override_manual:
                            continue
                        old_b = staged_field.get((task.id, flag), (getattr(task, flag),))[0]
                        if old_b != new_b:
                            staged_field[(task.id, flag)] = (new_b, rule.id, rule.name)
                            change_records.append(
                                {
                                    "rule_id": rule.id,
                                    "rule_name": rule.name,
                                    "task_id": task.id,
                                    "task_code": task.task_code,
                                    "field": flag,
                                    "old_value": str(old_b),
                                    "new_value": str(new_b),
                                    "skipped_manual": False,
                                }
                            )

                elif atype == "set_ideal_dates":
                    anchor = base_dt
                    if act.get("base_date"):
                        try:
                            anchor = date.fromisoformat(str(act["base_date"]))
                        except ValueError:
                            anchor = base_dt
                    offset = int(act.get("start_offset_days", 0) or 0)
                    duration = max(1, int(act.get("duration_days", 3) or 3))
                    new_start = anchor + timedelta(days=offset)
                    new_finish = new_start + timedelta(days=duration - 1)
                    if (
                        "ideal_start_date" in manual_fields.get(task.id, set())
                        or "ideal_finish_date" in manual_fields.get(task.id, set())
                    ) and not override_manual:
                        continue
                    staged_field[(task.id, "ideal_start_date")] = (new_start, rule.id, rule.name)
                    staged_field[(task.id, "ideal_finish_date")] = (new_finish, rule.id, rule.name)
                    change_records.append(
                        {
                            "rule_id": rule.id,
                            "rule_name": rule.name,
                            "task_id": task.id,
                            "task_code": task.task_code,
                            "field": "ideal_dates",
                            "old_value": str(task.ideal_start_date or ""),
                            "new_value": f"{new_start.isoformat()}..{new_finish.isoformat()}",
                            "skipped_manual": False,
                        }
                    )

                elif atype == "add_tag":
                    tag_name = str(act.get("tag", "")).strip()
                    if not tag_name or tag_name in task_tag_names.get(task.id, set()):
                        continue
                    task_tag_names.setdefault(task.id, set()).add(tag_name)
                    staged_tags.append((task.id, tag_name, rule))
                    change_records.append(
                        {
                            "rule_id": rule.id,
                            "rule_name": rule.name,
                            "task_id": task.id,
                            "task_code": task.task_code,
                            "field": "tag",
                            "old_value": None,
                            "new_value": tag_name,
                            "skipped_manual": False,
                        }
                    )

                elif atype == "add_dependency":
                    scope = str(act.get("scope", "same"))
                    up_dept_sel = act.get("upstream_department")
                    up_task_sel = act.get("upstream_task_name")
                    thresh = str(act.get("threshold", "APP"))
                    if scope == "same":
                        up_entities = [ent]
                    elif scope == "uses":
                        up_entities = uses
                    else:
                        up_entities = used_in
                    for up_ent in up_entities:
                        for up_task in tasks_by_entity.get(up_ent.id, []):
                            if up_task.id == task.id:
                                continue
                            up_dept = depts.get(up_task.department_id)
                            if not _dept_matches(up_dept_sel, up_dept):
                                continue
                            if not _task_name_matches(up_task_sel, up_task):
                                continue
                            if (task.id, up_task.id) in existing_deps:
                                continue
                            if await would_create_task_dependency_cycle(
                                db,
                                task_id=task.id,
                                upstream_task_id=up_task.id,
                                extra_edges=planned_extra_edges,
                            ):
                                continue
                            existing_deps.add((task.id, up_task.id))
                            planned_extra_edges.append((up_task.id, task.id))
                            from_link = scope != "same"
                            staged_deps.append((task.id, up_task.id, thresh, from_link, rule))
                            change_records.append(
                                {
                                    "rule_id": rule.id,
                                    "rule_name": rule.name,
                                    "task_id": task.id,
                                    "task_code": task.task_code,
                                    "field": "dependency",
                                    "old_value": None,
                                    "new_value": f"{up_task.task_code} ({thresh})",
                                    "skipped_manual": False,
                                }
                            )

    if dry_run:
        return {
            "matched_tasks": len(matched_task_ids),
            "changes": change_records,
            "applied_count": 0,
        }

    applied = 0
    touched_dep_tasks: set[UUID] = set()
    rules_by_id = {r.id: r for r in ordered_rules}

    # Apply assignments (preserving manual unless override_manual)
    for (tid, role), (uid, rule_id, override_manual) in staged_assign.items():
        if override_manual:
            await db.execute(
                delete(TaskAssignment).where(
                    TaskAssignment.task_id == tid,
                    TaskAssignment.assignment_role == role,
                )
            )
        else:
            await db.execute(
                delete(TaskAssignment).where(
                    TaskAssignment.task_id == tid,
                    TaskAssignment.assignment_role == role,
                    TaskAssignment.source == "rule",
                )
            )
        db.add(
            TaskAssignment(
                task_id=tid,
                user_id=uid,
                assignment_role=role,
                source="rule",
                rule_id=rule_id,
            )
        )
        r_obj = rules_by_id.get(rule_id)
        db.add(
            TaskEvent(
                task_id=tid,
                user_id=actor_user_id,
                acted_as=f"rule:{r_obj.name if r_obj else rule_id}",
                source="rule",
                field=f"assign.{role}",
                old_value=None,
                new_value=users_by_id[uid].username if uid in users_by_id else str(uid),
            )
        )
        applied += 1

    # Apply scalar field changes
    for (tid, fld), (val, _rule_id, rule_name) in staged_field.items():
        task_obj = tasks_by_id.get(tid)
        if task_obj is None:
            continue
        old_val = getattr(task_obj, fld, None)
        setattr(task_obj, fld, val)
        db.add(
            TaskEvent(
                task_id=tid,
                user_id=actor_user_id,
                acted_as=f"rule:{rule_name}",
                source="rule",
                field=fld,
                old_value=None if old_val is None else str(old_val),
                new_value=str(val),
            )
        )
        applied += 1

    # Apply tags
    existing_tags_lookup = {t.name: t for t in (await db.execute(select(Tag))).scalars().all()}
    for tid, tname, rule in staged_tags:
        tag_obj = existing_tags_lookup.get(tname)
        if tag_obj is None:
            tag_obj = Tag(name=tname)
            db.add(tag_obj)
            await db.flush()
            existing_tags_lookup[tname] = tag_obj
        db.add(TaskTag(task_id=tid, tag_id=tag_obj.id))
        db.add(
            TaskEvent(
                task_id=tid,
                user_id=actor_user_id,
                acted_as=f"rule:{rule.name}",
                source="rule",
                field="tag",
                old_value=None,
                new_value=tname,
            )
        )
        applied += 1

    # Apply dependencies
    for tid, up_id, thresh, from_link, rule in staged_deps:
        db.add(
            TaskDependency(
                task_id=tid,
                upstream_task_id=up_id,
                threshold=thresh,
                from_entity_link=from_link,
                created_by=actor_user_id,
            )
        )
        up_t = tasks_by_id.get(up_id)
        db.add(
            TaskEvent(
                task_id=tid,
                user_id=actor_user_id,
                acted_as=f"rule:{rule.name}",
                source="rule",
                field="dependency",
                old_value=None,
                new_value=f"{up_t.task_code if up_t else up_id} ({thresh})",
            )
        )
        touched_dep_tasks.add(tid)
        applied += 1

    if touched_dep_tasks:
        await db.flush()
        await reevaluate_wtg_for_tasks(db, list(touched_dep_tasks))

    return {
        "matched_tasks": len(matched_task_ids),
        "changes": change_records,
        "applied_count": applied,
    }


async def run_trigger_rules(
    db: AsyncSession,
    trigger: Literal["entity_created", "task_created", "link_created"],
    *,
    entity_ids: list[UUID] | None = None,
    task_ids: list[UUID] | None = None,
    actor_user_id: UUID | None = None,
) -> int:
    """Evaluate and apply all enabled rules for a lifecycle trigger inside the current session."""
    rules = (
        (
            await db.execute(
                select(Rule)
                .where(Rule.enabled.is_(True), Rule.trigger == trigger)
                .order_by(Rule.sort_order.asc(), Rule.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    if not rules:
        return 0
    meta = (await db.execute(select(ProjectMeta))).scalar_one_or_none()
    base_dt = meta.created_at.date() if meta and meta.created_at else date.today()
    res = await plan_and_apply_rules(
        db,
        list(rules),
        actor_user_id=actor_user_id,
        entity_ids=entity_ids,
        task_ids=task_ids,
        dry_run=False,
        project_base_date=base_dt,
    )
    return int(res.get("applied_count", 0))
