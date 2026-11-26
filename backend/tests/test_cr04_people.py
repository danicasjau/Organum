"""CR04 §6/§8/§11: working hours, activation periods, studios (comments, members)."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.errors import AppError
from app.services.availability import (
    WeekSchedule,
    active_on,
    covers,
    default_schedule,
    merge_ranges,
    parse_hhmm,
    validate_intervals,
)
from tests.conftest import attach_csrf_hook, login_client

PW = "PeoplePass1234!"
D = date.fromisoformat


# ----------------------------------------------------------------------------- unit


def test_default_schedule_and_capacity() -> None:
    s = default_schedule([1, 2, 3, 4, 5], 8.0)
    assert s.is_default
    assert s.weekly[1] == [(540, 1020)]  # 09:00-17:00
    assert 6 not in s.weekly
    assert s.hours_on(D("2026-11-30")) == 8.0  # Monday
    assert s.hours_on(D("2026-11-28")) == 0.0  # Saturday
    assert s.average_daily_hours() == 8.0


def test_week_schedule_exceptions_and_average() -> None:
    s = WeekSchedule(weekly={1: [(540, 780), (840, 1080)], 5: [(600, 840)]})
    assert s.hours_on(D("2026-11-30")) == 8.0
    assert s.hours_on(D("2026-12-04")) == 4.0
    assert s.average_daily_hours() == 6.0
    s.exceptions[D("2026-11-30")] = []  # day off
    s.exceptions[D("2026-12-04")] = [(540, 1140)]  # special long day
    assert s.hours_on(D("2026-11-30")) == 0.0
    assert s.hours_on(D("2026-12-04")) == 10.0


def test_interval_validation() -> None:
    assert parse_hhmm("9:30") == 570
    assert parse_hhmm("24:00") == 1440
    for bad in ("25:00", "9", "10:75"):
        with pytest.raises(AppError):
            parse_hhmm(bad)
    assert validate_intervals([(780, 900), (540, 720)], "x") == [(540, 720), (780, 900)]
    with pytest.raises(AppError, match="overlap"):
        validate_intervals([(540, 720), (700, 800)], "x")
    with pytest.raises(AppError, match="start must be before end"):
        validate_intervals([(600, 600)], "x")


def test_activation_coverage() -> None:
    periods = [(D("2026-01-01"), D("2026-01-31")), (D("2026-02-01"), D("2026-02-10"))]
    assert merge_ranges(periods) == [(D("2026-01-01"), D("2026-02-10"))]
    assert covers(periods, D("2026-01-20"), D("2026-02-05"))
    assert not covers(periods, D("2026-02-05"), D("2026-02-12"))
    assert covers([], D("2020-01-01"), D("2030-01-01"))  # no periods = always active
    assert active_on(periods, D("2026-01-15"))
    assert not active_on(periods, D("2026-03-01"))
    gap = [(D("2026-01-01"), D("2026-01-10")), (D("2026-01-15"), D("2026-01-31"))]
    assert not covers(gap, D("2026-01-05"), D("2026-01-20"))


# ----------------------------------------------------------------------------- API


async def _client(app: object, proj: str, user: str) -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")  # type: ignore[arg-type]
    await c.__aenter__()
    attach_csrf_hook(c)
    await login_client(c, proj, user, PW)
    return c


async def test_people_scheduling_api(test_app: tuple[object, AsyncClient, str, Path]) -> None:
    app, admin, proj, _ = test_app
    base = f"/api/v1/projects/{proj}"
    roles = {r["name"]: r["id"] for r in (await admin.get(f"{base}/roles")).json()}
    depts = {d["name"]: d for d in (await admin.get(f"{base}/departments")).json()}
    mod = depts["Modeling"]

    studio = await admin.post(
        f"{base}/companies",
        json={
            "name": "Studio A",
            "short_code": "STA",
            "kind": "internal",
            "department_ids": [mod["id"]],
        },
    )
    assert studio.status_code == 201, studio.text
    studio_id = studio.json()["id"]
    client_co = await admin.post(
        f"{base}/companies", json={"name": "Client Co", "short_code": "CLC", "kind": "client"}
    )
    assert client_co.status_code == 201 and client_co.json()["kind"] == "client"
    group = (
        await admin.post(
            f"{base}/companies",
            json={"name": "Dubbing Group", "short_code": "DUB", "kind": "group"},
        )
    ).json()

    users: dict[str, Any] = {}
    for name, role, company in (
        ("art_p", "artist", studio_id),
        ("art_q", "artist", None),
        ("lead_p", "lead", studio_id),
        ("cli_p", "client", client_co.json()["id"]),
    ):
        r = await admin.post(
            f"{base}/users",
            json={
                "username": name,
                "full_name": name.upper(),
                "password": PW,
                "role_id": roles[role],
                "company_id": company,
                "department_ids": [mod["id"]] if role != "client" else [],
                "must_change_password": False,
            },
        )
        assert r.status_code == 201, r.text
        users[name] = r.json()
    art_id = users["art_p"]["id"]

    # --- working hours: default from project calendar
    wh = (await admin.get(f"{base}/users/{art_id}/work-hours")).json()
    assert wh["is_default"] is True
    assert wh["weekly"][0] == {"weekday": 1, "intervals": [{"start": "09:00", "end": "17:00"}]}
    assert wh["weekly"][5]["intervals"] == []

    put = await admin.put(
        f"{base}/users/{art_id}/work-hours",
        json={
            "timezone": "Europe/Madrid",
            "weekly": [
                {
                    "weekday": 1,
                    "intervals": [
                        {"start": "09:00", "end": "13:00"},
                        {"start": "14:00", "end": "18:00"},
                    ],
                },
                {"weekday": 5, "intervals": [{"start": "10:00", "end": "14:00"}]},
            ],
            "exceptions": [
                {"day": "2030-01-07", "off": True, "note": "holiday"},
                {"day": "2030-01-11", "intervals": [{"start": "08:00", "end": "18:00"}]},
            ],
        },
    )
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["is_default"] is False and body["timezone"] == "Europe/Madrid"
    assert body["weekly_hours"] == 12.0
    assert body["daily_capacity_hours"] == 6.0  # derived: (8 + 4) / 2 working days
    assert [e["day"] for e in body["exceptions"]] == ["2030-01-07", "2030-01-11"]
    assert body["exceptions"][0]["off"] is True and body["exceptions"][0]["note"] == "holiday"
    me = (await admin.get(f"{base}/users/{art_id}")).json()
    assert me["daily_capacity_hours"] == 6.0

    overlap = await admin.put(
        f"{base}/users/{art_id}/work-hours",
        json={
            "weekly": [
                {
                    "weekday": 2,
                    "intervals": [
                        {"start": "09:00", "end": "12:00"},
                        {"start": "11:00", "end": "13:00"},
                    ],
                }
            ]
        },
    )
    assert overlap.status_code == 400
    bad_tz = await admin.put(f"{base}/users/{art_id}/work-hours", json={"timezone": "Mars/Olympus"})
    assert bad_tz.status_code == 400

    # --- activation periods for user, department and studio
    async def period(kind: str, tid: str, start: str, end: str) -> dict[str, Any]:
        r = await admin.post(
            f"{base}/activation-periods",
            json={
                "target_kind": kind,
                "target_id": tid,
                "start_date": start,
                "end_date": end,
                "note": f"{kind} window",
            },
        )
        assert r.status_code == 201, r.text
        return dict(r.json())

    p_user = await period("user", art_id, "2030-01-01", "2030-01-31")
    await period("department", mod["id"], "2030-01-01", "2030-12-31")
    p_studio = await period("company", studio_id, "2030-01-01", "2030-06-30")
    assert (
        await admin.post(
            f"{base}/activation-periods",
            json={
                "target_kind": "user",
                "target_id": art_id,
                "start_date": "2030-02-01",
                "end_date": "2030-01-01",
            },
        )
    ).status_code in (400, 422)
    listed = await admin.get(f"{base}/activation-periods?target_kind=user&target_id={art_id}")
    assert [p["id"] for p in listed.json()] == [p_user["id"]]
    upd = await admin.patch(
        f"{base}/activation-periods/{p_user['id']}", json={"end_date": "2030-02-15"}
    )
    assert upd.json()["end_date"] == "2030-02-15"

    # --- warnings: a task assigned to art_p scheduled outside the user's period
    await admin.post(f"{base}/entities", json={"name": "shotw", "department_ids": [mod["id"]]})
    tree = (await admin.get(f"{base}/entities")).json()["entities"]
    task = next(e for e in tree if e["name"] == "shotw")["departments"][0]["tasks"][0]
    await admin.put(
        f"{base}/tasks/{task['id']}/assignments",
        json={"assignments": [{"user_id": art_id, "assignment_role": "artist"}]},
    )
    await admin.patch(
        f"{base}/tasks/{task['id']}",
        json={"ideal_start_date": "2030-02-10", "ideal_finish_date": "2030-02-20"},
    )
    warns = (await admin.get(f"{base}/schedule/warnings?task_id={task['id']}")).json()
    assert [w["kind"] for w in warns] == ["user"]
    assert "ART_P" in warns[0]["message"]
    await admin.patch(
        f"{base}/tasks/{task['id']}",
        json={"ideal_start_date": "2030-01-08", "ideal_finish_date": "2030-01-20"},
    )
    assert (await admin.get(f"{base}/schedule/warnings?task_id={task['id']}")).json() == []
    await admin.patch(
        f"{base}/activation-periods/{p_studio['id']}", json={"end_date": "2030-01-10"}
    )
    warns = (await admin.get(f"{base}/schedule/warnings?task_id={task['id']}")).json()
    assert [w["kind"] for w in warns] == ["company"]

    # --- workload uses per-day capacity (exceptions + periods)
    wl = (await admin.get(f"{base}/workload?date_from=2030-01-07&date_to=2030-01-11")).json()
    row = next(r for r in wl["rows"] if r["user_id"] == art_id)
    caps = [c["capacity_hours"] for c in row["cells"]]
    assert caps == [0.0, 0.0, 0.0, 0.0, 10.0]  # Mon off; Tue-Thu no hours; Fri special
    wl2 = (await admin.get(f"{base}/workload?date_from=2030-03-04&date_to=2030-03-04")).json()
    row2 = next(r for r in wl2["rows"] if r["user_id"] == art_id)
    assert row2["cells"][0]["capacity_hours"] == 0.0  # outside the user's activation period

    # --- studio comments and linked members
    c1 = await admin.post(
        f"{base}/companies/{studio_id}/comments", json={"body": "Contract renewed until June"}
    )
    assert c1.status_code == 201 and c1.json()["author_name"]
    members = await admin.put(
        f"{base}/companies/{group['id']}/members",
        json={"user_ids": [art_id, users["art_q"]["id"]]},
    )
    assert sorted(members.json()["linked_user_ids"]) == sorted([art_id, users["art_q"]["id"]])
    studio_members = await admin.put(
        f"{base}/companies/{studio_id}/members", json={"user_ids": [art_id, users["art_q"]["id"]]}
    )
    assert studio_members.json()["linked_user_ids"] == [users["art_q"]["id"]]  # art_p is primary
    assert sorted(studio_members.json()["primary_user_ids"]) == sorted(
        [art_id, users["lead_p"]["id"]]
    )
    linked = (await admin.get(f"{base}/users/{art_id}/companies")).json()
    assert linked[0] == studio_id and group["id"] in linked

    # --- permissions
    art = await _client(app, proj, "art_p")
    lead = await _client(app, proj, "lead_p")
    cli = await _client(app, proj, "cli_p")
    try:
        # Self-service hours; not someone else's.
        own = await art.put(f"{base}/users/{art_id}/work-hours", json={"use_project_default": True})
        assert own.status_code == 200 and own.json()["is_default"] is True
        other = await art.put(
            f"{base}/users/{users['art_q']['id']}/work-hours", json={"use_project_default": True}
        )
        assert other.status_code == 403
        assert (await art.get(f"{base}/users/{users['art_q']['id']}/work-hours")).status_code == 403
        # Artist cannot edit activation periods; client cannot even read them.
        assert (
            await art.post(
                f"{base}/activation-periods",
                json={
                    "target_kind": "user",
                    "target_id": art_id,
                    "start_date": "2030-01-01",
                    "end_date": "2030-01-02",
                },
            )
        ).status_code == 403
        assert (await art.get(f"{base}/activation-periods")).status_code == 200
        assert (await cli.get(f"{base}/activation-periods")).status_code == 403
        assert (await cli.get(f"{base}/schedule/warnings")).status_code == 403
        assert (await cli.get(f"{base}/companies/{studio_id}/comments")).status_code == 403
        assert (await cli.get(f"{base}/users/{art_id}/work-hours")).status_code == 403
        # Lead can comment (user.view) but cannot delete someone else's note or link members.
        lc = await lead.post(f"{base}/companies/{studio_id}/comments", json={"body": "ok"})
        assert lc.status_code == 201
        assert (
            await lead.delete(f"{base}/companies/{studio_id}/comments/{c1.json()['id']}")
        ).status_code == 403
        assert (
            await lead.delete(f"{base}/companies/{studio_id}/comments/{lc.json()['id']}")
        ).status_code == 204
        assert (
            await lead.put(f"{base}/companies/{studio_id}/members", json={"user_ids": []})
        ).status_code == 403
        notes = (await lead.get(f"{base}/companies/{studio_id}/comments")).json()
        assert [n["body"] for n in notes] == ["Contract renewed until June"]
    finally:
        for c in (art, lead, cli):
            await c.__aexit__(None, None, None)

    # Delete a period (audited).
    assert (await admin.delete(f"{base}/activation-periods/{p_user['id']}")).status_code == 204
    audit = (await admin.get(f"{base}/admin/audit")).json()
    actions = {a["action"] for a in audit}
    assert {"activation.create", "activation.delete", "user.work_hours.update"} <= actions
