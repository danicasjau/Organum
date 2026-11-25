from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient
from PIL import Image

from tests.conftest import make_entity_product_dir, reconcile_files_map


@pytest.mark.asyncio
async def test_annotations_crud_and_frame_range(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, client, project_uuid, prod_root = test_app
    img_dir = make_entity_product_dir(prod_root, "prop", "Lighting", "render", "v0001")
    Image.new("RGB", (32, 32), (100, 150, 200)).save(img_dir / "frame.png")

    by_name = await reconcile_files_map(client, project_uuid)
    file_id = str(by_name["frame.png"]["id"])
    base = f"/api/v1/projects/{project_uuid}/files/{file_id}/annotations"

    create_resp = await client.post(
        base,
        json={
            "kind": "2d",
            "coord_space": "image",
            "frame_in": 12,
            "frame_out": 24,
            "time_base": 24.0,
            "note_text": "Fix specular highlight",
            "vector_json": [
                {"tool": "free", "color": "#8B5CF6", "size": 4, "points": [[1, 2], [5, 6]]}
            ],
        },
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["frame_in"] == 12
    assert created["frame_out"] == 24
    assert created["coord_space"] == "image"
    ann_id = created["id"]

    list_resp = await client.get(base)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    patch_resp = await client.patch(
        f"{base}/{ann_id}",
        json={"note_text": "Updated note", "frame_out": 30},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["note_text"] == "Updated note"
    assert patch_resp.json()["frame_out"] == 30

    del_resp = await client.delete(f"{base}/{ann_id}")
    assert del_resp.status_code == 204
    assert (await client.get(base)).json() == []
