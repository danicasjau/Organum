# ORGANUM Project Layout & Database Architecture

Each ORGANUM project is self-contained on disk so it can be archived, backed up, or moved without touching any central database.

## Disk Structure

```
<project_path>/
  00_Pipeline/
    project.db             # Project-scoped SQLite database (WAL mode)
    project.json           # { "uuid": "...", "name": "...", "schema_version": 2 }
    cache/                 # Content-addressed derived artifacts (portable)
    trash/                 # Soft-deleted entities, tasks, versions, scenefiles
    logs/
  01_Production/
    <folder>/              # Plain grouping directories (mkdir from GUI)
      <entity>/            # Entity root containing .entity.json ({uuid, schema_version})
        <department>/
          <task>/
            products/
              v0001/       # Immutable published product files
              v0002/
              master.json  # { "version": "v0002" } (mirror of DB master star)
            scenefiles/    # Free-form artist workspace (never registered in DB)
```

Global application state lives in `data/app.db`:
- `known_projects`: recently created/opened project paths and UUIDs
- `launchers`: user-configured DCC application mappings by extension
- `ui_prefs`: user interface and detection preferences

## Rules & Invariants

1. **Entities cannot nest:** An entity directory containing `.entity.json` never contains another entity beneath it.
2. **Portable names:** Folder names are sanitized (no `/`, `\`, control chars, trailing dots/spaces, or Windows reserved names `CON`/`NUL`/etc.; spaces become `_`; collision checks are case-insensitive).
3. **Soft delete:** Removing entities, tasks, product versions, or scenefiles moves disk folders/files into `00_Pipeline/trash/` rather than hard-deleting files.
4. **Publishing & MASTER star:** Each task holds one product at `<task>/products/`. First publish (`v0001`) auto-stars as `master` and writes `products/master.json`; subsequent publishes (`v0002`...) copy source files immutably under per-product lock and leave master unchanged unless explicitly starred.
5. **Scenefiles explorer:** `<task>/scenefiles/` is free-form live disk space (never registered in `project.db`), watched via `watchfiles` SSE (`/api/v1/projects/{uuid}/tasks/{id}/scenefiles/watch`) and confined strictly to the task's `scenefiles/` root.
6. **Disk/DB reconciliation:** Opening a project or running `Reconcile` matches entities by `.entity.json` UUID, detects externally moved/renamed directories, marks missing entities (`is_missing=true`) without silently deleting rows, and registers externally added `vNNNN/` product folders.

## Warning: SQLite on Network Drives

- ORGANUM opens each `00_Pipeline/project.db` using SQLite **WAL (Write-Ahead Logging) mode** for concurrent async reads.
- **Do NOT place active `project.db` files on SMB/CIFS/NFS network shares for multi-machine concurrent writes.** Network filesystem file locking (`flock` / SMB oplocks) is unreliable with SQLite WAL `-shm` files and can corrupt the database or raise `database is locked` errors.
- Always keep active `project.db` on a local SSD/NVMe drive (or single-writer local mount), and periodically sync/copy the project folder to network storage if archiving.

