# ORGANUM — Entity Links & Dependency Suggestions (Phase 7B)

Entity Links model non-filesystem production relationships between entities (for example `glasses -> hero_robot -> sh010`), stored in `project.db` (`entity_links` table).

---

## 1. Directed Acyclic Entity Graph
- Direction: `source_entity_id -> target_entity_id` ("source is used in target").
  - **Uses:** upstream sources pointing into the entity.
  - **Used in:** downstream targets receiving the entity.
- **Uniqueness & Safety:**
  - Unique per `(source_entity_id, target_entity_id, link_type)` (including `NULL` `link_type`).
  - Self-links (`source == target`) return `400`.
  - Any cycle (direct or multi-hop) is rejected via BFS reachability with `409 Conflict`.
  - Soft-deleted/archived entities retain their links (marked `source_archived`/`target_archived`/`is_archived`).
- **Indirect traversal:** `GET /api/v1/projects/{project_uuid}/entities/{entity_id}/links` computes direct links (`depth = 1`) plus indirect multi-hop paths up to depth `3` (`via_entity_names`) without duplicating already direct links.

---

## 2. Dependency Templates & Suggestions
- Admin-managed templates live in `dependency_templates`:
  `(upstream_department_id, upstream_task_name?, downstream_department_id, downstream_task_name?, threshold ['APP'|'PUBLISHED'|'ANY_STATUS'], enabled)`
- **`POST /entities/{entity_id}/suggest-dependencies`** (preview-only, read-only):
  - Evaluates enabled templates across linked entity pairs up to `depth` (defaults to `project_meta.link_dependency_depth`, 1 or 2).
  - Returns candidate task dependency pairs annotated with `already_exists` and `would_cycle`.
- **`POST /entities/{entity_id}/apply-dependencies`**:
  - Requires `task.dependencies` permission.
  - Inserts confirmed dependencies in a single transaction with `from_entity_link = true`, performs cycle validation across the batch, updates `WTG` status if all deps are met, and writes `task_events` + `audit_log`.
- **Entities Scope Filter:** `GET /tasks?entity_id=<id>&include_linked_entities=true` expands to upstream/downstream linked entities up to `project_meta.link_dependency_depth`.

---

## 3. ENTITIES Links UI (Phase 7C)
- **Column 1 Badges & Bulk Linking (`EntityColumn`):** Entity cards display direct link counts (`N links`) and support `Ctrl/Meta+Click` or `Shift+Click` multi-selection with context menu actions (**Link selected to…** / **Link from…**) when `entity.link` is permitted.
- **Inspector Links Section (`EntityInspectorTab`):** Displays direct **Uses** and **Used in** cards (with entity type and free-text `link_type` badges), plus lighter indented **indirect links** (`indirect, via ...`, up to depth 3), **+ Uses… / + Used in…** searchable multi-select pickers, and **Suggest Deps…** preview modal (`POST /entities/{id}/suggest-dependencies` -> confirm -> `POST /entities/{id}/apply-dependencies`).


