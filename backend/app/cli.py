from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import uvicorn

from app.core.project_registry import ProjectRegistry
from app.core.settings import get_settings
from app.db.session import create_engine_and_sessionmaker
from app.formats.registry import build_default_registry
from app.main import create_app
from app.models.app_db import AppBase


async def _run_reconcile(project_path: Path) -> None:
    settings = get_settings()
    engine, session_factory = create_engine_and_sessionmaker(settings.app_db_url)
    format_registry = build_default_registry()
    proj_registry = ProjectRegistry(settings, format_registry)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(AppBase.metadata.create_all)
        async with session_factory() as app_db:
            ctx, report = await proj_registry.open_project(app_db, project_path)
            print(
                f"Reconcile complete for '{ctx.name}' ({ctx.uuid}): "
                f"entities={report.entities_scanned} created={report.entities_created} "
                f"updated={report.entities_updated} missing={report.entities_missing} "
                f"versions={report.versions_registered} files={report.files_scanned}"
            )
    finally:
        await proj_registry.dispose_all()
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="organum", description="ORGANUM backend CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    rec_p = sub.add_parser("reconcile", help="Reconcile a project directory with project.db")
    rec_p.add_argument("project_path", type=Path, help="Root path of an ORGANUM project")

    serve_p = sub.add_parser("serve", help="Run FastAPI server")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=8000)
    serve_p.add_argument("--reload", action="store_true")

    oa_p = sub.add_parser("export-openapi", help="Write OpenAPI schema JSON")
    oa_p.add_argument("--out", type=Path, default=Path("openapi.json"))

    args = parser.parse_args()
    if args.command == "reconcile":
        asyncio.run(_run_reconcile(args.project_path))
    elif args.command == "serve":
        uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload)
    elif args.command == "export-openapi":
        settings = get_settings().model_copy(update={"auto_scan_on_startup": False})
        application = create_app(settings)
        schema = application.openapi()
        args.out.write_text(json.dumps(schema, indent=2), encoding="utf-8")
        print(f"Wrote OpenAPI schema to {args.out}")


if __name__ == "__main__":
    main()
