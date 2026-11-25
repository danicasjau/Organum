# Third-Party Dependencies & Licence Verification

All packages below were verified against PyPI and the npm registry for current availability, maintenance status, Python 3.12 (`cp312` / `py3-none-any` / `abi3`) Windows `win_amd64` wheel availability, and licence compatibility.

## Backend (Python 3.12)

### Core Runtime (Installed in Phase 0)

| Package | Version | Latest Release | Win312 Wheel | Licence | Purpose |
|---|---|---|---|---|---|
| `fastapi` | 0.165.0 | 2026-11-18 | Yes | MIT | HTTP API framework & OpenAPI schema |
| `uvicorn` | 0.54.0 | 2026-09-25 | Yes | BSD-3-Clause | ASGI server |
| `pydantic` | 2.14.4 | 2026-11-19 | Yes | MIT | Typed DTOs & validation |
| `pydantic-settings` | 2.16.3 | 2026-11-13 | Yes | MIT | Environment configuration |
| `sqlalchemy` (`[asyncio]` + `greenlet`) | 2.1.9 | 2026-11-16 | Yes | MIT | Async ORM & Core SQL |
| `aiosqlite` | 0.22.1 | 2025-12-23 | Yes | MIT | Async SQLite driver (dev) |
| `asyncpg` | 0.32.0 | 2026-10-06 | Yes | Apache-2.0 | Async PostgreSQL driver (prod) |
| `alembic` | 1.20.1 | 2026-10-22 | Yes | MIT | Schema migrations |
| `python-multipart` | 0.0.34 | 2026-11-16 | Yes | Apache-2.0 | Streamed multipart file upload |
| `watchfiles` | 1.3.0 | 2026-09-21 | Yes | MIT | Rust-backed filesystem watcher |
| `sse-starlette` | 3.7.1 | 2026-11-22 | Yes | BSD-3-Clause | Server-Sent Events for job progress |
| `pyjwt` | 2.15.1 | 2026-09-28 | Yes | MIT | Legacy JWT helper (superseded for web auth by server-side sessions) |
| `argon2-cffi` | 25.1.0 | 2025-06-02 | Yes | MIT | Argon2id password hashing (`argon2-cffi-bindings` 26.2.0) |
| `pyyaml` | 6.0.4 | 2026-11-20 | Yes | MIT | YAML parsing for data viewer |
| `pillow` | 13.0.0 | 2026-10-16 | Yes | MIT-CMU | Baseline image probing & demo generation |
| `numpy` | 2.5.5 | 2026-11-15 | Yes | BSD-3-Clause | Array processing for pixels/audio |

### Format Handlers (Planned for Phases 2–5, Pre-Verified)

| Package | Version | Latest Release | Win312 Wheel | Licence | Purpose |
|---|---|---|---|---|---|
| `openexr` | 3.5.5 | 2026-11-23 | Yes | BSD-3-Clause | Multipart EXR & AOV channel reading |
| `openimageio` | 3.2.2.0 | 2026-11-18 | Yes | Apache-2.0 | EXR, DPX, TX/TEX, HDR, TGA, TIFF I/O |
| `tifffile` | 2026.11.16 | 2026-11-17 | Yes | BSD-3-Clause | Multi-page/layered TIFF & tags |
| `imagecodecs` | 2026.11.11 | 2026-11-12 | Yes | BSD-3-Clause | TIFF compression codecs |
| `psd-tools` | 1.27.0 | 2026-11-18 | Yes | MIT | PSD/PSB layer tree & per-layer extraction |
| `av` | 19.0.2 | 2026-10-21 | Yes | BSD-3-Clause (FFmpeg LGPL DLLs) | Video/audio probing, proxy transcode, frame/peaks decode |
| `soundfile` | 0.14.0 | 2026-06-06 | Yes | BSD-3-Clause (`libsndfile` LGPL-2.1) | Lossless audio I/O (WAV, FLAC, AIFF) |
| `trimesh` | 5.2.2 | 2026-11-22 | Yes | MIT | OBJ/MTL & mesh inspection/GLB export |
| `pygltflib` | 1.16.5 | 2025-07-24 | Yes | MIT | glTF/GLB inspection & extras |
| `usd-core` | 26.11 | 2026-10-21 | Yes | `LicenseRef-TOST-1.0` (Modified Apache 2.0) | USD/USDA/USDC/USDZ stage inspection & export |
| `opentimelineio` | 0.18.1 | 2025-11-09 | Yes | Apache-2.0 | EDL & FCP XML timeline parsing |
| `opencolorio` | 2.6.0 | 2026-10-01 | Yes | BSD-3-Clause | Optional OCIO config & 3D LUT baking |
| `pypdf` | 7.1.1 | 2026-11-18 | Yes | BSD-3-Clause | PDF metadata, page dimensions & bookmark inspection |

### Dev & Testing

