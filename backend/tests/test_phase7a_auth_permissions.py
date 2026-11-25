from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.core.settings import Settings
from app.main import create_app
from app.services.auth_service import reset_lockouts
from tests.conftest import (
    TEST_ADMIN_PASSWORD,
    attach_csrf_hook,
    login_client,
    make_entity_product_dir,
)

STRONG_PW = "Str0ngPass!2026"


async def _new_authed_client(
    app: object, project_uuid: str, username: str, password: str
) -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")  # type: ignore[arg-type]
    await c.__aenter__()
    attach_csrf_hook(c)
    await login_client(c, project_uuid, username, password)
    return c


@pytest.mark.asyncio
async def test_startup_refuses_non_loopback_with_initial_password(tmp_path: Path) -> None:
    reset_lockouts()
    app_db = tmp_path / "app.db"
    proj_root = tmp_path / "proj_sec"

    # Bootstrap on loopback first (creates project with admin having initial password)
    loopback_cfg = Settings(
        app_db_url=f"sqlite+aiosqlite:///{app_db.as_posix()}",
        demo_project_path=tmp_path / "absent",
        auto_scan_on_startup=False,
        bind_host="127.0.0.1",
    )
    app1 = create_app(loopback_cfg)
    async with (
        app1.router.lifespan_context(app1),
        AsyncClient(transport=ASGITransport(app=app1), base_url="http://test") as client,
    ):
        attach_csrf_hook(client)
        r = await client.post("/api/v1/projects", json={"path": str(proj_root), "name": "SecProj"})
        assert r.status_code == 201
        proj_uuid = str(r.json()["uuid"])

    # Starting on non-loopback while admin still has initial password must raise
    lan_cfg = Settings(
        app_db_url=f"sqlite+aiosqlite:///{app_db.as_posix()}",
        demo_project_path=tmp_path / "absent",
        auto_scan_on_startup=False,
        bind_host="0.0.0.0",
    )
    app2 = create_app(lan_cfg)
    with pytest.raises(RuntimeError, match="initial password"):
        async with app2.router.lifespan_context(app2):
            pass

    # After changing initial password on loopback, non-loopback start succeeds
    app3 = create_app(loopback_cfg)
    async with (
        app3.router.lifespan_context(app3),
        AsyncClient(transport=ASGITransport(app=app3), base_url="http://test") as client,
    ):
        attach_csrf_hook(client)
        await login_client(client, proj_uuid, "admin", loopback_cfg.initial_admin_password)
        ch = await client.post(
            f"/api/v1/projects/{proj_uuid}/auth/change-password",
            json={
                "current_password": loopback_cfg.initial_admin_password,
                "new_password": TEST_ADMIN_PASSWORD,
            },
        )
        assert ch.status_code == 200

    app4 = create_app(lan_cfg)
    async with app4.router.lifespan_context(app4):
        pass


