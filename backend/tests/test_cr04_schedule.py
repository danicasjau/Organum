"""CR04 §5/§7: schedule drafts, versions, conflicts, milestones and permissions."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from httpx import ASGITransport, AsyncClient

from app.services.schedule_service import (
    Change,
    changes_to_reach,
    diff,
    find_conflicts,
    late_tasks_for_milestone,
    merge_change,
    overlay,
    summarize,
)
from tests.conftest import attach_csrf_hook, login_client

PW = "SchedPass1234!"


def _live() -> dict[str, Any]:
    return {
        "tasks": {
            "t1": {
                "code": "A",
                "start": "2030-01-01",
                "finish": "2030-01-05",
                "assignments": [["u1", "artist"]],
            },
            "t2": {"code": "B", "start": "2030-01-06", "finish": "2030-01-09", "assignments": []},
        },
        "milestones": {
            "m1": {
                "name": "Delivery",
                "date": "2030-01-08",
                "kind": "deliver",
                "target_kind": "none",
                "target_id": None,
                "note": "",
                "status": "open",
                "client_visible": False,
            },
        },
        "activations": {},
    }


# ----------------------------------------------------------------------------- unit


def test_overlay_diff_and_roundtrip() -> None:
    live = _live()
    changes = [
        Change("task", "update", "t1", {"finish": "2030-01-07"}),
        Change("task", "assign", "t2", {"assignments": [["u2", "lead"]]}),
        Change("milestone", "delete", "m1", {}),
        Change(
            "milestone",
            "create",
            "m2",
            {
                "name": "Lock",
                "date": "2030-01-20",
                "kind": "milestone",
                "target_kind": "none",
                "target_id": None,
                "note": "",
                "status": "open",
                "client_visible": True,
            },
        ),
        Change(
            "activation",
            "create",
            "a1",
            {
                "target_kind": "user",
                "target_id": "u1",
                "start": "2030-01-01",
                "end": "2030-02-01",
                "note": "",
            },
        ),
        Change("task", "update", "ghost", {"start": "2030-01-01"}),  # deleted task: ignored
    ]
    draft = overlay(live, changes)
    assert live["tasks"]["t1"]["finish"] == "2030-01-05"  # live untouched
    assert draft["tasks"]["t1"]["finish"] == "2030-01-07"
    items = diff(live, draft)
    assert {(i.kind, i.target_id, i.op) for i in items} == {
        ("task", "t1", "changed"),
        ("task", "t2", "changed"),
        ("milestone", "m1", "removed"),
        ("milestone", "m2", "added"),
        ("activation", "a1", "added"),
    }
    assert summarize(items) == {"tasks": 2, "milestones": 2, "activations": 1, "total": 5}
    # Jump back: the changes needed to reach `live` from the draft restore it exactly.
    back = changes_to_reach(draft, live)
    assert overlay(draft, back) == live


def test_merge_rules() -> None:
    upd = Change("task", "update", "t1", {"start": "2030-01-02"})
    assert merge_change(None, upd) is upd
    merged = merge_change(upd, Change("task", "update", "t1", {"finish": "2030-01-09"}))
    assert merged is not None and merged.payload == {"start": "2030-01-02", "finish": "2030-01-09"}
    create = Change("milestone", "create", "m9", {"name": "x", "date": "2030-01-01"})
    assert merge_change(create, Change("milestone", "delete", "m9", {})) is None
    moved = merge_change(create, Change("milestone", "update", "m9", {"date": "2030-02-01"}))
    assert moved is not None and moved.op == "create" and moved.payload["date"] == "2030-02-01"
    deleted = merge_change(
        Change("milestone", "update", "m1", {"name": "y"}), Change("milestone", "delete", "m1", {})
    )
    assert deleted is not None and deleted.op == "delete"


def test_conflicts_and_late_tasks() -> None:
    live = _live()
    base = dict(live["tasks"]["t1"])
    live["tasks"]["t1"]["finish"] = "2030-01-06"  # someone changed it live meanwhile
    conflicts = find_conflicts(
        live,
        [
            (Change("task", "update", "t1", {"finish": "2030-01-10"}), base, "A"),
            (
                Change("task", "update", "t2", {"start": "2030-01-07"}),
                dict(live["tasks"]["t2"]),
                "B",
            ),
            (Change("milestone", "update", "gone", {"name": "x"}), {"name": "old"}, "G"),
        ],
    )
    assert [c["label"] for c in conflicts] == ["A", "G"]
    assert conflicts[0]["fields"] == {"finish": ["2030-01-05", "2030-01-06"]}

    meta = {
        "t1": {"department_id": "d1", "entity_id": "e1", "company_ids": ["c1"]},
        "t2": {"department_id": "d2", "entity_id": "e1", "company_ids": []},
    }
    tasks = _live()["tasks"]
    ms = {"date": "2030-01-06", "target_kind": "none", "target_id": None}
    assert late_tasks_for_milestone(ms, tasks, meta) == ["t2"]
    assert late_tasks_for_milestone(
        {**ms, "date": "2030-01-04", "target_kind": "department", "target_id": "d1"}, tasks, meta
    ) == ["t1"]
    assert late_tasks_for_milestone(
        {**ms, "date": "2030-01-04", "target_kind": "user", "target_id": "u1"}, tasks, meta
    ) == ["t1"]
    assert late_tasks_for_milestone(
        {**ms, "date": "2030-01-04", "target_kind": "company", "target_id": "c1"}, tasks, meta
    ) == ["t1"]
    assert late_tasks_for_milestone(
        {**ms, "date": "2030-01-04", "target_kind": "entity", "target_id": "e1"}, tasks, meta
    ) == ["t1", "t2"]
    assert late_tasks_for_milestone({**ms, "date": "2030-01-30"}, tasks, meta) == []


# ----------------------------------------------------------------------------- API


async def _client(app: object, proj: str, user: str) -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")  # type: ignore[arg-type]
    await c.__aenter__()
    attach_csrf_hook(c)
    await login_client(c, proj, user, PW)
    return c


async def test_schedule_drafts_versions_and_milestones(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    app, admin, proj, _ = test_app
    base = f"/api/v1/projects/{proj}"
    roles = {r["name"]: r["id"] for r in (await admin.get(f"{base}/roles")).json()}
    depts = {d["name"]: d for d in (await admin.get(f"{base}/departments")).json()}
    mod = depts["Modeling"]
    vendor = (
        await admin.post(
            f"{base}/companies",
            json={
                "name": "Ext",
                "short_code": "EXT",
                "kind": "external",
                "department_ids": [depts["FX"]["id"]],
            },
        )
    ).json()
    cli_co = (
        await admin.post(
            f"{base}/companies", json={"name": "Cli", "short_code": "CLI", "kind": "client"}
        )
    ).json()
    users: dict[str, Any] = {}
    for name, role, company in (
        ("prod_s", "producer", None),
        ("sup_s", "supervisor", None),
        ("lead_s", "lead", None),
        ("art_s", "artist", None),
        ("ext_s", "external", vendor["id"]),
        ("cli_s", "client", cli_co["id"]),
    ):
        r = await admin.post(
            f"{base}/users",
            json={
                "username": name,
                "full_name": name.upper(),
                "password": PW,
                "role_id": roles[role],
                "company_id": company,
                "must_change_password": False,
                "department_ids": [depts["FX"]["id"]] if role == "external" else [],
            },
        )
        assert r.status_code == 201, r.text
        users[name] = r.json()
    for n in ("shA", "shB"):
        await admin.post(f"{base}/entities", json={"name": n, "department_ids": [mod["id"]]})
    tree = (await admin.get(f"{base}/entities")).json()["entities"]
    t_a = next(e for e in tree if e["name"] == "shA")["departments"][0]["tasks"][0]["id"]
    t_b = next(e for e in tree if e["name"] == "shB")["departments"][0]["tasks"][0]["id"]
    for t in (t_a, t_b):
        await admin.patch(
            f"{base}/tasks/{t}",
            json={"ideal_start_date": "2030-01-07", "ideal_finish_date": "2030-01-11"},
        )
    # Supervisor capacity on task A gives task.edit_schedule there.
    await admin.put(
        f"{base}/tasks/{t_a}/assignments",
        json={"assignments": [{"user_id": users["sup_s"]["id"], "assignment_role": "supervisor"}]},
    )

    async def task_dates(task_id: str) -> tuple[str, str]:
        d = (await admin.get(f"{base}/tasks/{task_id}")).json()
        return d["ideal_start_date"], d["ideal_finish_date"]

    # --- draft isolation: admin's edits stay out of live data and other users' drafts
    ms_id = str(uuid.uuid4())
    r = await admin.post(
        f"{base}/schedule/draft/changes",
        json={
            "changes": [
                {
                    "kind": "task",
                    "op": "update",
                    "target_id": t_a,
                    "payload": {"start": "2030-01-14", "finish": "2030-01-16"},
                },
                {
                    "kind": "task",
                    "op": "update",
                    "target_id": t_a,
                    "payload": {"finish": "2030-01-18"},
                },
                {
                    "kind": "milestone",
                    "op": "create",
                    "target_id": ms_id,
                    "payload": {
                        "name": "Layout lock",
                        "date": "2030-01-16",
                        "kind": "milestone",
                        "target_kind": "department",
                        "target_id": mod["id"],
                    },
                },
            ]
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 2  # two edits on task A merged into one change
    assert await task_dates(t_a) == ("2030-01-07", "2030-01-11")
    assert (await admin.get(f"{base}/milestones")).json() == []
    prod = await _client(app, proj, "prod_s")
    sup = await _client(app, proj, "sup_s")
    lead = await _client(app, proj, "lead_s")
    art = await _client(app, proj, "art_s")
    ext = await _client(app, proj, "ext_s")
    cli = await _client(app, proj, "cli_s")
    try:
        assert (await prod.get(f"{base}/schedule/draft")).json()["count"] == 0

        preview = (await admin.get(f"{base}/schedule/draft/preview")).json()
        assert preview["summary"] == {"tasks": 1, "milestones": 1, "activations": 0, "total": 2}
        assert preview["conflicts"] == [] and preview["can_save"] is True

        # Comment required.
        assert (
            await admin.post(f"{base}/schedule/draft/save", json={"comment": ""})
        ).status_code == 422
        s1 = await admin.post(f"{base}/schedule/draft/save", json={"comment": "First plan"})
        assert s1.status_code == 201, s1.text
        v1 = s1.json()
        assert v1["label"] == "S0001" and v1["diff_summary"]["changes"] == 2
        assert await task_dates(t_a) == ("2030-01-14", "2030-01-18")
        milestones = (await admin.get(f"{base}/milestones")).json()
        assert [m["name"] for m in milestones] == ["Layout lock"]
        assert milestones[0]["late_task_ids"] == [t_a]  # finishes 18th, milestone 16th
        assert (await admin.get(f"{base}/schedule/draft")).json()["count"] == 0

        # --- second version, then jump back to S0001 (as a new draft) and save it
        await admin.post(
            f"{base}/schedule/draft/changes",
            json={
                "changes": [
                    {
                        "kind": "task",
                        "op": "update",
                        "target_id": t_a,
                        "payload": {"start": "2030-02-01", "finish": "2030-02-05"},
                    },
                    {"kind": "milestone", "op": "delete", "target_id": ms_id, "payload": {}},
                ]
            },
        )
        v2 = (
            await admin.post(f"{base}/schedule/draft/save", json={"comment": "Slip a month"})
        ).json()
        assert v2["label"] == "S0002"
        versions = (await admin.get(f"{base}/schedule/versions")).json()
        assert [(v["label"], v["is_current"]) for v in versions] == [
            ("S0002", True),
            ("S0001", False),
        ]

        jumped = await admin.post(f"{base}/schedule/versions/{v1['id']}/jump")
        assert jumped.status_code == 200, jumped.text
        assert jumped.json()["base_version_label"] == "S0001"
        assert jumped.json()["count"] == 2  # restore task dates + re-create milestone
        assert await task_dates(t_a) == ("2030-02-01", "2030-02-05")  # nothing destroyed
        v3 = (
            await admin.post(f"{base}/schedule/draft/save", json={"comment": "Back to first plan"})
        ).json()
        assert await task_dates(t_a) == ("2030-01-14", "2030-01-18")
        assert [m["id"] for m in (await admin.get(f"{base}/milestones")).json()] == [ms_id]
        versions = (await admin.get(f"{base}/schedule/versions")).json()
        assert [v["label"] for v in versions if v["is_current"]] == ["S0003"]
        cmp = (await admin.get(f"{base}/schedule/versions/compare?a={v1['id']}&b=live")).json()
        assert cmp["diff"] == []
        cmp2 = (
            await admin.get(f"{base}/schedule/versions/compare?a={v2['id']}&b={v3['id']}")
        ).json()
        assert cmp2["summary"]["tasks"] == 1 and cmp2["summary"]["milestones"] == 1

        # --- star: at most one baseline
        await admin.post(f"{base}/schedule/versions/{v1['id']}/star", json={"starred": True})
        await prod.post(f"{base}/schedule/versions/{v2['id']}/star", json={"starred": True})
        starred = [
            v["label"]
            for v in (await admin.get(f"{base}/schedule/versions")).json()
            if v["is_starred"]
        ]
        assert starred == ["S0002"]

        # --- conflict: live changes after the draft started are detected at save time
        await admin.post(
            f"{base}/schedule/draft/changes",
            json={
                "changes": [
                    {
                        "kind": "task",
                        "op": "update",
                        "target_id": t_b,
                        "payload": {"finish": "2030-01-20"},
                    }
                ]
            },
        )
        await prod.patch(f"{base}/tasks/{t_b}", json={"ideal_finish_date": "2030-01-15"})
        conflict = await admin.post(f"{base}/schedule/draft/save", json={"comment": "x"})
        assert conflict.status_code == 409
        details = conflict.json()["error"]["details"]
        assert details[0]["fields"] == {"finish": ["2030-01-11", "2030-01-15"]}
        assert (await admin.get(f"{base}/schedule/draft/preview")).json()["conflicts"]
        forced = await admin.post(
            f"{base}/schedule/draft/save",
            json={"comment": "mine wins", "overwrite_conflicts": True},
        )
        assert forced.status_code == 201
        assert await task_dates(t_b) == ("2030-01-07", "2030-01-20")

        # --- per-change revert and discard
        d = (
            await admin.post(
                f"{base}/schedule/draft/changes",
                json={
                    "changes": [
                        {
                            "kind": "task",
                            "op": "update",
                            "target_id": t_b,
                            "payload": {"start": "2030-01-08"},
                        },
                        {
                            "kind": "task",
                            "op": "update",
                            "target_id": t_a,
                            "payload": {"start": "2030-01-15"},
                        },
                    ]
                },
            )
        ).json()
        reverted = (
            await admin.delete(f"{base}/schedule/draft/changes/{d['changes'][0]['id']}")
        ).json()
        assert reverted["count"] == 1
        assert (await admin.delete(f"{base}/schedule/draft")).status_code == 204
        assert (await admin.get(f"{base}/schedule/draft")).json()["count"] == 0

        # --- permissions
        # Artist: no task.edit_schedule on task B -> cannot even draft it.
        assert (
            await art.post(
                f"{base}/schedule/draft/changes",
                json={
                    "changes": [
                        {
                            "kind": "task",
                            "op": "update",
                            "target_id": t_b,
                            "payload": {"start": "2030-01-09"},
                        }
                    ]
                },
            )
        ).status_code == 403
        # Supervisor: edits task A via capacity and saves (schedule.version default) ...
        assert (
            await sup.post(
                f"{base}/schedule/draft/changes",
                json={
                    "changes": [
                        {
                            "kind": "task",
                            "op": "update",
                            "target_id": t_a,
                            "payload": {"start": "2030-01-13"},
                        }
                    ]
                },
            )
        ).status_code == 200
        assert (
            await sup.post(f"{base}/schedule/draft/save", json={"comment": "sup tweak"})
        ).status_code == 201
        # ... but cannot create milestones (milestone.edit: producer/admin by default).
        assert (
            await sup.post(
                f"{base}/schedule/draft/changes",
                json={
                    "changes": [
                        {
                            "kind": "milestone",
                            "op": "create",
                            "target_id": str(uuid.uuid4()),
                            "payload": {"name": "x", "date": "2030-01-01"},
                        }
                    ]
                },
            )
        ).status_code == 403
        # Lead without schedule.version cannot save or star.
        assert (
            await lead.post(f"{base}/schedule/draft/save", json={"comment": "nope"})
        ).status_code == 403
        assert (
            await lead.post(f"{base}/schedule/versions/{v1['id']}/star", json={"starred": True})
        ).status_code == 403
        # Producer creates a client-visible deliver date directly.
        shared = await prod.post(
            f"{base}/milestones",
            json={
                "name": "Final delivery",
                "date": "2030-03-01",
                "kind": "deliver",
                "client_visible": True,
            },
        )
        assert shared.status_code == 201, shared.text
        bad_target = await prod.post(
            f"{base}/milestones",
            json={
                "name": "x",
                "date": "2030-03-01",
                "target_kind": "task",
                "target_id": str(uuid.uuid4()),
            },
        )
        assert bad_target.status_code == 404

        # Client: no drafts/versions; sees only shared milestones and no task ids.
        assert (await cli.get(f"{base}/schedule/draft")).status_code == 403
        assert (await cli.get(f"{base}/schedule/versions")).status_code == 403
        assert (
            await cli.post(
                f"{base}/schedule/draft/changes",
                json={
                    "changes": [
                        {
                            "kind": "task",
                            "op": "update",
                            "target_id": t_a,
                            "payload": {"start": "2030-01-09"},
                        }
                    ]
                },
            )
        ).status_code == 403
        cli_ms = (await cli.get(f"{base}/milestones")).json()
        assert [m["name"] for m in cli_ms] == ["Final delivery"]
        assert all(m["late_task_ids"] == [] for m in cli_ms)
        # External: version compare hides tasks outside its scope.
        ext_cmp = (
            await ext.get(f"{base}/schedule/versions/compare?a={v1['id']}&b={v2['id']}")
        ).json()
        assert all(i["kind"] != "task" for i in ext_cmp["diff"])
        admin_cmp = (
            await admin.get(f"{base}/schedule/versions/compare?a={v1['id']}&b={v2['id']}")
        ).json()
        assert any(i["kind"] == "task" for i in admin_cmp["diff"])
    finally:
        for c in (prod, sup, lead, art, ext, cli):
            await c.__aexit__(None, None, None)

    audit = {a["action"] for a in (await admin.get(f"{base}/admin/audit")).json()}
    assert {"schedule.version.save", "schedule.version.star", "milestone.create"} <= audit
