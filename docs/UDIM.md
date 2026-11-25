# UDIM Detection, Mosaic Viewer & UV Annotations

ORGANUM detects UDIM texture tile sets automatically during reconcile and publish, resolves ambiguities against frame sequences using configurable scoring, streams each tile independently into a WebGL2 UV mosaic, and stores annotations in resolution-independent UV space.

## Supported Naming Patterns (`IMAGE_EXTS`)
- Numeric 4-digit suffixes (`1001..1999`):
  - `name.1001.ext`, `name_1001.ext`, `name-1001.ext`
  - Pattern stored in DB: `name.####.ext`
- `<UDIM>` pattern notation and Mari `(u, v)` tiles:
  - `name_u1_v1.ext` (`1 <= u <= 10`, `v >= 1`, `tile = 1001 + (u - 1) + 10 * (v - 1)`)
  - Pattern stored in DB: `name_<UDIM>.ext`

## UDIM vs. Frame-Sequence Scoring (`app/services/udim_service.py`)
Frame sequences starting at `1001` overlap numerically with UDIM tiles. ORGANUM resolves ambiguity with `score_udim_vs_frames`:
- **+10** Mari `u1_v1` naming
- **+3** Texture-like folder/department path keyword (`tex`, `textures`, `maps`, `lookdev`, `texturing`, `udim`, `material`, `materials`, `shading`, plus user-configured keywords stored in `app.db` `ui_prefs["udim_keywords"]` under **Settings -> Detection**)
- **+3** Texture-map stem keyword (`diffuse`, `albedo`, `basecolor`, `rough`, `normal`, `height`, `disp`, `ao`, `spec`, `mask`, etc.)
- **+2** Sparse or gappy number set (e.g., `1001, 1002, 1011`)
- **+1** Uniform tile pixel dimensions across the set
- **-4** Long contiguous run above `1010` (`> 10` frames)
- **-3** Motion/shot context in path or stem (`comp`, `render`, `plate`, `shot`, `anim`, `turntable`, `fx`, `beauty`, `lighting`)
- **Decision:** `score >= 0` selects `udim` (ambiguous sets default to `udim`); `score < 0` selects `frames`. Any number outside `1001..1999` forces `frames`.

## Per-File User Override
In the Viewer topbar, numbered sequences in `1001..1999` display a badge (`UDIM (auto)` or `Frames (auto)`) and a one-click **`Treat as frames`** / **`Treat as UDIM`** action. Overrides persist in `files.sequence_kind` and `files.sequence_kind_user_override = true` and are never overwritten by subsequent disk reconciliations.

## UV Mosaic & UV Annotations (`UdimMosaicViewer`)
- Each tile occupies a `1 × 1` UV cell (U right, V up: `1001` at `(0, 0)`, `1002` at `(1, 0)`, `1011` at `(0, 1)`), regardless of each tile's native resolution (`128px`, `256px`, `4096px`, etc.).
- Missing cells are left blank with a muted cell outline.
- Tiles stream independently via `GET /api/v1/projects/{uuid}/files/{id}/udim/{udim}/content` (or `float_rgba` with `{ "udim": <n> }` for EXR/HDR/TIFF/DPX/TX) and render through the shared WebGL2 color pipeline and per-tile pixel grid.
- The status bar displays `UDIM <tile> UV(u, v) (px_x, px_y) src[...] #hex`.
- Annotations on UDIM sets save with `coord_space = "uv"` (`u` right, `v` up) so strokes stay aligned even if tile resolutions change.

## `LayerStrip` & `layer_thumbs` Atlas
EXR AOVs, PSD/PSB layers & groups, TIFF pages, and UDIM tile thumbnails live in the collapsible/resizable bottom **`LayerStrip`** (`--layerstrip-h: 88px`). Each view fetches a content-addressed `128 × 128` sprite atlas + JSON manifest (`POST /files/{id}/artifacts/layer_thumbs` or `udim_tiles`, plus `GET /artifacts/{artifact_id}/atlas`), auto-normalizing float/depth/normal data via 2nd–98th percentiles (`auto_normalized = true`). When a UDIM set is stored as EXR, `LayerStrip` stacks the UDIM tiles row above the active tile's EXR AOVs row.

