"""CR04 §3 Confo: typed columns, validation, cell edits, CSV import and permissions."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.models.confo import ConfoColumn
from app.services.confo_service import (
    CellError,
    LookupContext,
    guess_identity,
    guess_mapping,
    parse_cell,
    read_csv,
)
from tests.conftest import attach_csrf_hook, login_client

STRONG_PW = "ConfoPass1234!"


def _col(col_type: str, **kw: Any) -> ConfoColumn:
    return ConfoColumn(
        key="c",
        label="C",
        col_type=col_type,
        options_json=kw.pop("options", []),
        validation_json=kw.pop("validation", {}),
        edit_roles=[],
        **kw,
    )


# ----------------------------------------------------------------------------- unit: parsing


@pytest.mark.parametrize(
    ("col_type", "raw", "expected"),
    [
        ("text", "  hello ", "hello"),
        ("integer", "1 200", 1200),
        ("integer", "3.0", 3),
        ("float", "3,5", 3.5),
        ("float", 2, 2.0),
        ("boolean", "Sí", True),
        ("boolean", "no", False),
        ("boolean", "x", True),
        ("date", "2026-12-01", date(2026, 12, 1)),
        ("date", "01/12/2026", date(2026, 12, 1)),
        ("url", "example.com/a", "https://example.com/a"),
        ("color", "#ABC", "#aabbcc"),
        ("text", "", None),
    ],
)
def test_parse_cell_types(col_type: str, raw: Any, expected: Any) -> None:
    assert parse_cell(_col(col_type), raw, LookupContext()) == expected


@pytest.mark.parametrize(
    ("col_type", "raw", "message"),
    [
        ("integer", "2.5", "whole number"),
        ("integer", "abc", "whole number"),
        ("float", "x1", "Not a number"),
        ("boolean", "maybe", "yes/no"),
        ("date", "31/31/2026", "Not a date"),
        ("url", "not a url", "web address"),
        ("color", "red", "colour"),
        ("user", "ghost", "Unknown user"),
        ("entity", "nowhere", "Unknown entity"),
    ],
)
def test_parse_cell_errors(col_type: str, raw: Any, message: str) -> None:
    with pytest.raises(CellError, match=message):
        parse_cell(_col(col_type), raw, LookupContext())


def test_select_multiselect_and_validation_rules() -> None:
    sel = _col("select", options=["Low", "High"])
    assert parse_cell(sel, "high", LookupContext()) == "High"
    with pytest.raises(CellError, match="not an option"):
        parse_cell(sel, "medium", LookupContext())
    multi = _col("multiselect", options=["2D", "3D", "Comp"])
    assert parse_cell(multi, "3d; comp, 3D", LookupContext()) == ["3D", "Comp"]
    with pytest.raises(CellError):
        parse_cell(multi, "2D, 4D", LookupContext())
    ranged = _col("integer", validation={"min": 0, "max": 10, "required": True})
    with pytest.raises(CellError, match="at most 10"):
        parse_cell(ranged, "11", LookupContext())
    with pytest.raises(CellError, match="Required"):
        parse_cell(ranged, " ", LookupContext())
    pattern = _col("text", validation={"regex": r"[A-Z]{3}\d+", "max_length": 6})
    assert parse_cell(pattern, "ABC12", LookupContext()) == "ABC12"
    with pytest.raises(CellError, match="pattern"):
        parse_cell(pattern, "abc12", LookupContext())
    with pytest.raises(CellError, match="Longer"):
        parse_cell(pattern, "ABC1234", LookupContext())


def test_csv_reading_and_guessing() -> None:
    headers, rows = read_csv("﻿Entity;Camera Movement;2D VFX\nsh010;pan;yes\n\n")
    assert headers == ["Entity", "Camera Movement", "2D VFX"]
    assert rows == [["sh010", "pan", "yes"]]
    assert guess_identity(["Name", "Path", "x"]) == ("path", "Path")
    assert guess_identity(["uuid", "Path"]) == ("id", "uuid")
    cols = [
        ConfoColumn(key="camera_movement", label="Camera", col_type="text"),
        ConfoColumn(key="vfx_2d", label="2D VFX", col_type="boolean"),
    ]
    assert guess_mapping(headers, cols) == {
        "Entity": None,
        "Camera Movement": "camera_movement",
        "2D VFX": "vfx_2d",
    }


# ----------------------------------------------------------------------------- API


async def _client(app: object, proj: str, user: str) -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")  # type: ignore[arg-type]
    await c.__aenter__()
    attach_csrf_hook(c)
    await login_client(c, proj, user, STRONG_PW)
    return c


async def _setup(admin: AsyncClient, base: str) -> dict[str, Any]:
    depts = {d["name"]: d for d in (await admin.get(f"{base}/departments")).json()}
    mod, fx = depts["Modeling"], depts["FX"]
    folder = await admin.post(f"{base}/folders", json={"name": "seq010", "parent_rel_path": ""})
    assert folder.status_code == 201, folder.text
    ents: dict[str, Any] = {}
    for name, parent, dept in (
        ("sh010", "", mod),
        ("sh020", "", fx),
        ("dup", "", mod),
        ("dup", "seq010", mod),
    ):
        r = await admin.post(
            f"{base}/entities",
            json={"name": name, "parent_rel_path": parent, "department_ids": [dept["id"]]},
        )
        assert r.status_code == 201, r.text
        ents[f"{parent}/{name}".strip("/")] = r.json()
    roles = {r["name"]: r["id"] for r in (await admin.get(f"{base}/roles")).json()}
    vendor = (
        await admin.post(
            f"{base}/companies",
            json={
                "name": "FX Co",
                "short_code": "FXC",
                "kind": "external",
                "department_ids": [fx["id"]],
            },
        )
    ).json()
    client_co = (
        await admin.post(
            f"{base}/companies", json={"name": "Cli", "short_code": "CLI", "kind": "external"}
        )
    ).json()
    users: dict[str, Any] = {}
    for uname, role, company in (
        ("prod_c", "producer", None),
        ("art_c", "artist", None),
        ("ext_c", "external", vendor["id"]),
        ("cli_c", "client", client_co["id"]),
    ):
        r = await admin.post(
            f"{base}/users",
            json={
                "username": uname,
                "full_name": uname.upper(),
                "password": STRONG_PW,
                "role_id": roles[role],
                "company_id": company,
                "department_ids": [fx["id"]] if role == "external" else [],
                "must_change_password": False,
            },
        )
        assert r.status_code == 201, r.text
        users[uname] = r.json()
    # Artist is assigned only to sh010's task.
    tree = (await admin.get(f"{base}/entities")).json()["entities"]
    sh010 = next(e for e in tree if e["rel_path"] == "sh010")
    task_id = sh010["departments"][0]["tasks"][0]["id"]
    assigned = await admin.put(
        f"{base}/tasks/{task_id}/assignments",
        json={"assignments": [{"user_id": users["art_c"]["id"], "assignment_role": "artist"}]},
    )
    assert assigned.status_code == 200, assigned.text
    return {"ents": ents, "roles": roles, "users": users}


async def test_confo_columns_cells_import_and_permissions(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    app, admin, proj, _ = test_app
    base = f"/api/v1/projects/{proj}"
    ctx = await _setup(admin, base)
    ents = ctx["ents"]

    # --- columns of every type
    defs: list[dict[str, Any]] = [
        {
            "key": "camera_movement",
            "label": "Camera",
            "col_type": "select",
            "options": ["static", "pan", "dolly"],
        },
        {"key": "vfx_2d", "label": "2D VFX", "col_type": "boolean", "default_text": "no"},
        {
            "key": "frames",
            "label": "Frames",
            "col_type": "integer",
            "validation": {"min": 1, "max": 5000},
        },
        {"key": "ratio", "label": "Ratio", "col_type": "float"},
        {
            "key": "layers",
            "label": "Layers",
            "col_type": "multiselect",
            "options": ["bg", "fg", "fx"],
        },
        {"key": "due", "label": "Due", "col_type": "date"},
        {"key": "ref", "label": "Ref", "col_type": "url"},
        {"key": "owner", "label": "Owner", "col_type": "user"},
        {"key": "tint", "label": "Tint", "col_type": "color"},
        {"key": "parent", "label": "Parent", "col_type": "entity"},
        {"key": "notes", "label": "Notes", "col_type": "text", "edit_roles": ["admin"]},
    ]
    for d in defs:
        r = await admin.post(f"{base}/confo/columns", json=d)
        assert r.status_code == 201, r.text
    assert (await admin.post(f"{base}/confo/columns", json=defs[0])).status_code == 409
    bad = await admin.post(
        f"{base}/confo/columns", json={"key": "Bad Key", "label": "x", "col_type": "text"}
    )
    assert bad.status_code == 400
    no_opts = await admin.post(
        f"{base}/confo/columns", json={"key": "s2", "label": "x", "col_type": "select"}
    )
    assert no_opts.status_code == 400

    sh010 = ents["sh010"]["id"]
    sh020 = ents["sh020"]["id"]

    # --- valid batch
    ok = await admin.patch(
        f"{base}/confo/cells",
        json={
            "changes": [
                {"entity_id": sh010, "column_key": "camera_movement", "value": "PAN"},
                {"entity_id": sh010, "column_key": "frames", "value": "120"},
                {"entity_id": sh010, "column_key": "layers", "value": "fg, bg"},
                {"entity_id": sh010, "column_key": "due", "value": "05/01/2027"},
                {"entity_id": sh010, "column_key": "owner", "value": "art_c"},
                {"entity_id": sh010, "column_key": "parent", "value": "sh020"},
                {"entity_id": sh010, "column_key": "tint", "value": "#f00"},
            ]
        },
    )
    assert ok.status_code == 200, ok.text
    assert len(ok.json()["applied"]) == 7

    grid = (await admin.get(f"{base}/confo")).json()
    row = next(r for r in grid["rows"] if r["entity_id"] == sh010)
    assert row["values"]["camera_movement"] == "pan"
    assert row["values"]["frames"] == 120
    assert row["values"]["layers"] == ["fg", "bg"]
    assert row["values"]["due"] == "2027-01-05"
    assert row["values"]["owner"] == ctx["users"]["art_c"]["id"]
    assert row["values"]["tint"] == "#ff0000"
    assert row["values"]["vfx_2d"] is False  # default applies to unset cells
    assert grid["can_manage"] is True

    # --- all-or-nothing with per-cell errors
    bad_batch = await admin.patch(
        f"{base}/confo/cells",
        json={
            "changes": [
                {"entity_id": sh020, "column_key": "frames", "value": "10"},
                {"entity_id": sh020, "column_key": "frames", "value": "99999"},
                {"entity_id": sh020, "column_key": "camera_movement", "value": "crane"},
            ]
        },
    )
    assert bad_batch.status_code == 422
    details = bad_batch.json()["error"]["details"]
    assert {d["column_key"] for d in details} == {"frames", "camera_movement"}
    grid = (await admin.get(f"{base}/confo")).json()
    assert "frames" not in next(r for r in grid["rows"] if r["entity_id"] == sh020)["values"]

    # Clearing a value and audit trail
    cleared = await admin.patch(
        f"{base}/confo/cells",
        json={"changes": [{"entity_id": sh010, "column_key": "frames", "value": None}]},
    )
    assert cleared.json()["applied"][0]["before"] == 120
    audit = (await admin.get(f"{base}/admin/audit")).json()
    assert any(a["action"] == "confo.cells.update" for a in audit)

    # --- rename / type lock / delete / restore / purge
    cols = {c["key"]: c for c in grid["columns"]}
    renamed = await admin.patch(
        f"{base}/confo/columns/{cols['camera_movement']['id']}",
        json={"key": "cam_move", "label": "Camera move"},
    )
    assert renamed.status_code == 200 and renamed.json()["key"] == "cam_move"
    locked = await admin.patch(
        f"{base}/confo/columns/{cols['tint']['id']}", json={"col_type": "text"}
    )
    assert locked.status_code == 409
    assert (await admin.delete(f"{base}/confo/columns/{cols['tint']['id']}")).status_code == 204
    trash = (await admin.get(f"{base}/confo/columns/trash")).json()
    assert [c["key"] for c in trash] == ["tint"]
    assert "tint" not in {c["key"] for c in (await admin.get(f"{base}/confo")).json()["columns"]}
    reuse = await admin.post(
        f"{base}/confo/columns", json={"key": "tint", "label": "x", "col_type": "text"}
    )
    assert reuse.status_code == 409
    restored = await admin.post(f"{base}/confo/columns/{cols['tint']['id']}/restore")
    assert restored.status_code == 200
    grid = (await admin.get(f"{base}/confo")).json()
    assert next(r for r in grid["rows"] if r["entity_id"] == sh010)["values"]["tint"] == "#ff0000"
    await admin.delete(f"{base}/confo/columns/{cols['ratio']['id']}")
    assert (
        await admin.delete(f"{base}/confo/columns/{cols['ratio']['id']}/purge")
    ).status_code == 204

    # --- CSV import: preview matching (name, path, ambiguous, unmatched, duplicate)
    csv_text = (
        "Entity,Camera move,Frames,Stage\n"
        "sh010,dolly,48,new\n"
        "sh020,static,oops,new\n"
        "dup,pan,10,x\n"
        "ghost,pan,10,x\n"
        "SH010,pan,1,x\n"
    )
    pv = await admin.post(f"{base}/confo/import/preview", json={"csv_text": csv_text})
    assert pv.status_code == 200, pv.text
    prev = pv.json()
    assert prev["match_by"] == "name" and prev["match_header"] == "Entity"
    statuses = [r["status"] for r in prev["rows"]]
    assert statuses == ["matched", "matched", "ambiguous", "unmatched", "duplicate"]
    mapping = {m["header"]: m["target_key"] for m in prev["mapping"]}
    assert mapping == {"Camera move": "cam_move", "Frames": "frames", "Stage": None}
    assert any(e["line"] == 3 and e["column_key"] == "frames" for e in prev["errors"])

    # Commit refuses while there are errors, and writes nothing.
    refused = await admin.post(f"{base}/confo/import/commit", json={"csv_text": csv_text})
    assert refused.status_code == 422
    assert len(refused.json()["error"]["details"]) == len(prev["errors"])
    grid = (await admin.get(f"{base}/confo")).json()
    assert next(r for r in grid["rows"] if r["entity_id"] == sh010)["values"]["cam_move"] == "pan"

    # Path matching + new column + create missing entity (explicit opt-in).
    path_csv = (
        "path,Camera move,Stage\nseq010/dup,dolly,layout\nsh020,,anim\nseq010/sh030,static,layout\n"
    )
    plan_body = {
        "csv_text": path_csv,
        "mapping": [
            {"header": "Camera move", "target_key": "cam_move"},
            {
                "header": "Stage",
                "target_key": "stage",
                "new_label": "Stage",
                "new_type": "select",
                "new_options": ["layout", "anim"],
            },
        ],
    }
    no_create = (await admin.post(f"{base}/confo/import/preview", json=plan_body)).json()
    assert [r["status"] for r in no_create["rows"]] == ["matched", "matched", "unmatched"]
    created = await admin.post(
        f"{base}/confo/import/commit", json={**plan_body, "create_missing": True}
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["created_entities"] == 1 and body["created_columns"] == ["stage"]
    grid = (await admin.get(f"{base}/confo")).json()
    by_path = {r["rel_path"]: r for r in grid["rows"]}
    assert by_path["seq010/sh030"]["values"] == {
        "cam_move": "static",
        "stage": "layout",
        "vfx_2d": False,
    }
    assert by_path["seq010/dup"]["values"]["cam_move"] == "dolly"
    assert by_path["sh020"]["values"]["stage"] == "anim"
    assert "cam_move" not in by_path["sh020"]["values"]  # empty cell left unchanged

    # --- permissions & leakage probes
    prod = await _client(app, proj, "prod_c")
    art = await _client(app, proj, "art_c")
    ext = await _client(app, proj, "ext_c")
    cli = await _client(app, proj, "cli_c")
    try:
        # Producer edits by default; cannot edit an admin-only column.
        assert (
            await prod.patch(
                f"{base}/confo/cells",
                json={"changes": [{"entity_id": sh020, "column_key": "frames", "value": 7}]},
            )
        ).status_code == 200
        notes = await prod.patch(
            f"{base}/confo/cells",
            json={"changes": [{"entity_id": sh020, "column_key": "notes", "value": "x"}]},
        )
        assert notes.status_code == 422
        assert "cannot edit" in notes.json()["error"]["details"][0]["message"]

        # Artist sees only entities with a visible task, cannot edit or manage.
        art_grid = (await art.get(f"{base}/confo")).json()
        assert [r["rel_path"] for r in art_grid["rows"]] == ["sh010"]
        assert art_grid["can_edit"] is False and art_grid["can_manage"] is False
        assert (
            await art.patch(
                f"{base}/confo/cells",
                json={"changes": [{"entity_id": sh010, "column_key": "frames", "value": 1}]},
            )
        ).status_code == 403
        assert (await art.get(f"{base}/confo/columns/trash")).status_code == 403
        assert (
            await art.post(f"{base}/confo/import/preview", json={"csv_text": csv_text})
        ).status_code == 403

        # External sees only its company's department entities.
        ext_rows = [r["rel_path"] for r in (await ext.get(f"{base}/confo")).json()["rows"]]
        assert ext_rows == ["sh020"]

        # Client: no Confo at all, no import, no cell writes.
        assert (await cli.get(f"{base}/confo")).status_code == 403
        assert (
            await cli.patch(
                f"{base}/confo/cells",
                json={"changes": [{"entity_id": sh020, "column_key": "frames", "value": 1}]},
            )
        ).status_code == 403
        assert (
            await cli.post(f"{base}/confo/import/preview", json={"csv_text": csv_text})
        ).status_code == 403

        # Grant artist confo.edit (scoped): may edit visible rows only, never manage columns.
        art_role = next(
            r for r in (await admin.get(f"{base}/roles")).json() if r["name"] == "artist"
        )
        new_perms = dict(art_role["permissions"])
        new_perms["confo.edit"] = "mine"
        assert (
            await admin.put(
                f"{base}/roles/{art_role['id']}/permissions", json={"permissions": new_perms}
            )
        ).status_code == 200
        art2 = await _client(app, proj, "art_c")
        try:
            assert (
                await art2.patch(
                    f"{base}/confo/cells",
                    json={"changes": [{"entity_id": sh010, "column_key": "frames", "value": 3}]},
                )
            ).status_code == 200
            hidden = await art2.patch(
                f"{base}/confo/cells",
                json={"changes": [{"entity_id": sh020, "column_key": "frames", "value": 3}]},
            )
            assert hidden.status_code == 422
            assert "not visible" in hidden.json()["error"]["details"][0]["message"]
            assert (
                await art2.post(
                    f"{base}/confo/columns", json={"key": "zz", "label": "z", "col_type": "text"}
                )
            ).status_code == 403
        finally:
            await art2.__aexit__(None, None, None)
    finally:
        for c in (prod, art, ext, cli):
            await c.__aexit__(None, None, None)


async def test_confo_edit_permission_seeded_for_existing_projects(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, admin, proj, _ = test_app
    roles = {r["name"]: r for r in (await admin.get(f"/api/v1/projects/{proj}/roles")).json()}
    assert roles["producer"]["permissions"]["confo.edit"] == "all"
    assert roles["artist"]["permissions"]["confo.edit"] == "none"
