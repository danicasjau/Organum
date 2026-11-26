from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from PIL import Image

from app.services.launcher_service import build_launch_argv
from tests.conftest import authenticate_project_admin


@pytest.mark.asyncio
async def test_entity_folder_atomicity_tags_data_thumbnail_and_trash(
    test_app: tuple[object, AsyncClient, str, Path],
    tmp_path: Path,
) -> None:
    _, client, _, _ = test_app
    proj_root = tmp_path / "phase6b_show"
    create_proj = await client.post(
        "/api/v1/projects",
        json={
            "path": str(proj_root),
            "name": "Phase 6B Show",
            "starter_departments": ["Modeling", "Lookdev"],
        },
    )
    assert create_proj.status_code == 201
    proj_uuid = str(create_proj.json()["uuid"])
    await authenticate_project_admin(client, proj_uuid)
    base = f"/api/v1/projects/{proj_uuid}"

    depts = (await client.get(f"{base}/departments")).json()
    modeling_id = next(d["id"] for d in depts if d["name"] == "Modeling")
    lookdev_id = next(d["id"] for d in depts if d["name"] == "Lookdev")

    # 1. Create plain folder inside 01_Production
    f_resp = await client.post(
        f"{base}/folders",
        json={"parent_rel_path": "", "name": "chars"},
    )
    assert f_resp.status_code == 201
    assert f_resp.json()["rel_path"] == "chars"
    assert (proj_root / "01_Production" / "chars").is_dir()

    # 2. Create entity with space sanitization, NO entity_type default, tags, departments
    ent_resp = await client.post(
        f"{base}/entities",
        json={
            "name": "Hero Mech",
            "parent_rel_path": "chars",
            "tags": ["hero", "mech", "hero"],
            "department_ids": [modeling_id],
        },
    )
    assert ent_resp.status_code == 201
    ent = ent_resp.json()
    assert ent["folder_name"] == "Hero_Mech"
    assert ent["rel_path"] == "chars/Hero_Mech"
    assert ent["entity_type"] is None
    assert ent["tags"] == ["hero", "mech"]
    ent_dir = proj_root / "01_Production" / "chars" / "Hero_Mech"
    assert (ent_dir / ".entity.json").is_file()
    assert (ent_dir / "Modeling" / "main" / "products").is_dir()
    assert (ent_dir / "Modeling" / "main" / "scenefiles").is_dir()

    # Reject nesting entity inside an existing entity
    nested_resp = await client.post(
        f"{base}/entities",
        json={"name": "SubPart", "parent_rel_path": "chars/Hero_Mech", "department_ids": []},
    )
    assert nested_resp.status_code == 409

    # Reject duplicate sibling case-insensitively
    dup_resp = await client.post(
        f"{base}/entities",
        json={"name": "hero mech", "parent_rel_path": "chars", "department_ids": []},
    )
    assert dup_resp.status_code == 409

    # 3. Promote a plain folder into an entity
    (proj_root / "01_Production" / "loose_prop").mkdir(parents=True)
    prom = await client.post(f"{base}/folders/promote", json={"rel_path": "loose_prop"})
    assert prom.status_code == 200
    assert (proj_root / "01_Production" / "loose_prop" / ".entity.json").is_file()

    # 4. Rename entity + edit entity_type & typed entity_data
    upd = await client.patch(
        f"{base}/entities/{ent['id']}",
        json={"name": "Hero Mech Prime", "entity_type": "Character", "description": "Lead asset"},
    )
    assert upd.status_code == 200
    assert upd.json()["rel_path"] == "chars/Hero_Mech_Prime"
    assert (proj_root / "01_Production" / "chars" / "Hero_Mech_Prime" / ".entity.json").is_file()
    assert not ent_dir.exists()

    put_data = await client.put(
        f"{base}/entities/{ent['id']}/data",
        json={
            "items": [
                {"key": "lod_count", "value_type": "int", "value_text": "3"},
                {"key": "height_m", "value_type": "float", "value_text": "2.4"},
                {"key": "turntable_ok", "value_type": "bool", "value_text": "true"},
            ]
        },
    )
    assert put_data.status_code == 200
    got_data = (await client.get(f"{base}/entities/{ent['id']}/data")).json()
    assert [row["key"] for row in got_data] == ["height_m", "lod_count", "turntable_ok"]

    # 5. Attach & detach department (detach preserves disk directory per CR02 §5)
    attached = await client.post(
        f"{base}/entities/{ent['id']}/departments",
        json={"department_id": lookdev_id},
    )
    assert attached.status_code == 201
    ed_id = attached.json()["id"]
    lookdev_dir = proj_root / "01_Production" / "chars" / "Hero_Mech_Prime" / "Lookdev"
    assert lookdev_dir.is_dir()
    renamed_dept = await client.patch(
        f"{base}/departments/{lookdev_id}",
        json={"name": "Look Development"},
    )
    assert renamed_dept.status_code == 200, renamed_dept.text
    renamed_lookdev_dir = (
        proj_root / "01_Production" / "chars" / "Hero_Mech_Prime" / "Look_Development"
    )
    assert not lookdev_dir.exists()
    assert (renamed_lookdev_dir / "main" / "products").is_dir()

    task_id = attached.json()["tasks"][0]["id"]
    renamed_task = await client.patch(
        f"{base}/tasks/{task_id}",
        json={"name": "beauty pass"},
    )
    assert renamed_task.status_code == 200, renamed_task.text
    assert renamed_task.json()["name"] == "beauty_pass"
    assert renamed_task.json()["product"]["name"] == "Look_Development/beauty_pass"
    assert not (renamed_lookdev_dir / "main").exists()
    assert (renamed_lookdev_dir / "beauty_pass" / "products").is_dir()

    custom_dept_response = await client.post(
        f"{base}/departments",
        json={"name": "Custom Department"},
    )
    assert custom_dept_response.status_code == 201, custom_dept_response.text
    custom_dept = custom_dept_response.json()
    other_entity_response = await client.post(
        f"{base}/entities",
        json={"name": "Other Asset", "parent_rel_path": "chars", "department_ids": []},
    )
    assert other_entity_response.status_code == 201, other_entity_response.text
    other_entity = other_entity_response.json()
    custom_task_response = await client.post(
        f"{base}/tasks",
        json={
            "entity_id": ent["id"],
            "department_id": custom_dept["id"],
            "name": "custom work",
            "priority": "normal",
        },
    )
    assert custom_task_response.status_code == 201, custom_task_response.text
    current_entities = (await client.get(f"{base}/entities")).json()["entities"]
    entity_departments = {
        row["id"]: {department["name"] for department in row["departments"]}
        for row in current_entities
    }
    assert "Custom Department" in entity_departments[ent["id"]]
    assert "Custom Department" not in entity_departments[other_entity["id"]]

    detached = await client.delete(f"{base}/entity-departments/{ed_id}")
    assert detached.status_code == 204
    assert renamed_lookdev_dir.is_dir()

    # 6. Soft-delete entity moves folder to 00_Pipeline/trash/
    del_ent = await client.delete(f"{base}/entities/{ent['id']}")
    assert del_ent.status_code == 204
    assert not (proj_root / "01_Production" / "chars" / "Hero_Mech_Prime").exists()
    trash_items = list((proj_root / "00_Pipeline" / "trash").iterdir())
    assert any("Hero_Mech_Prime" in p.name for p in trash_items)

    # Re-creating an entity with the same rel_path after trashing must succeed (rel_path freed)
    recreate = await client.post(
        f"{base}/entities",
        json={"name": "Hero Mech Prime", "parent_rel_path": "chars", "department_ids": []},
    )
    assert recreate.status_code == 201
    assert (await client.delete(f"{base}/entities/{recreate.json()['id']}")).status_code == 204


