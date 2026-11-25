from __future__ import annotations

import json
import uuid
from pathlib import Path

import numpy as np
import OpenEXR
import pytest
import tifffile
from httpx import AsyncClient
from PIL import Image

from app.services.udim_service import mari_uv_to_udim, score_udim_vs_frames


def test_udim_scoring_fixtures_and_mari_conversion() -> None:
    # 1. Texture set inside lookdev/textures -> strongly UDIM
    tex = score_udim_vs_frames(
        [1001, 1002, 1011],
        rel_dir="hero_robot/Lookdev/textures/products/v0001",
        stem="robot_albedo",
        same_size=False,
    )
    assert tex.kind == "udim"
    assert tex.score >= 3

    # 2. Shot plate sequence starting at 1001..1024 in Lighting/beauty -> frames
    shot = score_udim_vs_frames(
        list(range(1001, 1025)),
        rel_dir="shot010/Lighting/beauty/products/v0001",
        stem="plate_beauty",
        same_size=True,
    )
    assert shot.kind == "frames"
    assert shot.score < 0

    # 3. Gappy set -> +2 sparse signal -> udim
    gappy = score_udim_vs_frames(
        [1001, 1003, 1012],
        rel_dir="hero/Modeling/main/products/v0001",
        stem="mask_patch",
        same_size=True,
    )
    assert gappy.kind == "udim"

    # 4. Ambiguous neutral set defaults to UDIM per CR02 §9.4
    ambig = score_udim_vs_frames(
        [1001, 1002],
        rel_dir="hero/Custom/task/products/v0001",
        stem="asset_map",
        same_size=None,
    )
    assert ambig.kind == "udim"

    # 5. Mari u1_v1 naming
    assert mari_uv_to_udim(1, 1) == 1001
    assert mari_uv_to_udim(2, 1) == 1002
    assert mari_uv_to_udim(1, 2) == 1011
    mari = score_udim_vs_frames(
        [1001, 1002],
        rel_dir="shot/Lighting/beauty/products/v0001",
        stem="hero",
        mari_style=True,
    )
    assert mari.kind == "udim"

    # 6. Frame numbers outside 1001..1999 -> always frames
    low_seq = score_udim_vs_frames([1, 2, 3, 4], rel_dir="Lookdev/textures", stem="turntable")
    assert low_seq.kind == "frames"


