from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.settings import Settings
from app.main import create_app


def make_entity_product_dir(
    production_root: Path,
    entity_name: str = "hero",
    dept: str = "Modeling",
    task: str = "main",
    version: str = "v0001",
) -> Path:
    ent_dir = production_root / entity_name
    ent_dir.mkdir(parents=True, exist_ok=True)
    marker = ent_dir / ".entity.json"
    if not marker.exists():
        marker.write_text(
            json.dumps({"uuid": str(uuid.uuid4()), "schema_version": 2}, indent=2),
            encoding="utf-8",
        )
    ver_dir = ent_dir / dept / task / "products" / version
    ver_dir.mkdir(parents=True, exist_ok=True)
    master = ver_dir.parent / "master.json"
    if not master.exists():
        master.write_text(json.dumps({"version": version}, indent=2), encoding="utf-8")
    return ver_dir


async def reconcile_files_map(
    client: AsyncClient, project_uuid: str
) -> dict[str, dict[str, Any]]:
    rec = await client.post(f"/api/v1/projects/{project_uuid}/reconcile")
    assert rec.status_code == 200
    tree = (await client.get(f"/api/v1/projects/{project_uuid}/entities")).json()
    by_name: dict[str, dict[str, Any]] = {}
    for ent in tree["entities"]:
        for dept in ent["departments"]:
            for task in dept["tasks"]:
                prod = task.get("product")
                if not prod:
                    continue
                for ver in prod["versions"]:
                    for f in ver["files"]:
                        by_name[str(f["filename"])] = f
    return by_name


@pytest.fixture
async def test_app(tmp_path: Path) -> AsyncIterator[tuple[object, AsyncClient, str, Path]]:
    app_db = tmp_path / "app.db"
    proj_root = tmp_path / "test_project"
    demo_proj = tmp_path / "absent_demo"

    settings = Settings(
        app_db_url=f"sqlite+aiosqlite:///{app_db.as_posix()}",
        demo_project_path=demo_proj,
        auto_scan_on_startup=False,
    )
    app = create_app(settings)

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        resp = await client.post(
            "/api/v1/projects",
            json={"path": str(proj_root), "name": "Test Project"},
        )
        assert resp.status_code == 201
        project_uuid = str(resp.json()["uuid"])
        yield app, client, project_uuid, proj_root / "01_Production"