@pytest.mark.asyncio
async def test_publish_concurrency_master_star_scenefiles_and_sequence_override(
    test_app: tuple[object, AsyncClient, str, Path],
    tmp_path: Path,
) -> None:
    _, client, _, _ = test_app
    proj_root = tmp_path / "publish_show"
    create_proj = await client.post(
        "/api/v1/projects",
        json={
            "path": str(proj_root),
            "name": "Publish Show",
            "starter_departments": ["Lighting"],
        },
    )
    proj_uuid = str(create_proj.json()["uuid"])
    await authenticate_project_admin(client, proj_uuid)
    base = f"/api/v1/projects/{proj_uuid}"

    depts = (await client.get(f"{base}/departments")).json()
    lighting_id = depts[0]["id"]
    ent = (
        await client.post(
            f"{base}/entities",
            json={"name": "Shot010", "department_ids": [lighting_id]},
        )
    ).json()
    ed_id = ent["departments"][0]["id"]
    task = (
        await client.post(f"{base}/entity-departments/{ed_id}/tasks", json={"name": "beauty"})
    ).json()
    task_id = task["id"]

    # Create scenefile assets (mkdir + upload PNGs)
    mk = await client.post(
        f"{base}/tasks/{task_id}/scenefiles/mkdir",
        json={"path": "", "name": "renders"},
    )
    assert mk.status_code == 201

    png_path = tmp_path / "beauty.png"
    Image.new("RGB", (32, 32), (100, 140, 200)).save(png_path)
    up = await client.post(
        f"{base}/tasks/{task_id}/scenefiles/upload",
        data={"path": "renders"},
        files=[("files", ("beauty.png", png_path.read_bytes(), "image/png"))],
    )
    assert up.status_code == 201

    listed = (await client.get(f"{base}/tasks/{task_id}/scenefiles?path=renders")).json()
    assert len(listed["entries"]) == 1
    assert listed["entries"][0]["is_image"] is True
    assert listed["entries"][0]["thumb_url"] is not None

    # Live thumbnail & inspect work for scenefiles
    thumb_resp = await client.get(listed["entries"][0]["thumb_url"])
    assert thumb_resp.status_code == 200
    insp_resp = await client.get(
        f"{base}/tasks/{task_id}/scenefiles/inspect?path=renders/beauty.png"
    )
    assert insp_resp.status_code == 200

    # Publish v0001 from scenefile -> source stays intact & v0001 is auto-starred (Decision #8)
    pub1 = await client.post(
        f"{base}/tasks/{task_id}/publish",
        json={"scenefile_rel_paths": ["renders/beauty.png"], "comment": "Initial look"},
    )
    assert pub1.status_code == 201
    v1 = pub1.json()
    assert v1["label"] == "v0001"
    assert (
        proj_root
        / "01_Production"
        / "Shot010"
        / "Lighting"
        / "beauty"
        / "scenefiles"
        / "renders"
        / "beauty.png"
    ).is_file()

    prod_after_v1 = (await client.get(f"{base}/tasks/{task_id}/product")).json()
    assert prod_after_v1["master_version_id"] == v1["id"]
    master_json = (
        proj_root / "01_Production" / "Shot010" / "Lighting" / "beauty" / "products" / "master.json"
    )
    assert json.loads(master_json.read_text(encoding="utf-8"))["version"] == "v0001"

    # Auto thumbnail resolves to v0001 beauty.png
    ent_thumb = await client.get(f"{base}/entities/{ent['id']}/thumbnail")
    assert ent_thumb.status_code == 200

    # Concurrent publishing allocates unique version numbers cleanly
    pub_results = await asyncio.gather(
        client.post(
            f"{base}/tasks/{task_id}/publish",
            json={"scenefile_rel_paths": ["renders/beauty.png"], "comment": "Batch A"},
        ),
        client.post(
            f"{base}/tasks/{task_id}/publish",
            json={"scenefile_rel_paths": ["renders/beauty.png"], "comment": "Batch B"},
        ),
    )
    assert all(r.status_code == 201 for r in pub_results)
    labels = sorted(r.json()["label"] for r in pub_results)
    assert labels == ["v0002", "v0003"]

    # Master stays on v0001 until user explicitly stars v0002 (Decision #8)
    prod_mid = (await client.get(f"{base}/tasks/{task_id}/product")).json()
    assert prod_mid["master_version_id"] == v1["id"]
    v2_id = next(v["id"] for v in prod_mid["versions"] if v["label"] == "v0002")

    star_resp = await client.put(
        f"{base}/products/{prod_mid['id']}/master",
        json={"version_id": v2_id},
    )
    assert star_resp.status_code == 200
    assert star_resp.json()["master_version_id"] == v2_id
    assert json.loads(master_json.read_text(encoding="utf-8"))["version"] == "v0002"

    # Sequence per-file override persists via PATCH /files/{id} (Decision #6)
    file_id = v1["files"][0]["id"]
    patched_file = await client.patch(
        f"{base}/files/{file_id}",
        json={"sequence_kind": "udim", "sequence_kind_user_override": True},
    )
    assert patched_file.status_code == 200
    assert patched_file.json()["sequence_kind"] == "udim"
    assert patched_file.json()["sequence_kind_user_override"] is True

    # Soft delete v0002 clears master_version_id and removes master.json
    del_v2 = await client.delete(f"{base}/versions/{v2_id}")
    assert del_v2.status_code == 204
    assert not master_json.exists()
    assert any("v0002" in p.name for p in (proj_root / "00_Pipeline" / "trash").iterdir())

    # Scenefile path traversal blocked cleanly
    bad_scene = await client.get(f"{base}/tasks/{task_id}/scenefiles?path=../../00_Pipeline")
    assert bad_scene.status_code == 400