@pytest.mark.asyncio
async def test_udim_reconcile_override_atlas_and_uv_annotations(
    test_app: tuple[object, AsyncClient, str, Path],
    tmp_path: Path,
) -> None:
    _, client, _, _ = test_app
    proj_root = tmp_path / "phase6c_show"
    prod = proj_root / "01_Production" / "hero"
    tex_v1 = prod / "Lookdev" / "textures" / "products" / "v0001"
    tex_v1.mkdir(parents=True)
    render_v1 = prod / "Lighting" / "beauty" / "products" / "v0001"
    render_v1.mkdir(parents=True)
    (prod / ".entity.json").write_text(
        json.dumps({"uuid": str(uuid.uuid4()), "schema_version": 2}),
        encoding="utf-8",
    )

    # Mari UDIM set + numeric gappy multi-res UDIM set + 1001..1016 shot sequence
    Image.new("RGB", (64, 64), (139, 92, 246)).save(tex_v1 / "body_u1_v1.png")
    Image.new("RGB", (32, 32), (16, 185, 129)).save(tex_v1 / "body_u2_v1.png")
    Image.new("RGB", (64, 64), (56, 189, 248)).save(tex_v1 / "albedo.1001.png")
    Image.new("RGB", (32, 32), (245, 158, 11)).save(tex_v1 / "albedo.1011.png")
    for f in range(1001, 1017):
        Image.new("RGB", (32, 32), (40, 40, 40)).save(render_v1 / f"shot_plate.{f}.png")

    # EXR with RGBA + out-of-range depth.Z + multipage TIFF
    h, w = 32, 32
    rgba = np.full((h, w, 4), 0.5, dtype=np.float32)
    depth = np.linspace(1.2, 8.5, h * w, dtype=np.float32).reshape(h, w)
    with OpenEXR.File(
        {"compression": OpenEXR.ZIP_COMPRESSION},
        {"RGBA": rgba, "depth.Z": depth},
    ) as exr:
        exr.write(str(render_v1 / "beauty.exr"))
    with tifffile.TiffWriter(render_v1 / "pages.tif") as tw:
        tw.write(np.zeros((32, 32, 3), dtype=np.uint8), photometric="rgb")
        tw.write(np.full((32, 32), 200, dtype=np.uint8), photometric="minisblack")

    created = await client.post(
        "/api/v1/projects",
        json={
            "path": str(proj_root),
            "name": "Phase 6C Show",
            "starter_departments": ["Lookdev", "Lighting"],
        },
    )
    assert created.status_code == 201
    proj_uuid = created.json()["uuid"]
    from tests.conftest import authenticate_project_admin

    await authenticate_project_admin(client, proj_uuid)
    base = f"/api/v1/projects/{proj_uuid}"

    first_rec = await client.post(f"{base}/reconcile")
    assert first_rec.status_code == 200

    tree = (await client.get(f"{base}/entities")).json()
    all_files = [
        f
        for ent in tree["entities"]
        for d in ent["departments"]
        for t in d["tasks"]
        for v in (t["product"]["versions"] if t["product"] else [])
        for f in v["files"]
    ]

    mari_file = next(f for f in all_files if "<UDIM>" in (f["sequence_pattern"] or ""))
    albedo_file = next(f for f in all_files if f["filename"] == "albedo.####.png")
    shot_file = next(f for f in all_files if f["filename"] == "shot_plate.####.png")
    exr_file = next(f for f in all_files if f["filename"] == "beauty.exr")
    tif_file = next(f for f in all_files if f["filename"] == "pages.tif")

    assert mari_file["sequence_kind"] == "udim"
    assert albedo_file["sequence_kind"] == "udim"
    assert shot_file["sequence_kind"] == "frames"

    # Override albedo to frames, reconcile again, and verify user override persists
    patched = await client.patch(
        f"{base}/files/{albedo_file['id']}",
        json={"sequence_kind": "frames", "sequence_kind_user_override": True},
    )
    assert patched.status_code == 200
    assert patched.json()["sequence_kind"] == "frames"
    assert patched.json()["sequence_kind_user_override"] is True

    reconciled = await client.post(f"{base}/reconcile")
    assert reconciled.status_code == 200
    insp_over = (await client.get(f"{base}/files/{albedo_file['id']}/inspect")).json()
    assert insp_over["summary"]["sequence_kind"] == "frames"
    assert insp_over["capabilities"]["time_based"] is True

    # Flip back to UDIM & verify tile inspection + direct tile streaming + UV annotation
    await client.patch(
        f"{base}/files/{albedo_file['id']}",
        json={"sequence_kind": "udim", "sequence_kind_user_override": True},
    )
    insp_udim = (await client.get(f"{base}/files/{albedo_file['id']}/inspect")).json()
    assert insp_udim["capabilities"]["udim"] is True
    assert [t["udim"] for t in insp_udim["summary"]["udim_tiles"]] == [1001, 1011]

    tile_resp = await client.get(f"{base}/files/{albedo_file['id']}/udim/1011/content")
    assert tile_resp.status_code == 200
    assert len(tile_resp.content) > 50

    uv_ann = await client.post(
        f"{base}/files/{albedo_file['id']}/annotations",
        json={
            "kind": "2d",
            "coord_space": "uv",
            "note_text": "Seam check across 1001/1011",
            "vector_json": [
                {
                    "id": "s1",
                    "tool": "free",
                    "color": "#8B5CF6",
                    "size": 3,
                    "points": [[0.2, 0.8], [0.2, 1.2]],
                }
            ],
        },
    )
    assert uv_ann.status_code == 201
    assert uv_ann.json()["coord_space"] == "uv"

    # Generate udim_tiles and EXR/TIFF layer_thumbs sprite atlases
    udim_art = await client.post(
        f"{base}/files/{albedo_file['id']}/artifacts/udim_tiles",
        json={"params": {"mode": "udim"}},
    )
    assert udim_art.status_code == 200
    udim_manifest = (await client.get(udim_art.json()["content_url"])).json()
    assert [it["id"] for it in udim_manifest["items"]] == ["mosaic", "1001", "1011"]
    assert (await client.get(f"{base}/artifacts/{udim_art.json()['id']}/atlas")).status_code == 200

    exr_art = await client.post(
        f"{base}/files/{exr_file['id']}/artifacts/layer_thumbs",
        json={"params": {}},
    )
    assert exr_art.status_code == 200
    exr_manifest = (await client.get(exr_art.json()["content_url"])).json()
    depth_item = next(it for it in exr_manifest["items"] if it["id"] == "depth.Z")
    assert depth_item["auto_normalized"] is True

    tif_art = await client.post(
        f"{base}/files/{tif_file['id']}/artifacts/layer_thumbs",
        json={"params": {}},
    )
    assert tif_art.status_code == 200
    tif_manifest = (await client.get(tif_art.json()["content_url"])).json()
    assert len(tif_manifest["items"]) == 2
