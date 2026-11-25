# ORGANUM — Project Rules Engine (CR03 Phase 7E)

ORGANUM includes a purely declarative, non-code-executing project rules engine (`rules` table in `<project>/00_Pipeline/project.db`, service `backend/app/services/rules_engine.py`).

---

## 1. Triggers & Ordering
- **Triggers:** `entity_created`, `task_created`, `link_created`, `manual`.
- **Sort Order:** Rules execute in ascending `(sort_order, created_at, id)` order. Later rules override earlier rule-sourced changes (`task_assignments.source = 'rule'`), while manual assignments (`source = 'manual'`) and user-edited fields remain protected unless `override_manual = true`.
- **Auditability:** Applied rule mutations append `task_events` rows with `source = 'rule'` and `acted_as = 'rule:<rule_name>'`. Rule-created assignments record `task_assignments.source = 'rule'` and `rule_id`.

---

## 2. Conditions (`IF`)
Conditions form an `AND`/`OR` JSON tree up to **nesting depth 2**:
- **Fields:**
  - Entity attributes: `entity.name`, `entity.type`, `entity.tags`, `entity.path`
  - Linked entity attributes (from `entity_links`): `entity.uses.name`, `entity.used_in.name`, `entity.uses.type`
  - Task attributes: `department`, `task.name`, `task.code`
- **Operators:** `=`, `!=`, `contains`, `starts_with`, `in`, `matches` (regex), `>`, `>=`, `<`, `<=`.
- **Natural Comparison (`>`, `>=`, `<`, `<=`):** Splits identifiers into `(alphabetic_prefix, integer_suffix)`. Comparisons succeed only when prefixes match (`sh041 > sh040` is true, `sh1000 > sh040` is true, `ab041 > sh040` is false).
- **Regex Safety (`matches`):** Patterns are capped at 256 characters, checked against nested catastrophic quantifiers, and executed inside a 50ms timeout guard (`AppError(code='regex_timeout')`).

---

## 3. Actions (`THEN`)
Each action targets optional `department` and `task_name` selectors on the matched entity (defaulting to all tasks of the entity):
- `assign` (`artist` | `lead` | `supervisor`, `user_id` or `username`, `override_manual`)
- `set_priority` (`normal` | `high` | `stopper`)
- `set_bid_hours` (`>= 0`)
- `set_review_flags` (`needs_lead_review`, `needs_sup_review`, `needs_client_review`)
- `set_ideal_dates` (`start_offset_days`, `duration_days`, optional `base_date`)
- `add_tag`
- `add_dependency` (`scope`: `same` | `uses` | `used_in`, `upstream_department`, optional `upstream_task_name`, `threshold`: `APP` | `PUBLISHED` | `ANY_STATUS`) — cycle-checked and calls `reevaluate_wtg_for_tasks`.

---

## 4. Dry-Run Preview vs Apply
Both **Preview matches** (`POST /api/v1/projects/{uuid}/rules/preview`) and **Apply to existing tasks** (`POST /api/v1/projects/{uuid}/rules/apply`) execute the shared `plan_and_apply_rules(...)` planner so preview output matches applied edits, flagging protected manual entries as `skipped_manual: true`.

