from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from PIL import Image

from app.core.errors import AppError
from app.services.naming import check_case_insensitive_collision, sanitize_folder_name
from tests.conftest import TEST_ADMIN_PASSWORD, authenticate_project_admin, login_client


def test_folder_name_sanitization_and_collision(tmp_path: Path) -> None:
    assert sanitize_folder_name("  Hero Robot. ") == "Hero_Robot"
    assert sanitize_folder_name("shot 010_comp") == "shot_010_comp"

    for bad in ("", "   ", "...", "a/b", r"a\b", "CON", "nul.txt", "bad:name"):
        with pytest.raises(AppError):
            sanitize_folder_name(bad)

    (tmp_path / "Hero_Robot").mkdir()
    assert check_case_insensitive_collision(tmp_path, "hero_robot") is True
    assert (
        check_case_insensitive_collision(tmp_path, "hero_robot", ignore_name="Hero_Robot") is False
    )
    assert check_case_insensitive_collision(tmp_path, "Prop_Crate") is False


@pytest.mark.asyncio
async def test_project_lifecycle_departments_reconcile_and_launchers(
    test_app: tuple[object, AsyncClient, str, Path],
    tmp_path: Path,
) -> None:
    _, client, initial_uuid, _ = test_app

    # 1. Create a brand new project from scratch with starter departments
    custom_root = tmp_path / "show_alpha"
    create_resp = await client.post(
        "/api/v1/projects",
        json={
            "path": str(custom_root),
            "name": "Show Alpha",
            "starter_departments": ["Modeling", "Lookdev", "Lighting"],
        },
    )
    assert create_resp.status_code == 201
    proj = create_resp.json()
    proj_uuid = str(proj["uuid"])
    assert proj_uuid != initial_uuid
    await authenticate_project_admin(client, proj_uuid)
    assert (custom_root / "00_Pipeline" / "project.json").is_file()
    assert (custom_root / "00_Pipeline" / "project.db").is_file()
    assert (custom_root / "00_Pipeline" / "cache").is_dir()
    assert (custom_root / "00_Pipeline" / "trash").is_dir()
    assert (custom_root / "00_Pipeline" / "logs").is_dir()
    assert (custom_root / "01_Production").is_dir()

    # Known projects list contains both
    known = (await client.get("/api/v1/projects")).json()
    assert len(known) == 2

    # 2. Department catalog + default tasks CRUD + reorder
    depts = (await client.get(f"/api/v1/projects/{proj_uuid}/departments")).json()
    assert [d["name"] for d in depts] == ["Modeling", "Lookdev", "Lighting"]

    added_dept = (
        await client.post(
            f"/api/v1/projects/{proj_uuid}/departments",
            json={"name": "Simulation FX"},
        )
    ).json()
    assert added_dept["folder_name"] == "Simulation_FX"
    assert added_dept["default_tasks"][0]["name"] == "main"

    new_dt = (
        await client.post(
            f"/api/v1/projects/{proj_uuid}/departments/{added_dept['id']}/default-tasks",
            json={"name": "pyro sim"},
        )
    ).json()
    assert new_dt["folder_name"] == "pyro_sim"

    # Reorder departments reverse
    all_ids = [d["id"] for d in depts] + [added_dept["id"]]
    reordered = (
        await client.put(
            f"/api/v1/projects/{proj_uuid}/departments/reorder",
            json={"ids": list(reversed(all_ids))},
        )
    ).json()
    assert reordered[0]["id"] == added_dept["id"]

    # Delete custom default task & deactivate department
    assert (
        await client.delete(
            f"/api/v1/projects/{proj_uuid}/departments/default-tasks/{new_dt['id']}"
        )
    ).status_code == 204

    # 3. Reconcile service: external entity, plain folder, external v0002, rename, missing
    prod = custom_root / "01_Production"
    (prod / "staging_plain_folder").mkdir()

    ent_uuid = str(uuid.uuid4())
    ent_dir = prod / "mech_arm"
    v1_dir = ent_dir / "Modeling" / "main" / "products" / "v0001"
    v1_dir.mkdir(parents=True)
    (ent_dir / ".entity.json").write_text(
        json.dumps({"uuid": ent_uuid, "schema_version": 2}), encoding="utf-8"
    )
    Image.new("RGB", (16, 16), (90, 100, 120)).save(v1_dir / "turntable_v1.png")

    rep1 = (await client.post(f"/api/v1/projects/{proj_uuid}/reconcile")).json()
    assert rep1["entities_created"] == 1
    assert rep1["versions_registered"] == 1
    assert rep1["files_scanned"] == 1
    assert "staging_plain_folder" in rep1["plain_folders"]

    # Drop v0002 externally & move/rename entity directory while keeping .entity.json UUID
    renamed_dir = prod / "staging_plain_folder" / "mech_arm_v2"
    shutil.move(str(ent_dir), str(renamed_dir))
    v2_dir = renamed_dir / "Modeling" / "main" / "products" / "v0002"
    v2_dir.mkdir(parents=True)
    Image.new("RGB", (16, 16), (200, 90, 90)).save(v2_dir / "turntable_v2.png")

    rep2 = (await client.post(f"/api/v1/projects/{proj_uuid}/reconcile")).json()
    assert rep2["entities_updated"] == 1
    assert rep2["versions_registered"] == 1
    tree = (await client.get(f"/api/v1/projects/{proj_uuid}/entities")).json()
    assert len(tree["entities"]) == 1
    assert tree["entities"][0]["id"] == ent_uuid
    assert tree["entities"][0]["rel_path"] == "staging_plain_folder/mech_arm_v2"

    # Remove entity directory externally -> marked is_missing=True, never deleted from DB
    shutil.rmtree(renamed_dir)
    rep3 = (await client.post(f"/api/v1/projects/{proj_uuid}/reconcile")).json()
    assert rep3["entities_missing"] == 1
    tree_after = (await client.get(f"/api/v1/projects/{proj_uuid}/entities")).json()
    assert tree_after["entities"][0]["is_missing"] is True

    # 4. fs/browse and launchers
    fs_resp = await client.get("/api/v1/fs/browse", params={"path": str(custom_root)})
    assert fs_resp.status_code == 200
    assert any(d["name"] == "01_Production" for d in fs_resp.json()["directories"])

    auto_resp = await client.post("/api/v1/launchers/autodetect")
    assert auto_resp.status_code == 200
    put_resp = await client.put(
        "/api/v1/launchers",
        json={
            "launchers": [
                {
                    "extension": "blend",
                    "label": "Blender",
                    "executable_path": "C:/Apps/blender.exe",
                    "args_template": "{file}",
                    "is_default": True,
                }
            ]
        },
    )
    assert put_resp.status_code == 200
    assert put_resp.json()[0]["extension"] == ".blend"

    # 5. Switch back to initial_uuid admin session, forget project without deleting disk files
    await login_client(client, initial_uuid, "admin", TEST_ADMIN_PASSWORD)
    assert (await client.delete(f"/api/v1/projects/{proj_uuid}")).status_code == 204
    assert (custom_root / "00_Pipeline" / "project.json").is_file()

    # Open forgotten project back via POST /projects/open
    reopened = await client.post("/api/v1/projects/open", json={"path": str(custom_root)})
    assert reopened.status_code == 200
    assert reopened.json()["uuid"] == proj_uuid