@pytest.mark.asyncio
async def test_launcher_security_traversal_argv_and_non_loopback_disabled(
    test_app: tuple[object, AsyncClient, str, Path],
    tmp_path: Path,
) -> None:
    app, client, proj_uuid, prod_root = test_app

    # 1. Path traversal rejected (400)
    trav = await client.post(
        f"/api/v1/projects/{proj_uuid}/launch",
        json={"rel_path": "../../outside.hip"},
    )
    assert trav.status_code == 400

    # 2. Argument injection check: build_launch_argv keeps filenames as single argv elements
    tricky = tmp_path / "shot && calc.exe"
    argv = build_launch_argv("/usr/bin/houdini", "{file}", tricky)
    assert argv == ["/usr/bin/houdini", str(tricky)]

    # 3. Non-loopback Origin rejected (403)
    bad_origin = await client.post(
        f"/api/v1/projects/{proj_uuid}/reveal",
        json={"rel_path": "01_Production/hero_robot"},
        headers={"Origin": "https://evil.example.com"},
    )
    assert bad_origin.status_code == 403

    # 4. Non-loopback bind_host disables launching (403)
    settings = app.state.settings  # type: ignore[attr-defined]
    old_host = settings.bind_host
    settings.bind_host = "0.0.0.0"
    try:
        resp = await client.post(
            f"/api/v1/projects/{proj_uuid}/reveal",
            json={"rel_path": "01_Production/hero_robot"},
        )
        assert resp.status_code == 403
    finally:
        settings.bind_host = old_host

    # 5. Valid loopback launch using configured harmless executable (python -V style)
    sample_file = prod_root / "hero_robot" / "Modeling" / "main" / "scenefiles" / "test_arg.py"
    sample_file.parent.mkdir(parents=True, exist_ok=True)
    sample_file.write_text("print('ok')\n", encoding="utf-8")
    lid = str(uuid.uuid4())
    await client.put(
        "/api/v1/launchers",
        json={
            "launchers": [
                {
                    "id": lid,
                    "extension": ".py",
                    "label": "Python",
                    "executable_path": sys.executable,
                    "args_template": "{file}",
                    "is_default": True,
                }
            ]
        },
    )
    ok_launch = await client.post(
        f"/api/v1/projects/{proj_uuid}/launch",
        json={
            "rel_path": "hero_robot/Modeling/main/scenefiles/test_arg.py",
            "launcher_id": lid,
        },
    )
    assert ok_launch.status_code == 200
    assert ok_launch.json()["launched"] is True
