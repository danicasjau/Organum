from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import OpenEXR
import psd_tools
import pytest
import tifffile
from httpx import AsyncClient
from PIL import Image

from tests.conftest import make_entity_product_dir, reconcile_files_map


@pytest.mark.asyncio
async def test_exr_psd_tiff_png_inspect_and_derive(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, client, project_uuid, prod_root = test_app
    render_dir = make_entity_product_dir(prod_root, "hero", "Lighting", "beauty", "v0001")

    rgba = np.full((16, 20, 4), 0.5, dtype=np.float32)
    z = np.full((16, 20), 0.75, dtype=np.float32)
    with OpenEXR.File(
        {"compression": OpenEXR.ZIP_COMPRESSION},
        {"RGBA": rgba, "depth.Z": z},
    ) as exr:
        exr.write(str(render_dir / "shot.exr"))

    psd = psd_tools.PSDImage.new("RGB", (16, 16))
    psd.create_pixel_layer_from_array(
        np.full((16, 16, 4), [20, 30, 40, 255], dtype=np.uint8), name="BG"
    )
    psd.create_pixel_layer_from_array(
        np.full((16, 16, 4), [200, 100, 50, 255], dtype=np.uint8), name="Rim"
    )
    psd.save(str(render_dir / "comp.psd"))

    with tifffile.TiffWriter(render_dir / "pages.tif") as tw:
        tw.write(np.zeros((12, 12, 3), dtype=np.uint8), photometric="rgb")
        tw.write(np.full((12, 12), 200, dtype=np.uint8), photometric="minisblack")

    Image.new("RGBA", (32, 32), (10, 20, 30, 255)).save(render_dir / "card.png")

    by_name = await reconcile_files_map(client, project_uuid)
    base = f"/api/v1/projects/{project_uuid}"

    exr_id = str(by_name["shot.exr"]["id"])
    exr_doc = (await client.get(f"{base}/files/{exr_id}/inspect")).json()
    assert exr_doc["kind"] == "image2d"
    assert {a["name"] for a in exr_doc["aovs"]} == {"RGBA", "depth.Z"}

    art1 = (
        await client.post(
            f"{base}/files/{exr_id}/artifacts/float_rgba",
            json={"params": {"aov": "depth.Z"}},
        )
    ).json()
    art2 = (
        await client.post(
            f"{base}/files/{exr_id}/artifacts/float_rgba",
            json={"params": {"aov": "depth.Z"}},
        )
    ).json()
    assert art1["id"] == art2["id"]

    buf = (await client.get(art1["content_url"])).content
    magic, w, h, ch = struct.unpack("<4sIII", buf[:16])
    assert (magic, w, h, ch) == (b"ORGF", 20, 16, 4)

    psd_id = str(by_name["comp.psd"]["id"])
    psd_doc = (await client.get(f"{base}/files/{psd_id}/inspect")).json()
    assert len(psd_doc["layers"]) == 2
    psd_art = (
        await client.post(
            f"{base}/files/{psd_id}/artifacts/layer_png",
            json={"params": {"isolate": psd_doc["layers"][1]["id"]}},
        )
    ).json()
    assert psd_art["mime_type"] == "image/png"

    tif_id = str(by_name["pages.tif"]["id"])
    tif_doc = (await client.get(f"{base}/files/{tif_id}/inspect")).json()
    assert len(tif_doc["layers"]) == 2

    png_id = str(by_name["card.png"]["id"])
    thumb = await client.get(f"{base}/files/{png_id}/thumbnail")
    assert thumb.status_code == 200
    assert thumb.headers["content-type"] == "image/png"
