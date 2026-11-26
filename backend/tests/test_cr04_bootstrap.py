"""CR04 §1: first run from an empty repository (no data/, no known projects)."""

from __future__ import annotations

import shutil
from pathlib import Path

from httpx import ASGITransport, AsyncClient

from app.core.settings import Settings
from app.main import create_app
from app.services.auth_service import reset_lockouts
from tests.conftest import attach_csrf_hook, login_client


def _empty_settings(root: Path) -> Settings:
    data = root / "data"  # deliberately NOT created: mirrors a fresh clone
    return Settings(
        app_db_url=f"sqlite+aiosqlite:///{(data / 'app.db').as_posix()}",
        demo_project_path=data / "demo_project",
        icons_dir=data / "icons",
        storage_root=data / "products",
        cache_root=data / "cache",
    )


async def test_bootstrap_from_empty_directory_creates_project_then_login(tmp_path: Path) -> None:
    reset_lockouts()
    settings = _empty_settings(tmp_path)
    assert not (tmp_path / "data").exists()
    app = create_app(settings)

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        attach_csrf_hook(client)
        # Startup created data/ and app.db instead of crashing.
        assert (tmp_path / "data" / "app.db").is_file()

        boot = (await client.get("/api/v1/auth/bootstrap")).json()
        assert boot == {"bootstrap_allowed": True, "projects": [], "stale_projects": []}

        # Bad folder gives a readable 400, not a 500.
        a_file = tmp_path / "not_a_dir.txt"
        a_file.write_text("x", encoding="utf-8")
        bad = await client.post("/api/v1/projects", json={"path": str(a_file), "name": "X"})
        assert bad.status_code == 400
        assert "not a folder" in bad.json()["error"]["message"]

        proj_root = tmp_path / "projects" / "show"
        created = await client.post(
            "/api/v1/projects",
            json={"path": str(proj_root), "name": "Show", "starter_departments": ["FX"]},
        )
        assert created.status_code == 201, created.text
        project_uuid = created.json()["uuid"]
        assert (proj_root / "00_Pipeline" / "project.db").is_file()
        assert (proj_root / "01_Production").is_dir()

        boot = (await client.get("/api/v1/auth/bootstrap")).json()
        assert boot["bootstrap_allowed"] is False
        assert [p["uuid"] for p in boot["projects"]] == [project_uuid]

        me = await login_client(client, project_uuid, "admin", settings.initial_admin_password)
        assert me["user"]["must_change_password"] is True

        # Once a project exists, anonymous creation is refused.
        anon = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        async with anon:
            denied = await anon.post(
                "/api/v1/projects", json={"path": str(tmp_path / "p2"), "name": "P2"}
            )
            assert denied.status_code == 401
            denied_open = await anon.post("/api/v1/projects/open", json={"path": str(proj_root)})
            assert denied_open.status_code == 401


async def test_stale_project_path_is_reported_and_can_be_located(tmp_path: Path) -> None:
    reset_lockouts()
    settings = _empty_settings(tmp_path)
    app = create_app(settings)
    original = tmp_path / "projects" / "show"
    moved = tmp_path / "moved" / "show"

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        attach_csrf_hook(client)
        created = await client.post("/api/v1/projects", json={"path": str(original), "name": "S"})
        assert created.status_code == 201
        project_uuid = created.json()["uuid"]

    # Folder moved while the server was down.
    moved.parent.mkdir(parents=True)
    shutil.move(str(original), str(moved))

    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        attach_csrf_hook(client)
        boot = (await client.get("/api/v1/auth/bootstrap")).json()
        assert boot["bootstrap_allowed"] is True
        assert boot["projects"] == []
        assert [s["uuid"] for s in boot["stale_projects"]] == [project_uuid]

        # Login against the stale project gives a clear message.
        login = await client.post(
            f"/api/v1/projects/{project_uuid}/auth/login",
            json={"project_uuid": project_uuid, "username": "admin", "password": "x"},
        )
        assert login.status_code == 404
        assert login.json()["error"]["code"] == "project_missing_on_disk"

        # Locating a folder that holds no project is a readable 404.
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        nope = await client.post("/api/v1/projects/open", json={"path": str(empty_dir)})
        assert nope.status_code == 404
        assert nope.json()["error"]["code"] == "project_not_found"

        # Locate the moved folder anonymously during bootstrap; the same uuid is kept.
        located = await client.post("/api/v1/projects/open", json={"path": str(moved)})
        assert located.status_code == 200, located.text
        assert located.json()["uuid"] == project_uuid
        boot = (await client.get("/api/v1/auth/bootstrap")).json()
        assert boot["bootstrap_allowed"] is False
        assert boot["stale_projects"] == []
