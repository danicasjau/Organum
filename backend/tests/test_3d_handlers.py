from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient

from scripts.make_demo_data import _write_gltf, _write_obj_and_mtl, _write_usda
from tests.conftest import make_entity_product_dir, reconcile_files_map


@pytest.mark.asyncio
async def test_3d_handlers_inspect_and_derive_glb(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, client, project_uuid, prod_root = test_app
    model_dir = make_entity_product_dir(prod_root, "hero", "Modeling", "main", "v0001")

    _write_obj_and_mtl(model_dir)
    _write_gltf(model_dir)
    _write_usda(model_dir)

    by_name = await reconcile_files_map(client, project_uuid)
    base = f"/api/v1/projects/{project_uuid}"

    for fname in ("robot.obj", "robot.gltf", "robot.usda"):
        fid = str(by_name[fname]["id"])
        doc = (await client.get(f"{base}/files/{fid}/inspect")).json()
        assert doc["kind"] == "scene3d"
        assert doc["capabilities"]["scene_3d"] is True
        assert doc["capabilities"]["freeze_2d"] is True
        assert doc["capabilities"]["annotations_3d"] is True

        art1 = (await client.post(f"{base}/files/{fid}/artifacts/scene_glb", json={})).json()
        art2 = (await client.post(f"{base}/files/{fid}/artifacts/scene_glb", json={})).json()
        assert art1["id"] == art2["id"]
        assert art1["mime_type"] == "model/gltf-binary"

        glb_bytes = (await client.get(art1["content_url"])).content
        assert glb_bytes[:4] == b"glTF"

    usda_doc = (await client.get(f"{base}/files/{by_name['robot.usda']['id']}/inspect")).json()
    assert usda_doc["metadata"]["upAxis"] == "Y"
    assert usda_doc["metadata"]["metersPerUnit"] == 1.0
    assert len(usda_doc["metadata"]["variants"]) == 1
    assert usda_doc["metadata"]["variants"][0]["set"] == "look"

    gltf_doc = (await client.get(f"{base}/files/{by_name['robot.gltf']['id']}/inspect")).json()
    assert len(gltf_doc["metadata"]["textures"]) >= 1
    tex_art = (
        await client.post(
            f"{base}/files/{by_name['robot.gltf']['id']}/artifacts/texture_png",
            json={"params": {"texture_index": 0}},
        )
    ).json()
    assert tex_art["mime_type"] == "image/png"
