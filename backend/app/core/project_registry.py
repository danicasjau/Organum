from __future__ import annotations

import asyncio
import json
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)

from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.settings import Settings
from app.db.migrations import upgrade_project_db
from app.db.session import create_engine_and_sessionmaker
from app.formats.base import FormatRegistry
from app.models.app_db import KnownProject, UserProjectIndex
from app.models.project_db import (
    Department,
    DepartmentDefaultTask,
    ProjectMeta,
)
from app.models.user import User
from app.services.permissions import seed_project_auth, sync_user_project_index
from app.services.reconcile_service import ReconcileReport, reconcile_project
from app.storage.local import LocalStorage

DEFAULT_STARTER_DEPARTMENTS: list[str] = [
    "Modeling",
    "Rigging",
    "Animation",
    "FX",
    "Lighting",
    "Lookdev",
    "Compositing",
]


@dataclass
class ProjectContext:
    uuid: str
    name: str
    root: Path
    pipeline_dir: Path
    production_dir: Path
    cache_dir: Path
    trash_dir: Path
    logs_dir: Path
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    storage: LocalStorage
    cache_storage: LocalStorage


class ProjectRegistry:
    """LRU cache of open project database engines and local storage adapters."""

    def __init__(
        self, settings: Settings, format_registry: FormatRegistry, max_open: int = 16
    ) -> None:
        self._settings = settings
        self._format_registry = format_registry
        self._max_open = max_open
        self._open: OrderedDict[str, ProjectContext] = OrderedDict()
        self._lock = asyncio.Lock()

    def _build_context(self, proj_uuid: str, name: str, root: Path) -> ProjectContext:
        resolved = root.resolve()
        pipeline_dir = resolved / "00_Pipeline"
        production_dir = resolved / "01_Production"
        cache_dir = pipeline_dir / "cache"
        trash_dir = pipeline_dir / "trash"
        logs_dir = pipeline_dir / "logs"
        db_file = pipeline_dir / "project.db"
        db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"
        engine, session_factory = create_engine_and_sessionmaker(db_url, echo=self._settings.debug)
        return ProjectContext(
            uuid=proj_uuid,
            name=name,
            root=resolved,
            pipeline_dir=pipeline_dir,
            production_dir=production_dir,
            cache_dir=cache_dir,
            trash_dir=trash_dir,
            logs_dir=logs_dir,
            engine=engine,
            session_factory=session_factory,
            storage=LocalStorage(production_dir),
            cache_storage=LocalStorage(cache_dir),
        )

    async def _evict_if_needed(self) -> None:
        while len(self._open) > self._max_open:
            _, evicted = self._open.popitem(last=False)
            await evicted.engine.dispose()

    async def _ensure_project_user(
        self,
        ctx: ProjectContext,
        app_db: AsyncSession | None = None,
    ) -> None:
        async with ctx.session_factory() as session:
            await seed_project_auth(
                session,
                self._settings,
                app_db=app_db,
                project_uuid=ctx.uuid,
                project_name=ctx.name,
            )
            await session.commit()

    def _prepare_create_dirs(self, path: Path, clean_name: str) -> tuple[Path, str, str]:
        if not str(path).strip():
            raise AppError("invalid_path", "Choose a folder for the project", status_code=400)
        resolved = path.resolve()
        pipeline_dir = resolved / "00_Pipeline"
        project_json_path = pipeline_dir / "project.json"
        if project_json_path.exists():
            raise ConflictError(f"A project already exists at '{resolved}'")
        if resolved.exists() and not resolved.is_dir():
            raise AppError(
                "invalid_path", f"'{resolved}' is a file, not a folder", status_code=400
            )

        try:
            for d in (
                resolved,
                pipeline_dir,
                pipeline_dir / "cache",
                pipeline_dir / "trash",
                pipeline_dir / "logs",
                resolved / "01_Production",
            ):
                d.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise AppError(
                "invalid_path",
                f"Cannot create the project folder '{resolved}': {exc.strerror or exc}",
                status_code=400,
            ) from exc

        proj_uuid = str(uuid.uuid4())
        project_json_path.write_text(
            json.dumps(
                {"uuid": proj_uuid, "name": clean_name, "schema_version": 2},
                indent=2,
            ),
            encoding="utf-8",
        )
        db_file = pipeline_dir / "project.db"
        db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"
        upgrade_project_db(db_url)
        return resolved, proj_uuid, db_url

    async def create_project(
        self,
        app_db: AsyncSession,
        path: Path,
        name: str,
        starter_departments: list[str] | None = None,
    ) -> ProjectContext:
        clean_name = name.strip()
        if not clean_name:
            raise AppError("invalid_name", "Project name cannot be empty", status_code=400)
        resolved, proj_uuid, _ = await asyncio.to_thread(
            self._prepare_create_dirs, path, clean_name
        )

        ctx = self._build_context(proj_uuid, clean_name, resolved)
        async with ctx.session_factory() as session:
            session.add(ProjectMeta(uuid=proj_uuid, name=clean_name, schema_version=3))
            depts = starter_departments or []
            palette_tokens = [f"--series-{i}" for i in range(1, 8)]
            used_codes: set[str] = set()
            for idx, dept_name in enumerate(depts):
                clean_d = dept_name.strip()
                if not clean_d:
                    continue
                folder = clean_d.replace(" ", "_")
                raw_code = "".join(ch for ch in clean_d.upper() if ch.isalnum())
                base_code = (
                    raw_code[:3] if len(raw_code) >= 3 else (raw_code + "XXX")[:3]
                ) or "DPT"
                short_code = base_code
                c_idx = 1
                while short_code in used_codes:
                    short_code = f"{base_code[:2]}{c_idx}"
                    c_idx += 1
                used_codes.add(short_code)
                dept = Department(
                    name=clean_d,
                    folder_name=folder,
                    short_code=short_code,
                    color=palette_tokens[idx % len(palette_tokens)],
                    sort_order=idx,
                    is_active=True,
                )
                session.add(dept)
                await session.flush()
                session.add(
                    DepartmentDefaultTask(
                        department_id=dept.id,
                        name="main",
                        folder_name="main",
                        sort_order=0,
                    )
                )
            await seed_project_auth(
                session,
                self._settings,
                app_db=app_db,
                project_uuid=proj_uuid,
                project_name=clean_name,
            )
            await session.commit()

        existing_known = (
            await app_db.execute(
                select(KnownProject).where(KnownProject.path == resolved.as_posix())
            )
        ).scalar_one_or_none()
        if existing_known is not None:
            await app_db.delete(existing_known)
            await app_db.flush()

        app_db.add(
            KnownProject(
                uuid=proj_uuid,
                name=clean_name,
                path=resolved.as_posix(),
                last_opened=datetime.now(UTC),
            )
        )
        await app_db.commit()

        async with self._lock:
            self._open[proj_uuid] = ctx
            self._open.move_to_end(proj_uuid)
            await self._evict_if_needed()
        return ctx

    def _prepare_open_dirs(self, path: Path) -> tuple[Path, str, str]:
        resolved = path.resolve()
        project_json_path = resolved / "00_Pipeline" / "project.json"
        if not project_json_path.is_file():
            raise AppError(
                "project_not_found",
                f"No ORGANUM project found at '{resolved}' (missing 00_Pipeline/project.json)",
                status_code=404,
            )
        meta = json.loads(project_json_path.read_text(encoding="utf-8"))
        proj_uuid = str(meta["uuid"])
        name = str(meta.get("name") or resolved.name)

        for d in (
            resolved / "00_Pipeline" / "cache",
            resolved / "00_Pipeline" / "trash",
            resolved / "00_Pipeline" / "logs",
            resolved / "01_Production",
        ):
            d.mkdir(parents=True, exist_ok=True)

        db_file = resolved / "00_Pipeline" / "project.db"
        db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"
        upgrade_project_db(db_url)
        return resolved, proj_uuid, name

    async def open_project(
        self, app_db: AsyncSession, path: Path
    ) -> tuple[ProjectContext, ReconcileReport]:
        resolved, proj_uuid, name = await asyncio.to_thread(self._prepare_open_dirs, path)

        async with self._lock:
            existing_ctx = self._open.get(proj_uuid)
            if existing_ctx is not None:
                self._open.move_to_end(proj_uuid)
                ctx = existing_ctx
            else:
                ctx = self._build_context(proj_uuid, name, resolved)
                self._open[proj_uuid] = ctx
                await self._evict_if_needed()

        await self._ensure_project_user(ctx, app_db=app_db)
        async with ctx.session_factory() as session:
            report = await reconcile_project(session, ctx.production_dir, self._format_registry)
            active_usernames = (
                (await session.execute(select(User.username).where(User.is_active.is_(True))))
                .scalars()
                .all()
            )
            await sync_user_project_index(
                app_db, proj_uuid, name, [str(u) for u in active_usernames]
            )

        known = await app_db.get(KnownProject, proj_uuid)
        if known is None:
            app_db.add(
                KnownProject(
                    uuid=proj_uuid,
                    name=name,
                    path=resolved.as_posix(),
                    last_opened=datetime.now(UTC),
                )
            )
        else:
            known.name = name
            known.path = resolved.as_posix()
            known.last_opened = datetime.now(UTC)
        await app_db.commit()
        return ctx, report

    async def get_project(self, project_uuid: str, app_db: AsyncSession) -> ProjectContext:
        async with self._lock:
            ctx = self._open.get(project_uuid)
            if ctx is not None:
                self._open.move_to_end(project_uuid)
                return ctx

            known = await app_db.get(KnownProject, project_uuid)
            if known is None:
                raise NotFoundError("project", project_uuid)
            root = Path(known.path)
            if not await asyncio.to_thread(
                lambda: (root / "00_Pipeline" / "project.json").is_file()
            ):
                raise AppError(
                    "project_missing_on_disk",
                    f"Project '{known.name}' was not found at '{known.path}'. "
                    "The folder was moved or deleted: locate it again or create a new project.",
                    status_code=404,
                )

            db_file = root / "00_Pipeline" / "project.db"
            db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"
            await asyncio.to_thread(upgrade_project_db, db_url)

            ctx = self._build_context(known.uuid, known.name, root)
            self._open[project_uuid] = ctx
            await self._evict_if_needed()
            await self._ensure_project_user(ctx, app_db=app_db)
            return ctx

    async def forget_project(self, app_db: AsyncSession, project_uuid: str) -> None:
        known = await app_db.get(KnownProject, project_uuid)
        if known is None:
            raise NotFoundError("project", project_uuid)
        from sqlalchemy import delete as sa_delete

        await app_db.execute(
            sa_delete(UserProjectIndex).where(UserProjectIndex.project_uuid == project_uuid)
        )
        await app_db.delete(known)
        await app_db.commit()
        async with self._lock:
            ctx = self._open.pop(project_uuid, None)
        if ctx is not None:
            await ctx.engine.dispose()

    async def dispose_all(self) -> None:
        async with self._lock:
            contexts = list(self._open.values())
            self._open.clear()
        for ctx in contexts:
            await ctx.engine.dispose()
