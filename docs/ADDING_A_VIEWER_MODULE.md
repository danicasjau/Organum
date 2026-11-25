# Adding a Format Handler and Viewer Module

ORGANUM follows the Open/Closed Principle on both backend and frontend so new media formats can be added without modifying existing handlers or viewer modules.

## Backend: Format Handler (`backend/app/formats/`)

1. Create a module under `backend/app/formats/handlers/<format_name>.py`.
2. Subclass `FormatHandler` from `app.formats.base`:
   - `handler_id: str` (stable identifier used in content-addressed artifact cache keys)
   - `handler_version: str` (bump when derived output changes to invalidate stale artifacts)
   - `extensions: tuple[str, ...]`
   - `magic_signatures: tuple[bytes, ...]` (optional)
   - `async def probe(self, path: Path) -> ProbeResult`
   - `async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument`
   - `async def derive(self, path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult`
   - `def capabilities(self) -> dict[str, bool]`
3. Register the handler instance in `app/formats/registry.py`.
4. Return a normalized `InspectionDocument` (`kind`, `summary`, `tree`, `layers`, `aovs`, `streams`, `timeline`, `metadata`, `capabilities`). The frontend right panel renders strictly from this normalized schema.

## Frontend: Viewer Module (`frontend/src/features/viewer/`)

1. Implement a React component accepting `ViewerModuleProps` (`file`, `inspection`, `viewerState`, `onStateChange`, `viewportRef`).
2. Respect the shared viewer topbar state (`colorspace`, `displayView`, `exposure`, `gamma`, `saturation`, `hue`, `channel`, `zoom`, `pixelGrid`, `bypass`) and disable unsupported topbar controls rather than hiding them.
3. Lazy-load heavy rendering libraries (`three`, `pdfjs-dist`, etc.) via dynamic `import()` inside the module entry.
4. Register the module in `features/viewer/moduleRegistry.ts` via `registerViewerModule(kind, componentLoader)`.

