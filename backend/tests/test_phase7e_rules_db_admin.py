from __future__ import annotations

import statistics
import time
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.errors import AppError
from app.core.project_registry import ProjectContext
from app.core.settings import Settings
from app.main import create_app
from app.models.project_db import Entity, EntityDepartment, Task
from app.models.tasks import TaskDependency, TaskEvent
from app.models.user import TaskAssignment
from app.services.auth_service import reset_lockouts
from app.services.rules_engine import (
    natural_compare,
    safe_regex_match,
    validate_actions_json,
    validate_conditions_json,
)
from tests.conftest import TEST_ADMIN_PASSWORD, attach_csrf_hook, login_client

USER_PW = "Phase7ePass!2026"


async def _setup_phase7e_project(
    tmp_path: Path,
) -> tuple[object, str, ProjectContext, AsyncClient, dict[str, str], dict[str, str], object]:
    reset_lockouts()
    app_db = tmp_path / "app.db"
    proj_root = tmp_path / "proj_7e"
    cfg = Settings(
        app_db_url=f"sqlite+aiosqlite:///{app_db.as_posix()}",
        demo_project_path=tmp_path / "absent",
        auto_scan_on_startup=False,
    )
    app = create_app(cfg)
    lifespan_cm = app.router.lifespan_context(app)  # type: ignore[attr-defined]
    await lifespan_cm.__aenter__()

    admin = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")  # type: ignore[arg-type]
    await admin.__aenter__()
    attach_csrf_hook(admin)

    res = await admin.post(
        "/api/v1/projects",
        json={
            "path": str(proj_root),
            "name": "Phase7EShow",
            "starter_departments": ["Modeling", "Rigging", "Lighting"],
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
    async with app.state.app_session_factory() as app_db_sess:  # type: ignore[attr-defined]
        ctx = await app.state.project_registry.get_project(proj_uuid, app_db_sess)  # type: ignore[attr-defined]
    return app, proj_uuid, ctx, admin, roles_by_name, depts_by_name, lifespan_cm


def test_rules_unit_natural_compare_regex_and_validation() -> None:
    assert natural_compare("sh041", "sh040") == 1
    assert natural_compare("sh1000", "sh040") == 1
    assert natural_compare("ab041", "sh040") is None
    assert natural_compare("100", "40") == 1
    assert natural_compare("sh040", "sh040") == 0

    assert safe_regex_match(r"^sh\d+$", "sh045") is True
    assert safe_regex_match(r"^sh\d+$", "char_01") is False

    with pytest.raises(AppError) as too_long:
        safe_regex_match("a" * 260, "aaa")
    assert too_long.value.code == "invalid_rule"

    with pytest.raises(AppError) as nested:
        safe_regex_match(r"(a+)+b", "a" * 25 + "!")
    assert nested.value.code == "regex_timeout"

    # Nested depth > 2 rejected
    deep = {
        "op": "AND",
        "items": [{"op": "OR", "items": [{"op": "AND", "items": [{"op": "OR", "items": []}]}]}],
    }
    with pytest.raises(AppError):
        validate_conditions_json(deep)

    # Bad field / empty actions rejected
    with pytest.raises(AppError):
        validate_conditions_json(
            {"op": "AND", "items": [{"field": "unknown.col", "operator": "=", "value": "x"}]}
        )
    with pytest.raises(AppError):
        validate_actions_json([])


@pytest.mark.asyncio
async def test_rules_engine_ordering_manual_protection_links_and_triggers(tmp_path: Path) -> None:
    _app, proj_uuid, ctx, admin, roles, depts, lifespan_cm = await _setup_phase7e_project(tmp_path)
    try:
        # Create producer & two artists
        comp = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/companies",
                json={"name": "Main", "short_code": "MAIN", "kind": "internal"},
            )
        ).json()
        u_prod = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/users",
                json={
                    "username": "prod1",
                    "full_name": "Producer One",
                    "password": USER_PW,
                    "role_id": roles["producer"],
                    "company_id": comp["id"],
                    "must_change_password": False,
                },
            )
        ).json()
        assert "id" in u_prod
        u_a = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/users",
                json={
                    "username": "light_a",
                    "full_name": "Light A",
                    "password": USER_PW,
                    "role_id": roles["artist"],
                    "company_id": comp["id"],
                    "must_change_password": False,
                },
            )
        ).json()
        u_b = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/users",
                json={
                    "username": "light_b",
                    "full_name": "Light B",
                    "password": USER_PW,
                    "role_id": roles["artist"],
                    "company_id": comp["id"],
                    "must_change_password": False,
                },
            )
        ).json()

        # Entities: char_01, sh030, sh045, sh1000, ab050
        e_char = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/entities",
                json={
                    "name": "char_01",
                    "entity_type": "character",
                    "department_ids": [depts["Rigging"]],
                },
            )
        ).json()
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/entities",
            json={
                "name": "sh030",
                "entity_type": "shot",
                "department_ids": [depts["Lighting"]],
            },
        )
        e_sh045 = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/entities",
                json={
                    "name": "sh045",
                    "entity_type": "shot",
                    "department_ids": [depts["Lighting"]],
                },
            )
        ).json()
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/entities",
            json={
                "name": "sh1000",
                "entity_type": "shot",
                "department_ids": [depts["Lighting"]],
            },
        )
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/entities",
            json={"name": "ab050", "entity_type": "shot", "department_ids": [depts["Lighting"]]},
        )

        # Entity link char_01 -> sh045
        lk = await admin.post(
            f"/api/v1/projects/{proj_uuid}/entity-links",
            json={
                "source_entity_id": e_char["id"],
                "target_entity_id": e_sh045["id"],
                "link_type": "appears_in",
            },
        )
        assert lk.status_code == 201

        tasks_list = (await admin.get(f"/api/v1/projects/{proj_uuid}/tasks?limit=100")).json()[
            "items"
        ]
        task_by_ent = {t["entity_name"]: t for t in tasks_list}

        # Malformed rule JSON rejected at POST /rules
        bad_rule = await admin.post(
            f"/api/v1/projects/{proj_uuid}/rules",
            json={
                "name": "bad",
                "trigger": "manual",
                "conditions_json": {"op": "XOR", "items": []},
                "actions_json": [],
            },
        )
        assert bad_rule.status_code == 400

        # Rule 1: entity.type = shot AND entity.name > sh040 -> Lighting assign artist light_a
        r1 = await admin.post(
            f"/api/v1/projects/{proj_uuid}/rules",
            json={
                "name": "Assign high shots to light_a",
                "sort_order": 1,
                "trigger": "manual",
                "conditions_json": {
                    "op": "AND",
                    "items": [
                        {"field": "entity.type", "operator": "=", "value": "shot"},
                        {"field": "entity.name", "operator": ">", "value": "sh040"},
                    ],
                },
                "actions_json": [
                    {
                        "type": "assign",
                        "department": "Lighting",
                        "role": "artist",
                        "user_id": u_a["id"],
                    }
                ],
            },
        )
        assert r1.status_code == 201
        r1_id = r1.json()["id"]

        # Dry-run preview matches sh045 & sh1000 only (not sh030, not ab050)
        prev = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/rules/preview",
                json={"rule_id": r1_id},
            )
        ).json()
        assert prev["matched_tasks"] == 2
        prev_codes = {c["task_code"] for c in prev["changes"]}
        assert prev_codes == {task_by_ent["sh045"]["task_code"], task_by_ent["sh1000"]["task_code"]}

        # Apply Rule 1 -> applied changes match preview cleanly
        applied = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/rules/apply",
                json={"rule_ids": [r1_id]},
            )
        ).json()
        assert applied["applied_count"] == 2

        # Verify source='rule' and TaskEvent source='rule'
        async with ctx.session_factory() as db:
            assigns = (
                (
                    await db.execute(
                        select(TaskAssignment).where(
                            TaskAssignment.task_id == uuid.UUID(task_by_ent["sh045"]["id"])
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(assigns) == 1
            assert assigns[0].source == "rule"
            assert str(assigns[0].rule_id) == r1_id
            evs = (
                (
                    await db.execute(
                        select(TaskEvent).where(
                            TaskEvent.task_id == uuid.UUID(task_by_ent["sh045"]["id"]),
                            TaskEvent.source == "rule",
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(evs) >= 1

        # Manually assign light_b to sh1000 -> protected from rules without override_manual
        await admin.put(
            f"/api/v1/projects/{proj_uuid}/tasks/{task_by_ent['sh1000']['id']}/assignments",
            json={"assignments": [{"user_id": u_b["id"], "assignment_role": "artist"}]},
        )

        # Rule 2 (later sort_order=2) assigns light_b without override_manual
        r2 = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/rules",
                json={
                    "name": "Override rule-only with light_b",
                    "sort_order": 2,
                    "trigger": "manual",
                    "conditions_json": {
                        "op": "AND",
                        "items": [{"field": "entity.name", "operator": ">", "value": "sh040"}],
                    },
                    "actions_json": [
                        {
                            "type": "assign",
                            "department": "Lighting",
                            "role": "artist",
                            "user_id": u_b["id"],
                            "override_manual": False,
                        }
                    ],
                },
            )
        ).json()
        app2 = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/rules/apply",
                json={"rule_ids": [r1_id, r2["id"]]},
            )
        ).json()
        skipped_manual = [c for c in app2["changes"] if c["skipped_manual"]]
        assert any(c["task_code"] == task_by_ent["sh1000"]["task_code"] for c in skipped_manual)

        # Link-based condition + dependency rule (entity.uses.name = char_01 -> uses Rigging APP)
        r_dep = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/rules",
                json={
                    "name": "Char rig blocks shot light",
                    "sort_order": 3,
                    "trigger": "link_created",
                    "conditions_json": {
                        "op": "AND",
                        "items": [
                            {"field": "entity.uses.name", "operator": "=", "value": "char_01"}
                        ],
                    },
                    "actions_json": [
                        {
                            "type": "add_dependency",
                            "department": "Lighting",
                            "scope": "uses",
                            "upstream_department": "Rigging",
                            "threshold": "APP",
                        }
                    ],
                },
            )
        ).json()
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/rules/apply", json={"rule_ids": [r_dep["id"]]}
        )
        async with ctx.session_factory() as db:
            deps = (
                (
                    await db.execute(
                        select(TaskDependency).where(
                            TaskDependency.task_id == uuid.UUID(task_by_ent["sh045"]["id"])
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(deps) == 1
            assert deps[0].from_entity_link is True

        # Automatic entity_created / task_created rule trigger test
        r_auto = await admin.post(
            f"/api/v1/projects/{proj_uuid}/rules",
            json={
                "name": "Auto high prio for sh099",
                "sort_order": 4,
                "trigger": "entity_created",
                "conditions_json": {
                    "op": "AND",
                    "items": [{"field": "entity.name", "operator": "=", "value": "sh099"}],
                },
                "actions_json": [{"type": "set_priority", "priority": "stopper"}],
            },
        )
        assert r_auto.status_code == 201
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/entities",
            json={"name": "sh099", "entity_type": "shot", "department_ids": [depts["Lighting"]]},
        )
        all_after = (await admin.get(f"/api/v1/projects/{proj_uuid}/tasks?q=sh099")).json()["items"]
        assert len(all_after) == 1
        assert all_after[0]["priority"] == "stopper"
        # Unused sh030 untouched by sh040+ rules
        assert task_by_ent["sh030"]["priority"] == "normal"
    finally:
        await admin.aclose()
        await lifespan_cm.__aexit__(None, None, None)  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_raw_db_viewer_redaction_sql_console_audit_and_archived(tmp_path: Path) -> None:
    _app, proj_uuid, _ctx, admin, roles, depts, lifespan_cm = await _setup_phase7e_project(tmp_path)
    prod = AsyncClient(transport=ASGITransport(app=_app), base_url="http://test")  # type: ignore[arg-type]
    await prod.__aenter__()
    attach_csrf_hook(prod)
    try:
        # Producer cannot access raw DB endpoints (403)
        await admin.post(
            f"/api/v1/projects/{proj_uuid}/users",
            json={
                "username": "prod_db",
                "full_name": "Prod DB",
                "password": USER_PW,
                "role_id": roles["producer"],
                "must_change_password": False,
            },
        )
        await login_client(prod, proj_uuid, "prod_db", USER_PW)
        assert (await prod.get(f"/api/v1/projects/{proj_uuid}/admin/db/tables")).status_code == 403
        assert (
            await prod.get(f"/api/v1/projects/{proj_uuid}/admin/db/tables/users")
        ).status_code == 403
        assert (
            await prod.post(
                f"/api/v1/projects/{proj_uuid}/admin/db/query",
                json={"sql": "SELECT * FROM users"},
            )
        ).status_code == 403

        # Admin sees tables and redacted columns
        tables = (await admin.get(f"/api/v1/projects/{proj_uuid}/admin/db/tables")).json()
        assert any(t["name"] == "users" for t in tables)
        users_browse = (
            await admin.get(f"/api/v1/projects/{proj_uuid}/admin/db/tables/users")
        ).json()
        pw_idx = [c["name"] for c in users_browse["columns"]].index("password_hash")
        assert users_browse["columns"][pw_idx]["redacted"] is True
        assert all(row[pw_idx] == "[REDACTED]" for row in users_browse["rows"])

        # SQL console is disabled by default
        disabled_q = await admin.post(
            f"/api/v1/projects/{proj_uuid}/admin/db/query",
            json={"sql": "SELECT username FROM users"},
        )
        assert disabled_q.status_code == 403

        # Enable SQL console via project settings
        patch_on = await admin.patch(
            f"/api/v1/projects/{proj_uuid}/project/settings",
            json={"admin_sql_console_enabled": True},
        )
        assert patch_on.status_code == 200

        # Valid SELECT works; sensitive column masked at engine level even under alias / WHERE
        ok_q = await admin.post(
            f"/api/v1/projects/{proj_uuid}/admin/db/query",
            json={"sql": "SELECT username, password_hash AS secret_val FROM users"},
        )
        assert ok_q.status_code == 200
        q_body = ok_q.json()
        assert len(q_body["rows"]) >= 2
        for row in q_body["rows"]:
            assert row[1] in (None, "[REDACTED]")

        where_probe = (
            await admin.post(
                f"/api/v1/projects/{proj_uuid}/admin/db/query",
                json={"sql": "SELECT username FROM users WHERE password_hash LIKE '%$%'"},
            )
        ).json()
        assert where_probe["rows"] == []

        # Write / DDL / PRAGMA / multi-statement rejected cleanly
        for bad_sql in (
            "DELETE FROM users",
            "DROP TABLE rules",
            "INSERT INTO tags (id, name) VALUES ('1', 'hack')",
            "PRAGMA writable_schema = ON",
            "SELECT 1; DELETE FROM users;",
        ):
            bad_res = await admin.post(
                f"/api/v1/projects/{proj_uuid}/admin/db/query",
                json={"sql": bad_sql},
            )
            assert bad_res.status_code in (400, 403)

        # Verify users table still intact & audit log recorded DB access
        after_users = (await admin.get(f"/api/v1/projects/{proj_uuid}/users")).json()
        assert len(after_users) >= 2
        audit_rows = (await admin.get(f"/api/v1/projects/{proj_uuid}/admin/audit?limit=50")).json()
        actions = {a["action"] for a in audit_rows}
        assert {"admin.db.tables", "admin.db.table_view", "admin.db.query"}.issubset(actions)

        # Archived project status blocks non-admin writes; only admin can unarchive
        arch = await admin.patch(
            f"/api/v1/projects/{proj_uuid}/project/settings",
            json={"status": "archived"},
        )
        assert arch.status_code == 200
        blocked_ent = await prod.post(
            f"/api/v1/projects/{proj_uuid}/entities",
            json={"name": "while_archived", "department_ids": [depts["Modeling"]]},
        )
        assert blocked_ent.status_code == 403
        prod_unarch = await prod.patch(
            f"/api/v1/projects/{proj_uuid}/project/settings",
            json={"status": "active"},
        )
        assert prod_unarch.status_code == 403
        admin_unarch = await admin.patch(
            f"/api/v1/projects/{proj_uuid}/project/settings",
            json={"status": "active"},
        )
        assert admin_unarch.status_code == 200
    finally:
        await prod.aclose()
        await admin.aclose()
        await lifespan_cm.__aexit__(None, None, None)  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_20k_tasks_performance_budget(tmp_path: Path) -> None:
    _app, proj_uuid, ctx, admin, _roles, depts, lifespan_cm = await _setup_phase7e_project(tmp_path)
    try:
        dept_ids = list(depts.values())

        async with ctx.session_factory() as db:
            # Create 4,000 entities x 5 tasks = 20,000 tasks via ORM bulk save
            ent_objs: list[Entity] = []
            for i in range(4000):
                ent_objs.append(
                    Entity(
                        id=uuid.uuid4(),
                        name=f"ent_{i:04d}",
                        folder_name=f"ent_{i:04d}",
                        rel_path=f"Show/ent_{i:04d}",
                        entity_type="shot" if i % 2 == 0 else "asset",
                    )
                )
            db.add_all(ent_objs)
            await db.flush()

            ed_objs: list[EntityDepartment] = []
            task_objs: list[Task] = []
            d0 = uuid.UUID(dept_ids[0])
            for e_idx, e in enumerate(ent_objs):
                ed_id = uuid.uuid4()
                ed_objs.append(
                    EntityDepartment(id=ed_id, entity_id=e.id, department_id=d0, sort_order=0)
                )
                for k in range(5):
                    status = "IP" if (e_idx + k) % 4 == 0 else "RDY"
                    task_objs.append(
                        Task(
                            id=uuid.uuid4(),
                            task_code=f"{e.name}_MOD_t{k}",
                            task_name=f"t{k}",
                            entity_department_id=ed_id,
                            entity_id=e.id,
                            parent_entity_type=e.entity_type,
                            department_id=d0,
                            name=f"t{k}",
                            folder_name=f"t{k}",
                            status=status,
                            priority="high" if k == 0 else "normal",
                            sort_order=k,
                        )
                    )
            db.add_all(ed_objs)
            db.add_all(task_objs)
            await db.commit()

        # Warm up once
        warm = await admin.get(
            f"/api/v1/projects/{proj_uuid}/tasks?department_id={dept_ids[0]}&status=IP&limit=50"
        )
        assert warm.status_code == 200
        assert len(warm.json()["items"]) == 50

        latencies: list[float] = []
        for _ in range(10):
            t0 = time.perf_counter()
            r = await admin.get(
                f"/api/v1/projects/{proj_uuid}/tasks?department_id={dept_ids[0]}&status=IP&limit=50"
            )
            latencies.append(time.perf_counter() - t0)
            assert r.status_code == 200
        p95 = sorted(latencies)[int(len(latencies) * 0.95) - 1]
        assert p95 < 0.25, (
            f"20k-task filtered list p95={p95:.3f}s (median={statistics.median(latencies):.3f}s)"
        )
    finally:
        await admin.aclose()
        await lifespan_cm.__aexit__(None, None, None)  # type: ignore[attr-defined]
