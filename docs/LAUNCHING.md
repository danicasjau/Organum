# Launching Local DCC Applications

Web browsers run inside a strict origin sandbox and intentionally block `file://` URLs and arbitrary local executable spawning.

## Architecture

- File and DCC application launching is executed exclusively by the **local ORGANUM FastAPI backend** (`POST /api/v1/projects/{uuid}/launch` and `.../reveal`).
- Launchers are configured in **Settings -> Applications** (`data/app.db` `launchers` table) mapping lowercase file extensions (e.g. `.hip`, `.ma`, `.mb`, `.blend`, `.nk`, `.psd`, `.spp`) to local executable paths and argument templates (`{file}`).
- `POST /api/v1/launchers/autodetect` scans standard OS install paths and `$PATH` for common DCC tools and proposes candidate mappings without modifying saved settings until confirmed.

## Security Guarantees

1. **Loopback restriction:** Both `/api/v1/fs/browse` and launch endpoints check that `ORGANUM_BIND_HOST` and the client peer are loopback addresses (`127.0.0.1` / `::1` / `localhost`). Remote/non-loopback bindings reject launch and folder-browse requests with `403`.
2. **Project containment:** Target files must resolve safely inside the active project root (`<project_path>`). Path traversal attempts are rejected with `400`.
3. **No shell interpolation:** Processes spawn via `subprocess.Popen(argv, shell=False)` using explicit argument arrays; `shell=True` is never used.
- **Icon Overrides & Endpoints:** `GET /api/v1/icons` lists extensions with custom override files in `data/icons/`, and `GET /api/v1/icons/{ext}` serves `<ext>.png` or `<ext>.svg` without generating unnecessary 404 probes.
- **Original flat badges:** `SceneFileIcon` renders flat 2002-era extension badges derived from palette tokens rather than proprietary vendor logos (`--fam-*` tokens).
- **UI Disclosure:** Double-click items in `ScenefilesExplorer` display a tooltip reminding users that DCC launching executes via the local loopback backend because web browsers block `file://` URLs.