@pytest.mark.asyncio
async def test_auth_policy_lockout_csrf_origin_session_rotation(
    test_app: tuple[object, AsyncClient, str, Path],
    tmp_path: Path,
) -> None:
    app, admin_client, proj_uuid, _ = test_app

    # 1. Second project creation requires admin (unauthenticated -> 401)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:  # type: ignore[arg-type]
        r_proj = await anon.post(
            "/api/v1/projects", json={"path": str(tmp_path / "p2"), "name": "Second"}
        )
        assert r_proj.status_code == 401
        assert (await anon.get(f"/api/v1/projects/{proj_uuid}/entities")).status_code == 401
        assert (await anon.get("/healthz")).status_code == 200

    # 2. Check password policy rejects weak / username / common passwords
    roles = {
        r["name"]: r["id"]
        for r in (await admin_client.get(f"/api/v1/projects/{proj_uuid}/roles")).json()
    }
    for bad_pw in ("short", "artist_tester", "password123"):
        bad_u = await admin_client.post(
            f"/api/v1/projects/{proj_uuid}/users",
            json={
                "username": "artist_tester",
                "full_name": "Tester",
                "password": bad_pw,
                "role_id": roles["artist"],
                "must_change_password": False,
            },
        )
        assert bad_u.status_code == 400

    ok_u = await admin_client.post(
        f"/api/v1/projects/{proj_uuid}/users",
        json={
            "username": "tester_must_change",
            "full_name": "Must Change",
            "password": STRONG_PW,
            "role_id": roles["artist"],
            "must_change_password": True,
        },
    )
    assert ok_u.status_code == 201

    # 3. Forced password change blocks protected routes until completed, and rotates session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as mc:  # type: ignore[arg-type]
        attach_csrf_hook(mc)
        login_res = await login_client(mc, proj_uuid, "tester_must_change", STRONG_PW)
        assert login_res["user"]["must_change_password"] is True
        old_cookie = mc.cookies.get("organum_session")
        blocked = await mc.get(f"/api/v1/projects/{proj_uuid}/entities")
        assert blocked.status_code == 403

        ch = await mc.post(
            f"/api/v1/projects/{proj_uuid}/auth/change-password",
            json={"current_password": STRONG_PW, "new_password": "BrandNewPassword#99"},
        )
        assert ch.status_code == 200
        assert ch.json()["user"]["must_change_password"] is False
        assert mc.cookies.get("organum_session") != old_cookie
        assert (await mc.get(f"/api/v1/projects/{proj_uuid}/entities")).status_code == 200

        # Old session cookie was revoked on password change
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as stale:  # type: ignore[arg-type]
            stale.cookies.set("organum_session", str(old_cookie))
            assert (await stale.get(f"/api/v1/projects/{proj_uuid}/entities")).status_code == 401

        # Logout revokes current session
        assert (await mc.post(f"/api/v1/projects/{proj_uuid}/auth/logout")).status_code == 204
        assert (await mc.get(f"/api/v1/projects/{proj_uuid}/entities")).status_code == 401

    # 4. CSRF & Origin enforcement
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as no_csrf:  # type: ignore[arg-type]
        await login_client(no_csrf, proj_uuid, "tester_must_change", "BrandNewPassword#99")
        # Mutating call WITHOUT X-CSRF-Token -> 403
        bad_csrf = await no_csrf.post(f"/api/v1/projects/{proj_uuid}/reconcile")
        assert bad_csrf.status_code == 403
        # Cross-origin rejected -> 403
        attach_csrf_hook(no_csrf)
        bad_origin = await no_csrf.post(
            f"/api/v1/projects/{proj_uuid}/reconcile",
            headers={"Origin": "https://evil.example"},
        )
        assert bad_origin.status_code == 403

    # 5. Brute force lockout: 5 failures -> 6th blocked even with right password
    reset_lockouts()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as bf:  # type: ignore[arg-type]
        for _ in range(5):
            r = await bf.post(
                f"/api/v1/projects/{proj_uuid}/auth/login",
                json={
                    "project_uuid": proj_uuid,
                    "username": "tester_must_change",
                    "password": "WrongPassword123",
                },
            )
            assert r.status_code == 401
        r_locked = await bf.post(
            f"/api/v1/projects/{proj_uuid}/auth/login",
            json={
                "project_uuid": proj_uuid,
                "username": "tester_must_change",
                "password": "BrandNewPassword#99",
            },
        )
        assert r_locked.status_code == 401
        assert "Invalid credentials" in r_locked.json()["error"]["message"]
    reset_lockouts()

    # 6. Audit log has login/failure/password change events
    audit = (await admin_client.get(f"/api/v1/projects/{proj_uuid}/admin/audit")).json()
    actions = {a["action"] for a in audit}
    assert {"auth.login", "auth.login_failed", "auth.password_changed", "user.created"}.issubset(
        actions
    )


