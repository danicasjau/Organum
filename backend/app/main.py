from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.v1.health import router as health_router
from app.api.v1.router import api_router
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, request_id_var
from app.core.project_registry import ProjectRegistry
from app.core.settings import Settings, get_settings
from app.db.session import create_engine_and_sessionmaker
from app.formats.registry import build_default_registry
from app.jobs.inprocess import InProcessRunner
from app.models.app_db import AppBase, KnownProject
from app.services.auth_service import verify_startup_security


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create configured FastAPI application instance."""
    cfg = settings or get_settings()
    configure_logging()

    app_engine, app_session_factory = create_engine_and_sessionmaker(
        cfg.app_db_url, echo=cfg.debug
    )
    job_runner = InProcessRunner()
    format_registry = build_default_registry()
    project_registry = ProjectRegistry(cfg, format_registry)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        async with app_engine.begin() as conn:
            await conn.run_sync(AppBase.metadata.create_all)

        if cfg.auto_scan_on_startup:
            demo_meta = cfg.demo_project_path / "00_Pipeline" / "project.json"
            async with app_session_factory() as app_db:
                existing_rows = (await app_db.execute(select(KnownProject))).scalars().all()
                has_valid = any(
                    (Path(row.path) / "00_Pipeline" / "project.json").is_file()
                    for row in existing_rows
                )
                if not has_valid and demo_meta.is_file():
                    await project_registry.open_project(app_db, cfg.demo_project_path)

        async with app_session_factory() as sec_db:
            await verify_startup_security(cfg, sec_db, project_registry)
        try:
            yield
        finally:
            await job_runner.shutdown()
            await project_registry.dispose_all()
            await app_engine.dispose()

    app = FastAPI(
        title=cfg.app_name,
        version=cfg.app_version,
        lifespan=lifespan,
    )
    app.state.settings = cfg
    app.state.app_engine = app_engine
    app.state.app_session_factory = app_session_factory
    app.state.project_registry = project_registry
    app.state.job_runner = job_runner
    app.state.format_registry = format_registry

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        token = request_id_var.set(req_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = req_id
            return response
        finally:
            request_id_var.reset(token)

    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(api_router)
    return app


app = create_app()
