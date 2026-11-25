# ORGANUM — Task Workflow, Dependencies & Workload Math (Phase 7B)

This document describes the pure server-side task state machine, dependency propagation, time-log aggregation, and workload math introduced in **Change Request 03 — Phase 7B**.

---

## 1. Status Lifecycle (`services/workflow.py`)

Tasks use 9 canonical statuses:

| Status | Meaning |
|---|---|
| `WTG` | Waiting on unmet upstream blocking dependencies |
| `RDY` | Ready to begin work |
| `IP` | In Progress |
| `RTK` | Retake (sent back from review or reopened from `APP`) |
| `P_LEAD` | Pending Lead review |
| `P_SUP` | Pending Supervisor review |
| `P_CLIENT` | Pending Client review |
| `APP` | Approved (terminal until explicitly reopened) |
| `HLD` | On Hold (`status_before_hold` preserves prior status) |

### Transition Rules
- **`WTG -> RDY`**: Automatic whenever all upstream blocking dependencies satisfy their threshold (`APP`, `PUBLISHED`, or `ANY_STATUS`). Also manually triggered via `task.status.force`. Regressing an upstream task does **not** auto-demote downstream tasks; instead, `blocked_upstream = true` flags the warning in Task responses.
- **`RDY -> IP`** and **`RTK -> IP`**: Requires `task.status.start`. Records `actual_start_date` if unset.
- **Submit (`IP | RTK -> first_review_stage`)**: Requires `task.status.submit`. Routes through enabled per-task review flags (`needs_lead_review`, `needs_sup_review`, `needs_client_review`) in order `P_LEAD -> P_SUP -> P_CLIENT -> APP`. When `project_meta.require_version_to_submit = true`, a published version (`version_id` or `task.latest_version_id`) is required. Entering `P_CLIENT` automatically shares the submitted version with every company in `task_shares`.
- **Approve (`P_* -> next_review_stage | APP`)**: Requires matching stage permission (`task.approve.lead`, `task.approve.sup`, `task.approve.client`).
  - Confirmed user override: **`director`** can approve all 3 stages (`lead`, `sup`, `client`) as `role:director`.
  - **`producer`** and **`admin`** approving `P_CLIENT` act with `acted_as = "on_behalf"` (`on_behalf_of = "client"`), logged in both `task_reviews` and `audit_log`.
  - Reaching `APP` sets `approved_version_id`, sets `actual_finish_date`, and triggers downstream `WTG -> RDY` evaluation.
- **Retake (`P_* -> RTK`)** & **Reopen (`APP -> RTK`)**: Require a non-empty review comment, increment `retake_count`, clear `actual_finish_date`, and create a `TaskReview(decision="retake")` row.
- **Hold / Resume (`* -> HLD -> status_before_hold`)**: Requires `task.status.hold`.

All status changes write append-only `task_events` recording `acted_as` (`role:<name>`, `capacity:<role>`, `on_behalf`, or `system`).

---

## 2. Priorities, Bids, Time Logs & Rollup Status
- **Priorities:** `normal`, `high`, `stopper`.
- **Bid hours & days:** `bid_hours` is stored exclusively in hours; `bid_days = round(bid_hours / hours_per_day, 2)` (default `8.0`).
- **Time logs:** `POST` / `DELETE /tasks/{id}/time-logs` atomically recalculate `tasks.logged_hours`.
- **Matrix Rollup (`compute_rollup_status`):** Any `RTK` -> `RTK`; else any pending `P_*` -> `P_*`; else all `APP` -> `APP`; else all non-`APP` `HLD` -> `HLD`; else lowest of `WTG < RDY < IP`.

---

## 3. Comments & Visibility (`visibility='internal' | 'client'`)
- **`client`** users read and write only `visibility='client'` comments on tasks shared with their company.
- **`admin`**, **`producer`**, and **`director`** read both `'internal'` and `'client'` comments (and users holding `task.share_client` may post `'client'` comments).
- **`supervisor`**, **`lead`**, **`artist`**, and **`external`** users see and write only `'internal'` comments — client comments are filtered out server-side.
- Client endpoints (`GET /tasks`, `GET /tasks/{id}`, `GET /review-queue`) serialize strictly through dedicated allowlist schemas (`ClientTaskListOut`, `ClientTaskDetailOut`, `ClientReviewQueueItemOut`) and return `404` for unshared tasks.

---

## 4. Workload Calculation (`services/workload.py`)
- Only `"artist"` capacity assignments contribute toward daily demand (`LEAD`/`SUP` oversight does not consume artist capacity).
- Dates strictly before `today` display actual `TimeLog` hours; dates from `max(today, ideal_start_date)` through `ideal_finish_date` on configured `working_days` distribute `max(0, bid_hours - logged_hours)` evenly across working days (and across assigned artists).
- Unscheduled non-`APP` tasks (missing `ideal_finish_date` or no artist assignee) appear in `unscheduled_tasks`.

---

## 5. Production Views & Focus Inbox (Phase 7C)
- **Tasks Workspace (`/tasks`):** Segmented `ViewSwitcher` (`Grid`, `Matrix`, `Kanban`, `Review Queue` — server-scoped and permission-gated) plus shared `TaskFilterBar` with saved views (`saved_views`) and resizable `TaskDetail` dock (`--task-panel-w: 380px`).
- **Task Grid (`TaskGridView`):** Virtualized TanStack Table v9 with column chooser, column resize, multi-sort, CSV export, and permission-checked inline editing; clients see only reduced allowlist columns.
- **Department × Entity Matrix (`DepartmentMatrixView`):** Groups rows by folder path hierarchy or entity type, honors `Include linked`, shows `computeRollupStatus` on collapsed departments, expands into task sub-columns, and supports TSV copy/paste with dry-run preview, atomic commit, and `Ctrl+Z` undo.
- **Kanban (`KanbanView`):** 9 workflow columns (`WTG..HLD`) with optional department/assignee swimlanes and drag-and-drop transitions (opening a prompt when comment or version input is required).
- **Review Queue (`ReviewQueueView`) & My Tasks (`/me`):** Oldest-first review queue and capacity-separated Focus Inbox (`All | I DO | I LEAD | I SUPERVISE`) with `Start`, `Log hours`, `Submit for review`, `Approve`, `Retake`, `Open in viewer`, and `Open task folder`.
- **ENTITIES Integration:** Right inspector appends the shared `Task` tab (`TaskDetail`), and saved viewer annotations offer **Post to task** (`kind="media"` with thumbnail and frame deep-link).