@pytest.mark.asyncio
async def test_roles_capacities_director_external_client_isolation_and_archive(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    app, admin_client, proj_uuid, prod_root = test_app
    base = f"/api/v1/projects/{proj_uuid}"

    # Reuse seeded starter departments (create if absent)
    existing_depts = {d["name"]: d for d in (await admin_client.get(f"{base}/departments")).json()}
    d_mod = (
        existing_depts.get("Modeling")
        or (await admin_client.post(f"{base}/departments", json={"name": "Modeling"})).json()
    )
    d_lgt = (
        existing_depts.get("Lighting")
        or (await admin_client.post(f"{base}/departments", json={"name": "Lighting"})).json()
    )
    d_fx = (
        existing_depts.get("FX")
        or (await admin_client.post(f"{base}/departments", json={"name": "FX"})).json()
    )

    v_mod = make_entity_product_dir(prod_root, "hero", "Modeling", "main", "v0001")
    v_lgt = make_entity_product_dir(prod_root, "hero", "Lighting", "beauty", "v0001")
    v_fx = make_entity_product_dir(prod_root, "hero", "FX", "sim", "v0001")
    Image.new("RGB", (32, 32), (20, 40, 80)).save(v_mod / "mod_render.png")
    Image.new("RGB", (32, 32), (80, 40, 20)).save(v_lgt / "lgt_render.png")
    Image.new("RGB", (32, 32), (20, 80, 40)).save(v_fx / "fx_render.png")
    (prod_root / "hero" / "Modeling" / "main" / "scenefiles").mkdir(parents=True, exist_ok=True)
    (prod_root / "hero" / "Modeling" / "main" / "scenefiles" / "hero.hip").write_text("hip")

    await admin_client.post(f"{base}/reconcile")
    tree = (await admin_client.get(f"{base}/entities")).json()
    hero = tree["entities"][0]
    tasks_by_dept: dict[str, dict[str, Any]] = {}
    for ed in hero["departments"]:
        for t in ed["tasks"]:
            tasks_by_dept[ed["name"]] = t

    mod_task = tasks_by_dept["Modeling"]
    lgt_task = tasks_by_dept["Lighting"]
    fx_task = tasks_by_dept["FX"]
    mod_file = mod_task["product"]["versions"][0]["files"][0]
    lgt_ver = lgt_task["product"]["versions"][0]
    lgt_file = lgt_ver["files"][0]
    fx_file = fx_task["product"]["versions"][0]["files"][0]

    # Seed companies
    c_int = (
        await admin_client.post(
            f"{base}/companies",
            json={
                "name": "Internal",
                "short_code": "INT",
                "kind": "internal",
                "department_ids": [d_mod["id"], d_lgt["id"]],
            },
        )
    ).json()
    c_fx = (
        await admin_client.post(
            f"{base}/companies",
            json={
                "name": "FX Vendor",
                "short_code": "FXV",
                "kind": "external",
                "department_ids": [d_fx["id"]],
            },
        )
    ).json()
    c_cli = (
        await admin_client.post(
            f"{base}/companies",
            json={
                "name": "Acme Client",
                "short_code": "ACM",
                "kind": "external",
            },
        )
    ).json()

    roles = {r["name"]: r["id"] for r in (await admin_client.get(f"{base}/roles")).json()}

    async def _mk_user(uname: str, rname: str, cid: str | None, depts: list[str]) -> dict[str, Any]:
        r = await admin_client.post(
            f"{base}/users",
            json={
                "username": uname,
                "full_name": uname.title(),
                "password": STRONG_PW,
                "role_id": roles[rname],
                "company_id": cid,
                "department_ids": depts,
                "must_change_password": False,
            },
        )
        assert r.status_code == 201, r.text
        return dict(r.json())

    u_prod = await _mk_user("prod_user", "producer", c_int["id"], [d_mod["id"], d_lgt["id"]])
    u_dir = await _mk_user("dir_user", "director", c_int["id"], [d_lgt["id"]])
    u_art = await _mk_user("art_user", "artist", c_int["id"], [d_mod["id"]])
    await _mk_user("ext_user", "external", c_fx["id"], [d_fx["id"]])
    await _mk_user("cli_user", "client", c_cli["id"], [])

    # Assign director as supervisor on Lighting task ONLY; artist on Modeling ONLY
    assert (
        await admin_client.put(
            f"{base}/tasks/{lgt_task['id']}/assignments",
            json={"assignments": [{"user_id": u_dir["id"], "assignment_role": "supervisor"}]},
        )
    ).status_code == 200
    assert (
        await admin_client.put(
            f"{base}/tasks/{mod_task['id']}/assignments",
            json={"assignments": [{"user_id": u_art["id"], "assignment_role": "artist"}]},
        )
    ).status_code == 200

    # Share Lighting version v0001 with Acme Client
    assert (
        await admin_client.put(
            f"{base}/versions/{lgt_ver['id']}/shares",
            json={"company_ids": [c_cli["id"]]},
        )
    ).status_code == 200

    prod_c = await _new_authed_client(app, proj_uuid, "prod_user", STRONG_PW)
    dir_c = await _new_authed_client(app, proj_uuid, "dir_user", STRONG_PW)
    art_c = await _new_authed_client(app, proj_uuid, "art_user", STRONG_PW)
    ext_c = await _new_authed_client(app, proj_uuid, "ext_user", STRONG_PW)
    cli_c = await _new_authed_client(app, proj_uuid, "cli_user", STRONG_PW)

    try:
        # 1. Producer cannot create admin or edit role matrix; director has approve.* for all stages
        assert (
            await prod_c.post(
                f"{base}/users",
                json={
                    "username": "rogue_admin",
                    "full_name": "Rogue",
                    "password": STRONG_PW,
                    "role_id": roles["admin"],
                    "must_change_password": False,
                },
            )
        ).status_code == 403
        assert (
            await prod_c.put(
                f"{base}/roles/{roles['artist']}/permissions",
                json={"permissions": {"user.manage": "all"}},
            )
        ).status_code == 403
        assert u_prod["role_label"] == "Production"

        dir_me = (await dir_c.get(f"{base}/auth/me")).json()
        assert dir_me["permissions"]["task.approve.lead"] == "all"
        assert dir_me["permissions"]["task.approve.sup"] == "all"
        assert dir_me["permissions"]["task.approve.client"] == "all"

        # 2. Capacity resolution for Director: cannot edit unassigned Modeling task, CAN edit
        # assigned supervisor Lighting task (acted_as == 'capacity:supervisor')
        assert (
            await dir_c.patch(f"{base}/tasks/{mod_task['id']}", json={"sort_order": 5})
        ).status_code == 403
        ok_sup = await dir_c.patch(f"{base}/tasks/{lgt_task['id']}", json={"sort_order": 5})
        assert ok_sup.status_code == 200
        assert ok_sup.json()["acted_as"] == "capacity:supervisor"

        # 3. External isolation: sees FX, blocked on Modeling & launch
        assert (await ext_c.get(f"{base}/files/{fx_file['id']}/content")).status_code == 200
        assert (await ext_c.get(f"{base}/files/{mod_file['id']}/content")).status_code == 403
        assert (await ext_c.get(f"{base}/tasks/{mod_task['id']}/scenefiles")).status_code == 403
        assert (
            await ext_c.post(
                f"{base}/launch", json={"rel_path": "hero/Modeling/main/scenefiles/hero.hip"}
            )
        ).status_code == 403

        # 4. Client isolation (§15): unshared assets return 404 (not 403)
        assert (await cli_c.get(f"{base}/tasks/{mod_task['id']}/product")).status_code == 404
        assert (await cli_c.get(f"{base}/files/{mod_file['id']}/content")).status_code == 404
        assert (
            await cli_c.get(
                f"{base}/files/{mod_file['id']}/content", headers={"Range": "bytes=0-15"}
            )
        ).status_code == 404
        assert (await cli_c.get(f"{base}/files/{mod_file['id']}/inspect")).status_code == 404
        assert (await cli_c.get(f"{base}/files/{mod_file['id']}/thumbnail")).status_code == 404
        assert (await cli_c.get(f"{base}/files/{mod_file['id']}/annotations")).status_code == 404
        assert (await cli_c.get(f"{base}/tasks/{lgt_task['id']}/scenefiles")).status_code == 404
        assert (
            await cli_c.patch(f"{base}/tasks/{lgt_task['id']}", json={"name": "hacked"})
        ).status_code == 403

        # Client shared entity tree uses allowlist serializer (no internal fields)
        cli_tree = (await cli_c.get(f"{base}/entities")).json()
        assert "plain_folders" not in cli_tree
        assert len(cli_tree["entities"]) == 1
        assert len(cli_tree["entities"][0]["departments"]) == 1
        assert cli_tree["entities"][0]["departments"][0]["name"] == "Lighting"
        assert (await cli_c.get(f"{base}/files/{lgt_file['id']}/content")).status_code == 200

        # 5. Confirmed client comment visibility rule:
        # Clients write client-visible annotations; ONLY client, producer, director, admin see them!
        # Artists CANNOT see client comments, and clients CANNOT see internal comments.
        art_unassigned_comment = await art_c.post(
            f"{base}/files/{lgt_file['id']}/annotations",
            json={"kind": "2d", "note_text": "Artist unassigned denied"},
        )
        assert art_unassigned_comment.status_code == 403
        r_internal = await prod_c.post(
            f"{base}/files/{lgt_file['id']}/annotations",
            json={"kind": "2d", "note_text": "Internal studio shader note"},
        )
        assert r_internal.status_code == 201
        r_client = await cli_c.post(
            f"{base}/files/{lgt_file['id']}/annotations",
            json={"kind": "2d", "note_text": "Client wants warmer key", "visibility": "internal"},
        )
        assert r_client.status_code == 201
        assert r_client.json()["visibility"] == "client"  # forced for client role

        # Client sees ONLY client note
        cli_anns = (await cli_c.get(f"{base}/files/{lgt_file['id']}/annotations")).json()
        assert [a["note_text"] for a in cli_anns] == ["Client wants warmer key"]
        # Artist sees ONLY internal note (CANNOT see client comment)
        art_anns = (await art_c.get(f"{base}/files/{lgt_file['id']}/annotations")).json()
        assert [a["note_text"] for a in art_anns] == ["Internal studio shader note"]
        # Producer, Director, Admin see BOTH
        for priv_c in (prod_c, dir_c, admin_client):
            priv_anns = (await priv_c.get(f"{base}/files/{lgt_file['id']}/annotations")).json()
            assert len(priv_anns) == 2

        # 6. Archived project refuses all writes for non-admins, admin can still write & unarchive
        arch = await admin_client.patch(f"{base}/project/settings", json={"status": "archived"})
        assert arch.status_code == 200
        assert (
            await prod_c.post(f"{base}/departments", json={"name": "BlockedDept"})
        ).status_code == 403
        assert (
            await art_c.post(
                f"{base}/files/{lgt_file['id']}/annotations",
                json={"kind": "2d", "note_text": "Blocked write"},
            )
        ).status_code == 403
        assert (
            await admin_client.patch(f"{base}/project/settings", json={"status": "active"})
        ).status_code == 200
    finally:
        for c in (prod_c, dir_c, art_c, ext_c, cli_c):
            await c.aclose()


@pytest.mark.asyncio
async def test_role_and_capacity_matrix_editing(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, admin_client, proj_uuid, _ = test_app
    base = f"/api/v1/projects/{proj_uuid}"

    caps = (await admin_client.get(f"{base}/capacities")).json()
    assert "task.approve.sup" in caps["supervisor"]
    updated = await admin_client.put(
        f"{base}/capacities",
        json={
            "artist": caps["artist"],
            "lead": caps["lead"],
            "supervisor": sorted({*caps["supervisor"], "entity.link"}),
        },
    )
    assert updated.status_code == 200
    assert "entity.link" in updated.json()["supervisor"]

    # Create custom role and edit permissions
    new_role = (
        await admin_client.post(
            f"{base}/roles",
            json={"name": "coord_custom", "label": "Coordinator Custom", "rank": 55},
        )
    ).json()
    assert new_role["is_system"] is False
    upd_rp = await admin_client.put(
        f"{base}/roles/{new_role['id']}/permissions",
        json={"permissions": {"task.view": "all", "user.view": "all"}},
    )
    assert upd_rp.status_code == 200
    assert upd_rp.json()["permissions"]["task.view"] == "all"
    assert (await admin_client.delete(f"{base}/roles/{new_role['id']}")).status_code == 204
    _ = uuid.uuid4()
