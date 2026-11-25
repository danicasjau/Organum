from __future__ import annotations

from pathlib import Path

import numpy as np
import OpenImageIO
import pytest
from httpx import AsyncClient
from PIL import Image

from scripts.make_demo_data import _write_pdf
from tests.conftest import make_entity_product_dir, reconcile_files_map


def _write_test_oiio_assets(prod_root: Path) -> None:
    render_dir = make_entity_product_dir(prod_root, "robot", "Lookdev", "textures", "v0001")

    hdr = render_dir / "env_light.hdr"
    rgb = np.full((32, 64, 3), 2.5, dtype=np.float32)
    spec = OpenImageIO.ImageSpec(64, 32, 3, OpenImageIO.FLOAT)
    out = OpenImageIO.ImageOutput.create(str(hdr))
    assert out is not None
    out.open(str(hdr), spec)
    out.write_image(rgb)
    out.close()

    dpx = render_dir / "plate.dpx"
    plate = np.full((32, 48, 3), 32000, dtype=np.uint16)
    dpx_spec = OpenImageIO.ImageSpec(48, 32, 3, OpenImageIO.UINT16)
    dpx_spec.attribute("dpx:TimeCode", "01:00:00:00")
    dpx_out = OpenImageIO.ImageOutput.create(str(dpx))
    assert dpx_out is not None
    dpx_out.open(str(dpx), dpx_spec)
    dpx_out.write_image(plate)
    dpx_out.close()

    tga = render_dir / "albedo.tga"
    Image.new("RGBA", (64, 64), (139, 92, 246, 255)).save(tga)
    tx = render_dir / "albedo.tx"
    OpenImageIO.ImageBufAlgo.make_texture(
        OpenImageIO.MakeTxTexture, OpenImageIO.ImageBuf(str(tga)), str(tx)
    )

    bad_tex = render_dir / "proprietary.tex"
    bad_tex.write_bytes(b"NOT_A_VALID_TEX_FORMAT_12345")

    doc_dir = make_entity_product_dir(prod_root, "robot", "Modeling", "brief", "v0001")
    _write_pdf(doc_dir / "review_brief.pdf")

    data_dir = make_entity_product_dir(prod_root, "robot", "Compositing", "data", "v0001")
    (data_dir / "metrics.csv").write_text(
        "frame,ms,ok\n1,12.5,true\n2,14.0,false\n", encoding="utf-8"
    )
    (data_dir / "pipeline_config.yaml").write_text(
        "asset: hero_robot\nsamples: 64\n", encoding="utf-8"
    )


@pytest.mark.asyncio
async def test_phase5_handlers_and_ocio_lut(
    test_app: tuple[object, AsyncClient, str, Path],
) -> None:
    _, client, project_uuid, prod_root = test_app
    _write_test_oiio_assets(prod_root)

    files_by_name = await reconcile_files_map(client, project_uuid)
    base = f"/api/v1/projects/{project_uuid}"

    for fname in ("env_light.hdr", "plate.dpx", "albedo.tga", "albedo.tx"):
        fid = str(files_by_name[fname]["id"])
        insp = await client.get(f"{base}/files/{fid}/inspect")
        assert insp.status_code == 200
        doc = insp.json()
        assert doc["kind"] == "image2d"
        assert doc["capabilities"]["float_buffer"] is True

        art = await client.post(
            f"{base}/files/{fid}/artifacts/float_rgba", json={"params": {}}
        )
        assert art.status_code == 200
        buf_resp = await client.get(art.json()["content_url"])
        assert buf_resp.status_code == 200
        assert buf_resp.content[:4] == b"ORGF"

    tx_id = str(files_by_name["albedo.tx"]["id"])
    tx_insp = (await client.get(f"{base}/files/{tx_id}/inspect")).json()
    assert tx_insp["summary"]["mip_levels"] >= 2

    tiles_art = await client.post(
        f"{base}/files/{tx_id}/artifacts/tiles", json={"params": {"tile_size": 32}}
    )
    assert tiles_art.status_code == 200
    art_id = tiles_art.json()["id"]
    tile_png = await client.get(f"{base}/artifacts/{art_id}/tiles/0/0_0.png")
    assert tile_png.status_code == 200
    assert tile_png.content[:4] == b"\x89PNG"

    bad_id = str(files_by_name["proprietary.tex"]["id"])
    bad_insp = await client.get(f"{base}/files/{bad_id}/inspect")
    assert bad_insp.status_code == 200
    assert bad_insp.json()["capabilities"]["supported"] is False
    assert bad_insp.json()["metadata"]["partial_support"] is True

    pdf_id = str(files_by_name["review_brief.pdf"]["id"])
    pdf_insp = (await client.get(f"{base}/files/{pdf_id}/inspect")).json()
    assert pdf_insp["kind"] == "document"
    assert pdf_insp["summary"]["page_count"] == 2
    assert pdf_insp["capabilities"]["pdf"] is True

    csv_id = str(files_by_name["metrics.csv"]["id"])
    csv_insp = (await client.get(f"{base}/files/{csv_id}/inspect")).json()
    assert csv_insp["kind"] == "data"
    assert csv_insp["summary"]["row_count"] == 2
    assert csv_insp["summary"]["column_count"] == 3

    yaml_id = str(files_by_name["pipeline_config.yaml"]["id"])
    yaml_insp = (await client.get(f"{base}/files/{yaml_id}/inspect")).json()
    assert yaml_insp["kind"] == "data"
    parsed_art = await client.post(
        f"{base}/files/{yaml_id}/artifacts/parsed_json", json={"params": {}}
    )
    assert parsed_art.status_code == 200
    parsed_json = (await client.get(parsed_art.json()["content_url"])).json()
    assert parsed_json["asset"] == "hero_robot"

    lut1 = await client.get("/api/v1/colorspaces/lut?src=acescg&dst=srgb&size=9")
    assert lut1.status_code == 200
    d1 = lut1.json()
    assert d1["size"] == 9
    assert d1["engine"] == "opencolorio"
    assert len(d1["values"]) == 9 * 9 * 9 * 3
    lut2 = await client.get("/api/v1/colorspaces/lut?src=acescg&dst=srgb&size=9")
    assert lut2.json()["cache_key"] == d1["cache_key"]
