# ORGANUM — Multi-Format Media & 3D Product-Review Viewer

ORGANUM is a dense, 2002-era professional DCC-styled product review application built on a modern, clean, typed monorepo architecture:

- **Backend:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, SQLite (dev) / PostgreSQL (prod).
- **Frontend:** React 19, TypeScript strict, Vite, TanStack Query, Zustand, Radix UI headless primitives, plain layered CSS (`@layer tokens, base, components, utilities`).

---

## Quick Start

### Prerequisites
- Python 3.12 (`uv` manages the `.venv` automatically)
- Node.js 22+ & npm
- Optional: `ffmpeg` on PATH for generating the demo MP4

### Windows One-Click Launcher (`launch.bat`)
Double-click `launch.bat` at the repository root (or run `launch.bat` in Command Prompt / PowerShell) to install missing dependencies, seed the demo project if absent, and start both the backend (`127.0.0.1:8000`) and frontend (`127.0.0.1:5173`).

### Local Development

```powershell
# 1. Backend setup, demo project generation & initial reconcile
cd backend
uv sync --python 3.12 --all-extras
uv run python scripts/make_demo_data.py
uv run python -m app.cli export-openapi --out openapi.json

# 2. Run backend API (http://127.0.0.1:8000, loopback required for folder browser & launching)
uv run uvicorn app.main:app --reload --port 8000
```

```powershell
# 3. Frontend setup & dev server (http://localhost:5173)
cd frontend
npm install
npm run generate:api
npm run dev
```

Visit `http://localhost:5173/login` (redirects automatically from `/entities`), sign in to a project, or visit `http://localhost:5173/gallery` for the Widget Gallery. See [docs/SECURITY.md](docs/SECURITY.md) and [docs/PERMISSIONS.md](docs/PERMISSIONS.md) for authentication, Argon2id/CSRF/Origin security, role permissions, capacity rules, and client isolation.

#### Seeded Demo Accounts (Project: `ORGANUM Demo`)
- **Initial Admin (first-login forced password change):** `admin` / initial password `magicadmin**` (or `ORGANUM_INITIAL_ADMIN_PASSWORD`)
- **Active Role Accounts (password `DemoPass123!`):**
  - `qa_admin` — Administrator
  - `prod_maya` — Production (`producer`)
  - `dir_alex` — Director (also assigned `SUP` capacity on `hero_robot/Lighting/beauty`)
  - `sup_elena` — Supervisor
  - `lead_marco` — Lead
  - `art_sam` — Artist (`DO` on `hero_robot/Modeling/main`)
  - `ext_li` — External (`Outsource FX Co`, `FX` department)
  - `cli_jordan` — Client (`Client Studio`, shared access to `hero_robot/Lighting/beauty` `v0001` only)

> **Important (Local Launching & SQLite Caveats):** Browsers block `file://` launching, so DCC launching runs strictly through the local loopback backend ([docs/LAUNCHING.md](docs/LAUNCHING.md)). Each project stores `00_Pipeline/project.db` in SQLite WAL mode; keep active `project.db` on a local drive rather than a network share ([docs/PROJECT_LAYOUT.md](docs/PROJECT_LAYOUT.md)).

### `/entities` & `/viewer` Workspace (Phase 6B + Phases 2–5)
- **Entities Browser (Left 36% in `Browse` preset / 10% in `Review` preset; `Ctrl+E` maximizes over workspace):**
  - **Column 1 — Entities:** Virtualized cards (`72px` height, `56px` auto/manual thumbnail, free-text type badge, tag chips), folder breadcrumbs (`Backspace` up), search by name/tag/type, filters, sort, New Folder / New Entity dialogs, right-click Rename/Edit/Add Department/Promote/Reveal/Trash.
  - **Column 2 — Departments & Tasks:** Selected entity's departments and tasks (never starred on departments), `"+"` attach from project catalog, right-click New Task / Manage Default Tasks / Remove Department / Delete Task.
  - **Column 3 (Top) — Products:** One product per task; **MASTER** pinned row first (auto-starred on `v0001` publish, `master.json` mirrored atomically), then sequential `vNNNN` versions. Right-click Set as MASTER, Set as Entity Thumbnail, Treat Sequence as UDIM/Frames override, Reveal, Delete to Trash. Drag-and-drop OS files or scenefiles to publish.
  - **Column 3 (Bottom) — Scenefiles Explorer:** Live disk explorer for `<task>/scenefiles/` with `watchfiles` SSE live updates, grid/list toggle, `SceneFileIcon` 2002-era flat badges (`data/icons/` overrideable), Back/Forward/Up, `Ctrl`/`Shift`/marquee multi-select, `F2` rename, `Del` to trash, drag-drop folder moves, double-click non-scene media to inspect in Viewer, and double-click DCC files to launch via the local loopback backend (browsers block `file://`).
