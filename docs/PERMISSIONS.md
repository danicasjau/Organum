# ORGANUM Permissions & Two-Layer Authorization (CR03 Phase 7A)

## Roles & Scopes
Roles are data stored in `roles` and `role_permissions` inside `project.db` and editable in `/admin` (except `admin` which is locked to `all`).

Seeded system roles:
1. `admin` (`Administrator`): all permissions at `all` scope.
2. `producer` (`Production`): all permissions except `role.manage` and `admin.db` (cannot create/modify `admin` users or reset `admin` passwords).
3. `director` (`Director`): `task.view`, `task.comment`, `media.view`, `product.view`, `user.view`, `views.*` at `all` scope, plus **all three approval stages** (`task.approve.lead`, `task.approve.sup`, `task.approve.client` at `all` scope). Read-only on fields, schedules, assignments, time logs, and publishes unless assigned a capacity on a specific task.
4. `supervisor` (`Supervisor`): `task.view`, `task.comment`, `media.view`, `product.view`, `user.view`, `scenefile.launch`, `views.*` at `all`.
5. `lead` (`Lead`): `task.view`/`task.comment` `mine`; `media.view`/`product.view`/`user.view`/`scenefile.launch`/`views.kanban`/`views.workload` `all`.
6. `artist` (`Artist`): `task.view`/`task.comment` `mine`; `media.view`/`product.view`/`scenefile.launch` `all`.
7. `external` (`External`): `task.view`/`task.comment`/`media.view`/`product.view` at `company` scope; no `scenefile.launch`.
8. `client` (`Client`): must belong to a company with `kind='external'`. Receives `task.view`, `task.comment`, `media.view`, `product.view`, `task.approve.client` at `shared` scope only. Uses separate allowlist serializers (`ClientEntityTreeOut`, `ClientProductOut`) and receives `404` on unshared versions/files.

## Two-Layer Resolution (`can(db, auth, perm, task)`)
For a given user, permission key, and task:
1. **Archived Lock:** If `project_meta.status == 'archived'`, all writes are refused for non-admins.
2. **Admin Override:** `admin` is always allowed `(True, "role:admin")`.
3. **Role Grant:** Checks `role_permissions` scope (`all`, `company`, `mine`, `shared`, `none`) against the task (`role:<name>`).
4. **Capacity Grant:** Checks the user's `task_assignments` (`supervisor`, `lead`, `artist`) against `capacity_permissions` (`capacity:<role>`).

## Client Comment & Annotation Visibility Rule (Confirmed)
- Annotations/comments with `visibility='client'` are visible **only** to `client` (shared company), `producer` (`Production`), `director` (`Direction`), and `admin`.
- **Artists (as well as leads, supervisors, and externals) cannot see `visibility='client'` items.**
- Clients can only create `visibility='client'` items and cannot see `visibility='internal'` items.

