from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_and_readyz(test_app: tuple[object, AsyncClient, str, Path]) -> None:
    _, client, _, _ = test_app
    r1 = await client.get("/healthz")
    assert r1.status_code == 200
    assert r1.json()["status"] == "ok"
    assert "X-Request-ID" in r1.headers

    r2 = await client.get("/readyz")
    assert r2.status_code == 200
    assert r2.json() == {"status": "ready", "database": "ok"}

    r3 = await client.get("/api/v1/health")
    assert r3.status_code == 200
    assert r3.json()["app"] == "ORGANUM"


@pytest.mark.asyncio
async def test_error_envelope_for_missing_file(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, client, project_uuid, _ = test_app
    resp = await client.get(
        f"/api/v1/projects/{project_uuid}/files/00000000-0000-0000-0000-000000000001/inspect"
    )
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["request_id"]