- **2D WebGL2 Pipeline (Center 44% `Browse` / 60% `Review`):** Two-row `ViewerTopbar` (Row A display/3D/UDIM controls with `"»"` priority overflow; Row B wide `Ev`/`G`/`Sat`/`Hue` Slider+NumberField controls) and 8-well grouped `ViewerToolStrip` (`Navigate`, `Select`, `Draw`, `Style`, `History`, `View`, `Scope`, `3D`). Float32/Uint8 textures (`ORGF` float buffers for EXR/TIFF, PNG/JPG/PSD), exposure/gamma/saturation/hue/channel/colorspace/false-color transforms, Fit–6400% zoom, `NEAREST` filtering above 200%, shader pixel grid (`>= 800%`), per-pixel numeric overlay (`>= 2400%`), pixel inspector + `Alt+Drag` ROI stats.
- **`LayerStrip` & UDIM Mosaic Viewer (Phase 6C):** EXR AOVs, PSD/PSB layers/groups (with eye visibility + group breadcrumbs), TIFF pages, and UDIM tiles live in the collapsible/resizable bottom `LayerStrip` powered by cached `128×128` `layer_thumbs`/`udim_tiles` sprite atlases (`[ / ]` stepping, S/M/L thumbs, percentile auto-normalization tooltips). UDIM texture sets (`name.1001.ext`, `<UDIM>`, Mari `u1_v1`) score automatically vs. `1001+` shot sequences, support one-click `Treat as frames` / `Treat as UDIM` overrides, stream tiles independently into a `1×1` UV Mosaic with `Ctrl+click` tile subset selection, and save resolution-independent `coord_space='uv'` annotations ([docs/UDIM.md](docs/UDIM.md)).
- **2D Vector Annotations & Ephemeral Laser:** Free draw (`B`), Closed draw (`P`), Rect (`R`), Ellipse (`O`), Eraser (`E`), Undo/Redo (`Ctrl+Z`/`Ctrl+Y`), `Enter` / `Submit` annotation history commits, Frame/Range scope (`I`/`O`), and Laser (`L`, ~1.5s fade, never saved).
- **Inspector Panel (Right 20% `Browse` / 30% `Review`, min 260px):** `Entity` tab (thumbnail auto/manual/reset, tags, departments, typed key/value `PropertyEditor` data table) plus merged `Structure & Info` tab, searchable Metadata, and saved Annotations + JSON export.
- **3D Viewport & Annotation Plane (Phase 3):** Three.js WebGL2 viewer (`glTF/GLB`, `OBJ/MTL`, `USD/USDA/USDC/USDZ` via `usd-core` → GLB), 1.2× bbox framing, infinite decade-subdivision ground grid, shading modes (`Shaded`, `Flat`, `Wire`, `Shd+Wire`, `Normals`, `Depth`, `Unlit`), `Persp`/`Ortho`, topbar `View` background selector (`Default`/`Black`/`White`/`Gray`/`Gradient`), instant `Tab` Freeze 2D ↔ Live 3D toggle, material texture 2D inspection, and world-space 3D Annotation Plane with auto-new annotation on perspective change (`d` midpoint default + editable distance, Jump Camera).
- **Time-Based Media (Phase 4):** `VideoViewer` (`MP4/MOV/MKV/AVI` via all-intra `libvpx-vp9` / `libopenh264` proxy + image sequence frame streaming `/api/v1/files/{id}/sequence/{frame}`) inside the WebGL2 color/zoom pipeline, `32px` synchronized `AudioWaveformStrip`, `28px` zoomable `Timebar` with adaptive frame ticks & annotation markers, `TransportControls` (`Space`/`J`/`K`/`L`/`←`/`→`/`Home`/`End`/`I`/`O`), `AudioViewer` (dual-channel peaks, FFT spectrogram toggle, L/R meters, range annotations), `TimelineViewer` (`EDL/XML` via OpenTimelineIO), and glTF animation playback (`THREE.AnimationMixer`).
- **HDR/Production Images, OCIO LUT, Documents & Data (Phase 5):** OpenImageIO handler for `HDR/PIC`, `DPX`, tiled/mipmapped `TX/TEX`, and `TGA` (float32 GPU inspection + tile pyramid `/api/v1/artifacts/{id}/tiles/{level}/{tile}` + clean partial/unsupported notice on unreadable `.tex` variants + animated GIF/WebP frame stepping); optional OpenColorIO 3D LUT baking (`/api/v1/colorspaces/lut`); `PdfViewer` (`pypdf` + lazy-loaded `pdfjs-dist` with text selection, multi-page search, and Inspector page jump); `DataViewer` (Excel-like virtualized `DataGrid` for CSV with multi-sort, filters, range stats, inline edit, and TSV copy; collapsible `JsonTree`/raw toggle for JSON & YAML); and live RGB/Luma `Histogram` scope in the Inspector.
- Press `?` inside `/viewer` for all keyboard shortcuts.

### Docker Compose

```bash
docker compose up --build
# With PostgreSQL profile:
docker compose --profile postgres up --build
```

---

## Verification Commands

