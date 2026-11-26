"""CR04 phase A: role defaults exposed for the "only differences from default" filter."""

from __future__ import annotations

from pathlib import Path

from httpx import AsyncClient

from app.services.permissions import ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS


async def test_roles_expose_seeded_defaults_and_differences(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, admin_client, proj_uuid, _ = test_app
    base = f"/api/v1/projects/{proj_uuid}"
    roles = {r["name"]: r for r in (await admin_client.get(f"{base}/roles")).json()}

    artist = roles["artist"]
    assert artist["default_permissions"] is not None
    assert set(artist["default_permissions"]) == set(ALL_PERMISSION_KEYS)
    assert artist["default_permissions"]["task.view"] == DEFAULT_ROLE_PERMISSIONS["artist"][
        "task.view"
    ]
    # Freshly seeded project: live permissions equal the defaults.
    assert artist["permissions"] == artist["default_permissions"]

    # Change one scope: defaults stay put, so the difference is detectable.
    perms = dict(artist["permissions"])
    perms["views.gantt"] = "all"
    put = await admin_client.put(
        f"{base}/roles/{artist['id']}/permissions", json={"permissions": perms}
    )
    assert put.status_code == 200
    after = put.json()
    assert after["permissions"]["views.gantt"] == "all"
    assert after["default_permissions"]["views.gantt"] == "none"

    # Custom roles have no seeded defaults.
    custom = (
        await admin_client.post(f"{base}/roles", json={"name": "coord_x", "label": "Coord X"})
    ).json()
    assert custom["default_permissions"] is None
