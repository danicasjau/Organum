# Product Publish Pipeline Audit

**Date:** 2026-11-26  
**Scope:** Entity-browser product publishing: file uploads, scenefile publishing, version registration, MASTER updates, and workflow use of published versions.

## Summary

The normal publish paths are working and the focused regression checks pass. The earlier Vite `ECONNRESET` was not reproducible during this audit; the API was healthy afterward and the publish-upload integration test succeeded. That proxy message means the frontend proxy's connection to the backend was reset while reading; by itself, it does not identify why.

The pipeline should **not yet be considered fully resilient**. The audit found failure and edge cases that can leave users uncertain about publish results or leave files inconsistent with the database. Large-file and interrupted-upload behavior was not verified.

## Flow traced

1. `ProductsColumn` opens `PublishDialog` for selected scenefiles or dropped files.
2. `apiClient` sends uploads as multipart `FormData`, or sends scenefile paths as JSON.
3. Vite proxies `/api` to the FastAPI backend.
4. The API checks project/task permissions and calls the publish service.
5. The service stages files under the task's product directory, allocates a version, moves it into `products/vNNNN/`, probes and hashes files, registers database rows, updates the task's latest-version pointer, and updates `master.json` when appropriate.
6. On success, the frontend refreshes the entity tree. Published versions are also used by task workflow transitions.

Key implementation files:

- [`ProductsColumn.tsx`](../frontend/src/features/entities/ProductsColumn.tsx)
- [`EntityDialogs.tsx`](../frontend/src/features/entities/EntityDialogs.tsx)
- [`client.ts`](../frontend/src/lib/api/client.ts)
- [`vite.config.ts`](../frontend/vite.config.ts)
- [`products_api.py`](../backend/app/api/v1/products_api.py)
- [`publish_service.py`](../backend/app/services/publish_service.py)

## Verified

- Scenefile publish, source preservation, version numbering under concurrent requests, MASTER selection, `master.json`, and soft deletion are covered by `test_publish_concurrency_master_star_scenefiles_and_sequence_override`.
- Multipart upload and subsequent workflow transitions are covered by `test_phase7b_workflow_dependencies_comments_and_client_isolation`.
- Both backend tests passed during this audit.
- Frontend TypeScript check and the entity frontend unit test passed.
- The backend health endpoint returned `200 OK` after the reported incident.

## Findings

### 1. Publish-dialog failures are not shown to the user

`PublishDialog` resets its busy state in `finally`, but does not catch or render a rejected `onPublish` request. A failed request can therefore leave the dialog open without a useful error message. If the connection drops after the server has committed the version, retrying without checking the version list could create a second version.

Reference: [`EntityDialogs.tsx`](../frontend/src/features/entities/EntityDialogs.tsx)

### 2. A post-move failure can leave an unregistered version directory

The service moves the staged directory into `products/vNNNN/` before probing/registering all files and committing the database transaction. If a later operation fails, the outer cleanup removes the old staging path, not necessarily the already-moved version directory. This can leave files on disk without a corresponding version row.

Reference: [`publish_service.py`](../backend/app/services/publish_service.py)

### 3. Uploads with the same filename can overwrite each other

Each upload is written into the staging directory using only its basename. Selecting two files with the same basename from different folders can silently replace the first staged file.

Reference: [`publish_service.py`](../backend/app/services/publish_service.py)

### 4. Large and interrupted uploads are not covered by the focused tests

The existing upload examples use small PNGs. This audit did not establish a maximum upload size or test a large file, a mid-transfer disconnect, or recovery after a failed probe/database commit. The original `ECONNRESET` therefore remains unexplained, even though the path now works.

## Recommendation

Before calling the pipeline fully resilient, add visible publish-error handling, make staging/database failures compensate for any filesystem move, reject or safely disambiguate duplicate basenames, and add tests for those cases plus a representative larger upload. The current report makes no claim that these issues caused the earlier connection reset.

**Code changes:** none in this audit; this file is the requested report.