```powershell
# Backend
cd backend
uv run ruff check .
uv run mypy --strict app
uv run pytest

# Frontend
cd frontend
npm run lint          # Stylelint (no raw hex/px/transitions/shadows) + ESLint (no JSX style=)
npm run check:contrast
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

---

## Design Token Reference (`frontend/src/components/ui/styles/tokens.css`)

### 60-30-10 Color System
- **60% Dominant:** `--surface-panel` (`#1E293B` dark / `#E2E8F0` light), `--surface-window` (`#172033` / `#CBD5E1`)
- **30% Secondary Recessed:** `--surface-field` (`#0F172A` / `#F8FAFC`)
- **10% Accents:** `--accent` (`#8B5CF6` / `#7C3AED`), `--btn-primary-bg` (`#7C3AED`), `--success` (`#10B981` / `#059669`)

### Spacing & Sizing (§10)

| Element | Token | Compact Value |
|---|---|---|
| Base Spacing Scale | `--space-1` .. `--space-6` | `2px, 4px, 6px, 8px, 12px, 16px` |
| Control Height | `--ctl-h` | `20px` (`24px` comfortable) |
| Topbar / Viewer Rows | `--topbar-h` / `--viewer-row-h` | `30px` / `24px` (Ev `190px`, G/Sat/Hue `170px`) |
| ToolStrip | `--toolstrip-w` | `34px` (`22x22px` buttons in `3px` wells, `8px` group gap) |
| LayerStrip | `--layerstrip-h` / `--layer-thumb` | `88px` / `56px` (`44px` S, `72px` L) |
| Panel Title Bar | `--panel-title-h` | `18px` (`0 var(--space-3)`) |
| StatusBar | `--statusbar-h` | `20px` |
| Timebar / AudioStrip | `--timebar-h` / `--audiostrip-h` | `28px` / `32px` |

---

## Component Library API (`frontend/src/components/ui`)

| Component | Key Props | Features |
|---|---|---|
| `Button` | `variant`, `size`, `pressed`, `error`, `forceState` | 2-stop bevel, WCAG AA semantic fills, toggle state |
| `NumberField` | `mode`, `value`, `baselineValue`, `min`, `max`, `step`, `precision`, `unit`, `showSteppers` | Horizontal drag scrub (`Shift` ×10, `Ctrl` ×0.1), math expressions (`2*3.5`), wheel, dirty bar + reset, context menu |
| `Slider` / `RangeSlider` | `value`, `min`, `max`, `logarithmic`, `showTicks` | Paired `NumberField`, keyboard arrows, log scale |
| `VectorField` / `ColorField` | `values`, `lockable`, `rgba` | XYZ axis indicators, uniform lock toggle, RGBA swatch popover |
| `AngleDial` / `Knob` / `Stepper` / `CurveRamp` | `value`, `points`, `onChange` | SVG radial/ramp editing, Shift 15° snap, presets |
| `Select` / `SearchField` | `options`, `filterable`, `debounceMs`, `captureCtrlF` | Filterable popup, keyboard navigation, match counter |
| `PropertyEditor` / `PropertyRow` | `groups`, `dirty`, `onReset` | 35/65 split, search filter, "Modified" filter, dirty indicator |
| `DataGrid` / `SceneFileIcon` | `columns`, `rows`, `extension`, `customIconUrl` | Virtualized grid + 32px family-coded DCC badges |
| `Charts` (`LineChart`, `ScatterPlot`, `BarChart`, `Histogram`, `Heatmap`, `Sparkline`, `GaugeBar`, `NodeGraph`) | `series` / `channels` / `matrix` / `nodes` | Zero animation, 1px 30% grid, mono ticks, max 8 token series + dash patterns, hover readout |
| `Telemetry` (`JobQueue`, `LogConsole`) | `jobs` / `entries` | Background job progress bars & searchable monospace log console |
| `Panel` / `Tabs` / `Toolbar` / `ToolStrip` / `Topbar` / `MenuBar` / `Timebar` / `TransportControls` / `AudioWaveformStrip` / `Dialog` / `Popover` / `Tooltip` / `StatusBar` / `Banner` / `ToastProvider` | Standard composition props | Radix accessible overlays, adaptive frame-tick ruler, synchronized audio strip, 1px hard popup shadow |

---

## Extending ORGANUM

- **Add a UI Component:** Create `frontend/src/components/ui/<Name>/<Name>.tsx` and `<Name>.css` inside `@layer components`, using only variables from `tokens.css` (Stylelint enforces zero raw colors, zero raw px > 1px, `transition: none`, and zero JSX `style={}`). Export it from `frontend/src/components/ui/index.ts`.
- **Add a Format Handler / Viewer Module:** See [`docs/ADDING_A_VIEWER_MODULE.md`](docs/ADDING_A_VIEWER_MODULE.md).
- **Theming:** Set `data-theme="dark"` or `data-theme="light"` and `data-density="compact"` or `data-density="comfortable"` on `<html>`. Only `tokens.css` values change.

## Do / Don't Checklist

- **DO** use `tokens.css` variables for all colors, spacing, radii, and fonts.
- **DO** support full keyboard operation, `focus-visible` rings, and ARIA roles.
- **DO NOT** use inline JSX `style={}`, Tailwind, CSS-in-JS, blur, or CSS transitions.
- **DO NOT** integrate or stub any excluded format listed in `docs/DEPENDENCIES.md` / project spec §6.3.