| Package | Version | Licence | Purpose |
|---|---|---|---|
| `pytest` | 9.2.0 | MIT | Test runner |
| `pytest-asyncio` | 1.5.0 | Apache-2.0 | Async test support |
| `httpx` | 0.28.1 | BSD-3-Clause | FastAPI ASGI test client |
| `ruff` | 0.17.6 | MIT | Linting & formatting |
| `mypy` | 2.4.1 | MIT | Strict static type checking |
| `testcontainers` | 4.15.0 | Apache-2.0 | Ephemeral PostgreSQL migration testing |

### Rejected Packages

| Package | Licence | Reason Rejected |
|---|---|---|
| `mutagen` | GPL-2.0-or-later | Copyleft GPL licence incompatible with permissive distribution requirement; use PyAV (`av`) and `soundfile` for audio metadata instead. |

---

## Frontend (Node 22 / TypeScript)

| Package | Version | Licence | Purpose |
|---|---|---|---|
| `react` / `react-dom` | 19.3.1 | MIT | UI framework |
| `react-router-dom` | 7.18.6 | MIT | Client routing (`/viewer`, `/gallery`) |
| `@tanstack/react-query` | 5.108.4 | MIT | Server state, prefetching, mutations |
| `@tanstack/react-table` | 9.3.1 | MIT | Headless DataGrid engine |
| `@tanstack/react-virtual` | 3.14.28 | MIT | 100k-node tree & grid virtualization |
| `zustand` | 5.1.0 | MIT | Per-file LRU viewer state & tool state |
| `react-resizable-panels` | 4.24.1 | MIT | Resizable 10/60/30 layout splitters |
| `@radix-ui/react-dialog` | 1.3.1 | MIT | Accessible modal dialogs |
| `@radix-ui/react-dropdown-menu` | 2.2.1 | MIT | MenuBar & dropdown menus |
| `@radix-ui/react-popover` | 1.3.1 | MIT | Popovers (ColorPicker, filter popups) |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | 500ms tooltips with shortcut badge |
| `@radix-ui/react-context-menu` | 2.4.1 | MIT | Right-click context menus |
| `three` | 0.174.x | MIT | WebGL2 3D viewport (lazy-loaded in Phase 3) |
| `@types/three` | 0.174.x | MIT | TypeScript definitions for Three.js |
| `pdfjs-dist` | 5.4.624 | Apache-2.0 | PDF rendering (lazy-loaded in Phase 5) |
| `vite` | 6.2.x | MIT | Bundler & dev server |
| `typescript` | 5.8.x | Apache-2.0 | Strict TypeScript compiler |
| `vitest` | 3.0.x | MIT | Unit tests |
| `@testing-library/react` | 16.3.x | MIT | Component DOM & ARIA testing |
| `stylelint` | 16.16.x | MIT | CSS token & rule enforcement |
| `eslint` | 9.22.x | MIT | TS/JSX enforcement (no inline styles) |
| `prettier` | 3.5.x | MIT | Code formatting |
| `openapi-typescript` | 7.13.0 | MIT | Generates TS types from `openapi.json` |
| `@playwright/test` | 1.51.x | Apache-2.0 | E2E & screenshot verification |

---

## Licence & Cost Advisories Requiring User Confirmation

1. **Video Proxy Codec (`libx264` GPL vs. Permissive Alternatives — Phase 4):**
   - `libx264` is **GPL-2.0+** (and the system `ffmpeg` binary on the host is a GPL full build).
   - Permissive alternatives bundled inside PyAV (`av` LGPL wheels):
     - **`libopenh264`** (Cisco BSD-2-Clause): H.264 all-intra / baseline, universally browser-playable via WebCodecs & `<video>`.
     - **`libvpx-vp9`** (BSD-3-Clause) or **`libsvtav1`** (BSD-2-Clause-Patent): all-intra / low-latency GOP, slower encode than OpenH264.
   - **Confirmed Phase 4 decision:** **`libvpx-vp9` (BSD-3-Clause, all-intra WebM)** is the default video proxy encoder (`av==19.0.2` Windows wheels exclude `libopenh264` and `h264_mf` rejects `g=1` all-intra), automatically preferring **`libopenh264`** (BSD-2-Clause) if present in the runtime FFmpeg build. GPL `libx264` is never used.
2. **LGPL Dynamic Libraries (`av` and `soundfile`):**
   - Both PyAV (`av`, BSD-3-Clause Python bindings) and `soundfile` (BSD-3-Clause Python bindings) ship dynamically linked LGPL shared libraries (FFmpeg / `libsndfile`) inside their wheels. Dynamic linking preserves LGPL compliance.
3. **USD → GLB Conversion & Deforming Animation (Phase 3):**
   - `usd-core` (`LicenseRef-TOST-1.0`, Modified Apache 2.0) provides full USD stage parsing, prims, variants, materials, and transforms, but has no built-in glTF exporter. Converting USD to canonical GLB requires a custom Python exporter (`usd-core` → `pygltflib`).
   - Transform animations export cleanly via glTF channels; deforming vertex animation requires baking a capped per-frame point/morph cache (recommended cap to confirm before Phase 3).
