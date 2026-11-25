from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.core.settings import Settings
from app.main import create_app
from app.models.project_db import (
    Department,
    Entity,
    EntityDepartment,
    Task,
)
from app.services.auth_service import reset_lockouts
from tests.conftest import (
    TEST_ADMIN_PASSWORD,
    attach_csrf_hook,
    login_client,
)

USER_PW = "Phase7bPass!2026"


async def _authed(app: object, proj_uuid: str, username: str, password: str) -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")  # type: ignore[arg-type]
    await c.__aenter__()
    attach_csrf_hook(c)
    await login_client(c, proj_uuid, username, password)
    return c


async def _setup_phase7b_project(
    tmp_path: Path,
) -> tuple[
    object,
    str,
    Path,
    AsyncClient,
    dict[str, dict[str, str]],
]:
    """Bootstrap project, seed companies/users/entities for Phase 7B tests."""
    reset_lockouts()
    app_db = tmp_path / "app.db"
    proj_root = tmp_path / "proj_7b"
    cfg = Settings(
        app_db_url=f"sqlite+aiosqlite:///{app_db.as_posix()}",
        demo_project_path=tmp_path / "absent",
        auto_scan_on_startup=False,
    )
    app = create_app(cfg)
    await app.router.lifespan_context(app).__aenter__()  # type: ignore[attr-defined]

    admin = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")  # type: ignore[arg-type]
    await admin.__aenter__()
    attach_csrf_hook(admin)

    res = await admin.post(
        "/api/v1/projects",
        json={
            "path": str(proj_root),
            "name": "Phase7BShow",
            "starter_departments": ["Modeling", "Rigging", "Lookdev", "Lighting"],
        },
    )
    assert res.status_code == 201
    proj_uuid = str(res.json()["uuid"])
    await login_client(admin, proj_uuid, "admin", cfg.initial_admin_password)
    cp = await admin.post(
        f"/api/v1/projects/{proj_uuid}/auth/change-password",
        json={"current_password": cfg.initial_admin_password, "new_password": TEST_ADMIN_PASSWORD},
    )
    assert cp.status_code == 200

    roles_list = (await admin.get(f"/api/v1/projects/{proj_uuid}/roles")).json()
    roles_by_name = {r["name"]: r["id"] for r in roles_list}
    depts_list = (await admin.get(f"/api/v1/projects/{proj_uuid}/departments")).json()
    depts_by_name = {d["name"]: d["id"] for d in depts_list}

    c_int = (
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/companies",
            json={"name": "Studio Main", "short_code": "MAIN", "kind": "internal"},
        )
    ).json()
    c_cli = (
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/companies",
            json={"name": "Client Co", "short_code": "CLI", "kind": "external"},
        )
    ).json()
    c_ext = (
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/companies",
            json={"name": "Vendor Co", "short_code": "VND", "kind": "external"},
        )
    ).json()
    await admin.put(
        f"/api/v1/projects/{proj_uuid}/companies/{c_int['id']}/departments",
        json={"department_ids": list(depts_by_name.values())},
    )
    await admin.put(
        f"/api/v1/projects/{proj_uuid}/companies/{c_ext['id']}/departments",
        json={"department_ids": [depts_by_name["Lookdev"]]},
    )

    users_created: dict[str, dict[str, str]] = {}
    for uname, rname, cid in (
        ("prod", "producer", c_int["id"]),
        ("director", "director", c_int["id"]),
        ("sup", "supervisor", c_int["id"]),
        ("lead", "lead", c_int["id"]),
        ("art", "artist", c_int["id"]),
        ("ext", "external", c_ext["id"]),
        ("cli", "client", c_cli["id"]),
    ):
        ru = await admin.post(
            f"/api/v1/projects/{proj_uuid}/users",
            json={
                "username": uname,
                "full_name": uname.title(),
                "email": f"{uname}@test.local",
                "password": USER_PW,
                "role_id": roles_by_name[rname],
                "company_id": cid,
                "must_change_password": False,
            },
        )
        assert ru.status_code == 201
        users_created[uname] = {"id": ru.json()["id"], "role": rname}

    meta_info: dict[str, dict[str, str]] = {
        "roles": roles_by_name,
        "depts": depts_by_name,
        "companies": {"int": c_int["id"], "cli": c_cli["id"], "ext": c_ext["id"]},
        "users": users_created,
    }
    return app, proj_uuid, proj_root, admin, meta_info


@pytest.mark.asyncio
async def test_phase7b_workflow_dependencies_comments_and_client_isolation(tmp_path: Path) -> None:
    app, proj_uuid, proj_root, admin, meta = await _setup_phase7b_project(tmp_path)
    prod_client = await _authed(app, proj_uuid, "prod", USER_PW)
    dir_client = await _authed(app, proj_uuid, "director", USER_PW)
    sup_client = await _authed(app, proj_uuid, "sup", USER_PW)
    lead_client = await _authed(app, proj_uuid, "lead", USER_PW)
    art_client = await _authed(app, proj_uuid, "art", USER_PW)
    cli_client = await _authed(app, proj_uuid, "cli", USER_PW)

    try:
        # 1. Create Character entity and attach Modeling + Lighting; create custom default task
        mod_id = meta["depts"]["Modeling"]
        lit_id = meta["depts"]["Lighting"]
        dt_res = await admin.post(
            f"/api/v1/projects/{proj_uuid}/departments/{mod_id}/default-tasks",
            json={
                "name": "sculpt",
                "needs_lead_review": True,
                "needs_sup_review": True,
                "needs_client_review": False,
                "default_priority": "high",
                "default_bid_hours": 16.0,
                "default_complexity": 3,
            },
        )
        assert dt_res.status_code == 201

        char_res = await admin.post(
            f"/api/v1/projects/{proj_uuid}/entities",
            json={
                "name": "char_01",
                "entity_type": "Character",
                "department_ids": [mod_id, lit_id],
            },
        )
        assert char_res.status_code == 201
        char_ent = char_res.json()
        assert (
            proj_root / "01_Production" / "char_01" / "Modeling" / "sculpt" / "products"
        ).is_dir()

        # Verify task_code, parent_entity_type, and entity_type sync
        t_list = (await admin.get(f"/api/v1/projects/{proj_uuid}/tasks")).json()
        sculpt_task = next(t for t in t_list["items"] if t["name"] == "sculpt")
        light_task = next(
            t for t in t_list["items"] if t["department_id"] == lit_id and t["name"] == "main"
        )
        assert sculpt_task["task_code"].startswith("char_01_")
        assert sculpt_task["parent_entity_type"] == "Character"
        assert sculpt_task["priority"] == "high"
        assert sculpt_task["bid_hours"] == 16.0
        assert sculpt_task["bid_days"] == 2.0

        await admin.patch(
            f"/api/v1/projects/{proj_uuid}/entities/{char_ent['id']}",
            json={"entity_type": "HeroChar"},
        )
        refetched = (
            await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}")
        ).json()
        assert refetched["parent_entity_type"] == "HeroChar"

        # 2. Assign art (DO), lead (LEAD), sup (SUP) to sculpt; director (SUP) ONLY to light_task
        await admin.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/assignments",
            json={
                "assignments": [
                    {"user_id": meta["users"]["art"]["id"], "assignment_role": "artist"},
                    {"user_id": meta["users"]["lead"]["id"], "assignment_role": "lead"},
                    {"user_id": meta["users"]["sup"]["id"], "assignment_role": "supervisor"},
                ]
            },
        )
        await admin.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/assignments",
            json={
                "assignments": [
                    {"user_id": meta["users"]["director"]["id"], "assignment_role": "supervisor"},
                    {"user_id": meta["users"]["art"]["id"], "assignment_role": "artist"},
                ]
            },
        )
        # Enable client review on light_task and share with Client Co
        await admin.patch(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}",
            json={
                "needs_lead_review": False,
                "needs_sup_review": False,
                "needs_client_review": True,
            },
        )
        await admin.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/shares",
            json={"company_ids": [meta["companies"]["cli"]]},
        )

        # Director capacity isolation test: cannot edit sculpt_task, CAN edit light_task (SUP)
        r_dir_sculpt = await dir_client.patch(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}",
            json={"description": "blocked"},
        )
        assert r_dir_sculpt.status_code == 403
        r_dir_light = await dir_client.patch(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}",
            json={"description": "director sup edit", "ideal_finish_date": "2026-12-01"},
        )
        assert r_dir_light.status_code == 200
        # Non-admin cannot change task_code; direct status PATCH rejected
        r_code = await prod_client.patch(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}",
            json={"task_code": "HACKED"},
        )
        assert r_code.status_code == 403
        r_direct_st = await admin.patch(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}",
            json={"status": "APP"},
        )
        assert r_direct_st.status_code == 400
        # Conflict detection on stale expected_updated_at
        r_stale = await admin.patch(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}",
            json={
                "description": "stale",
                "expected_updated_at": "2020-01-01T00:00:00Z",
            },
        )
        assert r_stale.status_code == 409

        # 3. Blocking dependency light_task -> depends on sculpt_task (APP), plus cycle check
        dep_denied = await sup_client.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/dependencies",
            json={"dependencies": [{"upstream_task_id": sculpt_task["id"], "threshold": "APP"}]},
        )
        assert dep_denied.status_code == 403  # sup not assigned on light_task
        dep_ok = await dir_client.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/dependencies",
            json={"dependencies": [{"upstream_task_id": sculpt_task["id"], "threshold": "APP"}]},
        )
        assert dep_ok.status_code == 200
        # Self cycle & 2-hop cycle rejected
        dep_self = await sup_client.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/dependencies",
            json={"dependencies": [{"upstream_task_id": sculpt_task["id"], "threshold": "APP"}]},
        )
        assert dep_self.status_code == 409
        dep_cyc = await sup_client.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/dependencies",
            json={"dependencies": [{"upstream_task_id": light_task["id"], "threshold": "APP"}]},
        )
        assert dep_cyc.status_code == 409

        # Create a secondary Lighting task via unified endpoint
        wtg_task_res = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks",
            json={
                "entity_id": char_ent["id"],
                "department_id": lit_id,
                "name": "pass2",
                "needs_lead_review": False,
                "needs_client_review": False,
            },
        )
        assert wtg_task_res.status_code == 201
        pass2_id = wtg_task_res.json()["id"]
        # Link pass2 to sculpt_task (APP threshold); check blocked_upstream on light_task first
        dep_p2 = await prod_client.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{pass2_id}/dependencies",
            json={"dependencies": [{"upstream_task_id": sculpt_task["id"], "threshold": "APP"}]},
        )
        assert dep_p2.status_code == 200
        # Check blocked_upstream flag on light_task before sculpt is APP
        lt_det = (await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}")).json()
        assert lt_det["blocked_upstream"] is True

        # 4. Workflow transitions on sculpt_task:
        #    RDY -> IP -> publish -> P_LEAD -> RTK -> IP -> P_LEAD -> P_SUP -> APP
        assert (
            await art_client.post(
                f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
                json={"to": "IP"},
            )
        ).status_code == 200
        # Missing version fails submit
        no_ver = await art_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
            json={"to": "P_LEAD"},
        )
        assert no_ver.status_code == 400

        # Publish image to sculpt_task
        img_p = tmp_path / "sculpt.png"
        Image.new("RGB", (32, 32), (80, 120, 200)).save(img_p)
        with img_p.open("rb") as fh:
            pub_res = await art_client.post(
                f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/publish/upload",
                files=[("files", ("sculpt.png", fh, "image/png"))],
                data={"comment": "Sculpt v1"},
            )
        assert pub_res.status_code == 201
        v1_id = pub_res.json()["id"]

        sub_res = await art_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
            json={"to": "P_LEAD", "version_id": v1_id},
        )
        assert sub_res.status_code == 200
        assert sub_res.json()["status"] == "P_LEAD"

        # Retake requires comment
        no_cmt = await lead_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
            json={"to": "RTK"},
        )
        assert no_cmt.status_code == 400
        rtk_res = await lead_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
            json={"to": "RTK", "comment": "Fix proportions"},
        )
        assert rtk_res.status_code == 200
        assert rtk_res.json()["status"] == "RTK"
        assert rtk_res.json()["retake_count"] == 1

        # Re-submit -> Lead approve (to P_SUP) -> Director approves P_SUP (to APP)
        assert (
            await art_client.post(
                f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
                json={"to": "P_LEAD"},
            )
        ).status_code == 200
        p_sup_res = await lead_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
            json={"to": "P_SUP"},
        )
        assert p_sup_res.status_code == 200
        assert p_sup_res.json()["status"] == "P_SUP"
        app_res = await dir_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
            json={"to": "APP"},
        )
        assert app_res.status_code == 200
        assert app_res.json()["status"] == "APP"
        assert app_res.json()["approved_version_id"] == v1_id
        assert app_res.json()["acted_as"] == "role:director"

        # Upstream is now APP -> light_task is no longer blocked_upstream!
        lt_unblocked = (
            await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}")
        ).json()
        assert lt_unblocked["blocked_upstream"] is False

        # Test P_CLIENT auto-share + Producer on_behalf approval + Hold/Resume on light_task
        with img_p.open("rb") as fh:
            pub_lit = await art_client.post(
                f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/publish/upload",
                files=[("files", ("light.png", fh, "image/png"))],
                data={"comment": "Light v1"},
            )
        assert pub_lit.status_code == 201
        lit_v1_id = pub_lit.json()["id"]

        assert (
            await art_client.post(
                f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/transition",
                json={"to": "IP"},
            )
        ).status_code == 200
        # Test HLD -> IP restore
        assert (
            await dir_client.post(
                f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/transition",
                json={"to": "HLD"},
            )
        ).status_code == 200
        resumed = await dir_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/transition",
            json={"to": "IP"},
        )
        assert resumed.status_code == 200
        assert resumed.json()["status"] == "IP"

        # Submit light_task -> enters P_CLIENT & auto-shares lit_v1_id with Client Co
        p_cli = await art_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/transition",
            json={"to": "P_CLIENT", "version_id": lit_v1_id},
        )
        assert p_cli.status_code == 200
        assert p_cli.json()["status"] == "P_CLIENT"

        # 5. Comment visibility & client leakage verification (§15 & confirmed override)
        await sup_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/comments",
            json={"body": "Secret internal note", "visibility": "internal"},
        )
        await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/comments",
            json={"body": "Client-visible note", "visibility": "client"},
        )
        # Artists never see visibility='client'; clients never see visibility='internal'
        art_cmts = (
            await art_client.get(f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/comments")
        ).json()
        assert [c["body"] for c in art_cmts] == ["Secret internal note"]
        cli_cmts = (
            await cli_client.get(f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/comments")
        ).json()
        assert [c["body"] for c in cli_cmts] == ["Client-visible note"]
        dir_cmts = (
            await dir_client.get(f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/comments")
        ).json()
        assert {c["body"] for c in dir_cmts} == {"Secret internal note", "Client-visible note"}

        # Client probing unshared task -> 404 (not 403); client detail omits bid/logged/assignments
        assert (
            await cli_client.get(f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}")
        ).status_code == 404
        assert (
            await cli_client.get(f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/events")
        ).status_code == 404
        assert (
            await cli_client.get(f"/api/v1/projects/{proj_uuid}/tasks/graph")
        ).status_code == 403
        assert (await cli_client.get(f"/api/v1/projects/{proj_uuid}/workload")).status_code == 403
        cli_detail = (
            await cli_client.get(f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}")
        ).json()
        assert "bid_hours" not in cli_detail
        assert "logged_hours" not in cli_detail
        assert "assignments" not in cli_detail
        assert cli_detail["product"]["versions"][0]["id"] == lit_v1_id

        # Producer approves P_CLIENT on behalf -> audit_log + on_behalf_of='client'
        on_behalf = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{light_task['id']}/transition",
            json={"to": "APP", "comment": "Client signed off in call"},
        )
        assert on_behalf.status_code == 200
        assert on_behalf.json()["acted_as"] == "on_behalf"
        assert on_behalf.json()["reviews"][-1]["on_behalf_of"] == "client"
        audit_rows = (await admin.get(f"/api/v1/projects/{proj_uuid}/admin/audit")).json()
        assert any(a["action"] == "task.approve_on_behalf" for a in audit_rows)

        # 6. Time logs + Workload math
        tl = await art_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/time-logs",
            json={"hours": 3.5, "note": "Detailing pass"},
        )
        assert tl.status_code == 201
        after_tl = (
            await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}")
        ).json()
        assert after_tl["logged_hours"] == 3.5
        wk = await sup_client.get(f"/api/v1/projects/{proj_uuid}/workload")
        assert wk.status_code == 200
        assert len(wk.json()["rows"]) >= 1

        # 7. Bulk update atomic rollback when 1 row is invalid, then atomic commit when valid
        bulk_fail = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/bulk",
            json={
                "dry_run": False,
                "rows": [
                    {"task_id": pass2_id, "priority": "stopper"},
                    {"task_id": sculpt_task["id"], "status": "WTG"},  # illegal transition!
                ],
            },
        )
        assert bulk_fail.status_code == 200
        assert bulk_fail.json()["applied"] is False
        assert bulk_fail.json()["error_count"] == 1
        pass2_check = (await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{pass2_id}")).json()
        assert pass2_check["priority"] == "normal"  # rolled back atomically!

        bulk_ok = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/bulk",
            json={
                "dry_run": False,
                "rows": [{"task_id": pass2_id, "priority": "stopper"}],
            },
        )
        assert bulk_ok.status_code == 200
        assert bulk_ok.json()["applied"] is True
        assert (await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{pass2_id}")).json()[
            "priority"
        ] == "stopper"

        # 8. Entity links (glasses -> char_01 -> sh010), cycle check, indirect depth 2, suggest deps
        rig_id = meta["depts"]["Rigging"]
        glasses = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/entities",
                json={"name": "glasses", "entity_type": "Prop", "department_ids": [mod_id]},
            )
        ).json()
        sh010 = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/entities",
                json={"name": "sh010", "entity_type": "Shot", "department_ids": [rig_id, lit_id]},
            )
        ).json()

        l1 = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/entity-links",
            json={
                "source_entity_id": glasses["id"],
                "target_entity_id": char_ent["id"],
                "link_type": "prop",
            },
        )
        assert l1.status_code == 201
        l2 = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/entity-links",
            json={
                "source_entity_id": char_ent["id"],
                "target_entity_id": sh010["id"],
                "link_type": "cast",
            },
        )
        assert l2.status_code == 201
        # Cycle rejection: sh010 -> glasses rejected with 409
        l_cyc = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/entity-links",
            json={"source_entity_id": sh010["id"], "target_entity_id": glasses["id"]},
        )
        assert l_cyc.status_code == 409

        sh_links = (
            await prod_client.get(f"/api/v1/projects/{proj_uuid}/entities/{sh010['id']}/links")
        ).json()
        assert len(sh_links["uses"]) == 1
        assert [x["entity_name"] for x in sh_links["uses_indirect"]] == ["glasses"]
        assert sh_links["uses_indirect"][0]["via_entity_names"] == ["char_01"]

        # Dependency template Modeling -> Rigging; suggest & apply on char_01 -> sh010
        tpl = await admin.post(
            f"/api/v1/projects/{proj_uuid}/dependency-templates",
            json={
                "upstream_department_id": mod_id,
                "downstream_department_id": rig_id,
                "threshold": "APP",
            },
        )
        assert tpl.status_code == 201
        suggestions = (
            await prod_client.post(
                f"/api/v1/projects/{proj_uuid}/entities/{sh010['id']}/suggest-dependencies",
                json={"depth": 1},
            )
        ).json()
        assert len(suggestions) >= 1
        apply_res = await prod_client.post(
            f"/api/v1/projects/{proj_uuid}/entities/{sh010['id']}/apply-dependencies",
            json={
                "pairs": [
                    {
                        "downstream_task_id": s["downstream_task_id"],
                        "upstream_task_id": s["upstream_task_id"],
                        "threshold": s["threshold"],
                    }
                    for s in suggestions
                    if not s["already_exists"] and not s["would_cycle"]
                ]
            },
        )
        assert apply_res.status_code == 200
        assert apply_res.json()["applied"] >= 1
        # Suggesting again marks them already_exists=True
        suggestions_after = (
            await prod_client.post(
                f"/api/v1/projects/{proj_uuid}/entities/{sh010['id']}/suggest-dependencies",
                json={"depth": 1},
            )
        ).json()
        assert all(s["already_exists"] for s in suggestions_after)

        # Entity-mode graph & include_linked_entities filter
        eg = (await prod_client.get(f"/api/v1/projects/{proj_uuid}/entity-links/graph")).json()
        assert len(eg["nodes"]) >= 3
        linked_tasks = (
            await prod_client.get(
                f"/api/v1/projects/{proj_uuid}/tasks",
                params={"entity_id": char_ent["id"], "include_linked_entities": "true"},
            )
        ).json()
        assert any(it["entity_id"] == sh010["id"] for it in linked_tasks["items"])

        # 9. Reopen approved upstream -> blocked_upstream=True without auto-demotion;
        #    also verify automatic WTG -> RDY promotion on upstream publish (PUBLISHED threshold)
        reopen = await sup_client.post(
            f"/api/v1/projects/{proj_uuid}/tasks/{sculpt_task['id']}/transition",
            json={"to": "RTK", "comment": "Need polish after approval"},
        )
        assert reopen.status_code == 200
        pass2_reopened = (
            await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{pass2_id}")
        ).json()
        assert pass2_reopened["blocked_upstream"] is True
        assert pass2_reopened["status"] == "RDY"

        glasses_tasks = (
            await admin.get(
                f"/api/v1/projects/{proj_uuid}/tasks",
                params={"entity_id": glasses["id"]},
            )
        ).json()["items"]
        glasses_mod_id = glasses_tasks[0]["id"]
        sh_tasks = (
            await admin.get(
                f"/api/v1/projects/{proj_uuid}/tasks",
                params={"entity_id": sh010["id"]},
            )
        ).json()["items"]
        sh_lit_id = next(t["id"] for t in sh_tasks if t["department_id"] == lit_id)
        dep_pub = await prod_client.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{sh_lit_id}/dependencies",
            json={
                "dependencies": [
                    {"upstream_task_id": glasses_mod_id, "threshold": "PUBLISHED"}
                ]
            },
        )
        assert dep_pub.status_code == 200
        registry = app.state.project_registry  # type: ignore[attr-defined]
        app_sf = app.state.app_session_factory  # type: ignore[attr-defined]
        async with app_sf() as adb:
            proj_ctx = await registry.get_project(proj_uuid, adb)
        async with proj_ctx.session_factory() as p_db:
            wtg_row = await p_db.get(Task, uuid.UUID(sh_lit_id))
            assert wtg_row is not None
            wtg_row.status = "WTG"
            await p_db.commit()

        glass_png = tmp_path / "glasses_v1.png"
        Image.new("RGB", (64, 64), (180, 200, 220)).save(glass_png)
        with glass_png.open("rb") as f:
            glass_pub = await admin.post(
                f"/api/v1/projects/{proj_uuid}/tasks/{glasses_mod_id}/publish/upload",
                data={"comment": "Initial glasses geo"},
                files=[("files", ("glasses_v1.png", f, "image/png"))],
            )
        assert glass_pub.status_code == 201
        sh_lit_after = (await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{sh_lit_id}")).json()
        assert sh_lit_after["status"] == "RDY"
        sh_lit_events = (
            await admin.get(f"/api/v1/projects/{proj_uuid}/tasks/{sh_lit_id}/events")
        ).json()
        assert any(
            ev["field"] == "status"
            and ev["old_value"] == "WTG"
            and ev["new_value"] == "RDY"
            and ev["source"] == "system"
            for ev in sh_lit_events
        )
    finally:
        for client in (
            prod_client,
            dir_client,
            sup_client,
            lead_client,
            art_client,
            cli_client,
            admin,
        ):
            await client.__aexit__(None, None, None)


@pytest.mark.asyncio
async def test_tasks_list_20k_performance_budget(tmp_path: Path) -> None:
    """Verify GET /tasks filtered cursor pagination stays under 200 ms p95 with 20,000 tasks."""
    reset_lockouts()
    app_db = tmp_path / "perf_app.db"
    proj_root = tmp_path / "perf_proj"
    cfg = Settings(
        app_db_url=f"sqlite+aiosqlite:///{app_db.as_posix()}",
        demo_project_path=tmp_path / "absent",
        auto_scan_on_startup=False,
    )
    app = create_app(cfg)
    async with (
        app.router.lifespan_context(app),  # type: ignore[attr-defined]
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,  # type: ignore[arg-type]
    ):
            attach_csrf_hook(client)
            r = await client.post(
                "/api/v1/projects",
                json={
                    "path": str(proj_root),
                    "name": "PerfShow20k",
                    "starter_departments": ["Modeling", "Rigging", "Lighting", "Comp"],
                },
            )
            assert r.status_code == 201
            proj_uuid = str(r.json()["uuid"])
            await login_client(client, proj_uuid, "admin", cfg.initial_admin_password)
            await client.post(
                f"/api/v1/projects/{proj_uuid}/auth/change-password",
                json={
                    "current_password": cfg.initial_admin_password,
                    "new_password": TEST_ADMIN_PASSWORD,
                },
            )

            # Bulk insert 200 entities x 100 tasks = 20,000 tasks directly via ProjectRegistry
            reg = app.state.project_registry
            async with app.state.app_session_factory() as adb:
                ctx = await reg.get_project(proj_uuid, adb)

            async with ctx.session_factory() as db:
                depts = list((await db.execute(select(Department))).scalars().all())
                entities: list[Entity] = []
                eds: list[EntityDepartment] = []
                tasks: list[Task] = []
                statuses = ("WTG", "RDY", "IP", "P_LEAD", "APP")
                priorities = ("normal", "high", "stopper")
                now_d = datetime.now(UTC).date()
                for e_idx in range(200):
                    ent = Entity(
                        id=uuid.uuid4(),
                        name=f"shot_{e_idx:04d}",
                        folder_name=f"shot_{e_idx:04d}",
                        rel_path=f"shots/shot_{e_idx:04d}",
                        entity_type="Shot",
                    )
                    entities.append(ent)
                db.add_all(entities)
                await db.flush()

                for e_idx, ent in enumerate(entities):
                    for d_idx, d in enumerate(depts):
                        ed = EntityDepartment(
                            id=uuid.uuid4(),
                            entity_id=ent.id,
                            department_id=d.id,
                            sort_order=d_idx,
                        )
                        eds.append(ed)
                        for v_idx in range(25):
                            tasks.append(
                                Task(
                                    id=uuid.uuid4(),
                                    task_code=f"{ent.name}_{d.short_code}_{v_idx:02d}",
                                    task_name=f"{d.name} - t{v_idx:02d}",
                                    entity_department_id=ed.id,
                                    entity_id=ent.id,
                                    parent_entity_type="Shot",
                                    department_id=d.id,
                                    name=f"t{v_idx:02d}",
                                    folder_name=f"t{v_idx:02d}",
                                    sort_order=v_idx,
                                    status=statuses[(e_idx + d_idx + v_idx) % len(statuses)],
                                    priority=priorities[(e_idx + v_idx) % len(priorities)],
                                    ideal_finish_date=now_d + timedelta(days=v_idx % 10),
                                )
                            )
                db.add_all(eds)
                await db.flush()
                db.add_all(tasks)
                await db.commit()
                target_dept_id = str(depts[0].id)

            # Warm-up 1 call, then sample 12 filtered pages and assert p95 < 200ms
            await client.get(
                f"/api/v1/projects/{proj_uuid}/tasks",
                params={
                    "department_id": target_dept_id,
                    "status": "RDY",
                    "sort": "code",
                    "limit": 50,
                },
            )
            timings_ms: list[float] = []
            for idx in range(12):
                t0 = time.perf_counter()
                resp = await client.get(
                    f"/api/v1/projects/{proj_uuid}/tasks",
                    params={
                        "department_id": target_dept_id,
                        "status": "RDY",
                        "sort": "code",
                        "limit": 50,
                        "cursor": str(idx * 50),
                    },
                )
                elapsed = (time.perf_counter() - t0) * 1000.0
                assert resp.status_code == 200
                body = resp.json()
                assert body["total"] == 1000
                assert len(body["items"]) == 50
                timings_ms.append(elapsed)

            timings_ms.sort()
            p95 = timings_ms[int(len(timings_ms) * 0.95) - 1]
            assert p95 < 200.0, f"Expected p95 < 200ms at 20k tasks, got {p95:.1f}ms ({timings_ms})"
