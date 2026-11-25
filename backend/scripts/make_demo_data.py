from __future__ import annotations

import asyncio
import csv
import json
import math
import shutil
import struct
import subprocess
import uuid
import wave
from pathlib import Path

import numpy as np
import OpenEXR
import OpenImageIO
import psd_tools
import pygltflib
import tifffile
import trimesh
from PIL import Image, ImageDraw
from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade

from app.core.project_registry import DEFAULT_STARTER_DEPARTMENTS, ProjectRegistry
from app.core.settings import get_settings
from app.db.session import create_engine_and_sessionmaker
from app.formats.registry import build_default_registry
from app.models.app_db import AppBase
from app.models.project_db import Entity
from app.services.entity_service import replace_entity_data, set_entity_tags


def _write_obj_and_mtl(base_dir: Path) -> None:
    mtl_path = base_dir / "robot.mtl"
    mtl_path.write_text(
        "# Demo MTL\n"
        "newmtl body_metal\n"
        "Kd 0.65 0.68 0.72\n"
        "Ks 0.80 0.80 0.80\n"
        "Ns 64.0\n",
        encoding="utf-8",
    )
    obj_path = base_dir / "robot.obj"
    obj_path.write_text(
        "# Demo Hero Robot Cube\n"
        "mtllib robot.mtl\n"
        "o hero_body\n"
        "usemtl body_metal\n"
        "v -0.5 -0.5  0.5\n"
        "v  0.5 -0.5  0.5\n"
        "v  0.5  0.5  0.5\n"
        "v -0.5  0.5  0.5\n"
        "v -0.5 -0.5 -0.5\n"
        "v  0.5 -0.5 -0.5\n"
        "v  0.5  0.5 -0.5\n"
        "v -0.5  0.5 -0.5\n"
        "f 1 2 3 4\n"
        "f 5 8 7 6\n"
        "f 1 5 6 2\n"
        "f 2 6 7 3\n"
        "f 3 7 8 4\n"
        "f 4 8 5 1\n",
        encoding="utf-8",
    )


def _write_gltf(base_dir: Path) -> None:
    # Build a multi-part textured robot mesh via trimesh and export self-contained glTF
    tex_img = Image.new("RGBA", (64, 64), (42, 55, 76, 255))
    draw = ImageDraw.Draw(tex_img)
    for y in range(0, 64, 16):
        for x in range(0, 64, 16):
            if (x // 16 + y // 16) % 2 == 0:
                draw.rectangle([x, y, x + 15, y + 15], fill=(139, 92, 246, 255))
    draw.rectangle([16, 16, 48, 48], outline=(16, 185, 129, 255), width=2)

    uv_torso = np.array([[0, 0], [1, 0], [1, 1], [0, 1]] * 6, dtype=np.float32)[:24]
    torso = trimesh.creation.box(extents=[1.0, 1.2, 0.6])
    torso.visual = trimesh.visual.TextureVisuals(
        uv=uv_torso[: len(torso.vertices)],
        material=trimesh.visual.material.PBRMaterial(
            name="robot_chassis",
            baseColorTexture=tex_img,
            metallicFactor=0.35,
            roughnessFactor=0.45,
        ),
    )
    head = trimesh.creation.icosphere(subdivisions=2, radius=0.38)
    head.apply_translation([0.0, 0.95, 0.0])
    head.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            name="robot_visor",
            baseColorFactor=[167, 139, 250, 255],
            metallicFactor=0.7,
            roughnessFactor=0.25,
        )
    )
    scene = trimesh.Scene()
    scene.add_geometry(torso, node_name="Torso")
    scene.add_geometry(head, node_name="Head")
    glb_bytes = scene.export(file_type="glb")
    gltf = pygltflib.GLTF2.load_from_bytes(
        glb_bytes if isinstance(glb_bytes, bytes) else bytes(glb_bytes)
    )
    gltf.convert_buffers(pygltflib.BufferFormat.DATAURI)
    gltf.save(str(base_dir / "robot.gltf"))


def _write_usda(base_dir: Path) -> None:
    usda_path = base_dir / "robot.usda"
    stage = Usd.Stage.CreateNew(str(usda_path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)

    robot_xf = UsdGeom.Xform.Define(stage, "/Robot")
    stage.SetDefaultPrim(robot_xf.GetPrim())
    Usd.ModelAPI(robot_xf).SetKind("component")

    # Variant set
    vset = robot_xf.GetPrim().GetVariantSets().AddVariantSet("look")
    vset.AddVariant("clean")
    vset.AddVariant("weathered")
    vset.SetVariantSelection("clean")

    # Material
    mat = UsdShade.Material.Define(stage, "/Robot/Materials/ChassisMat")
    shader = UsdShade.Shader.Define(stage, "/Robot/Materials/ChassisMat/PreviewSurface")
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(0.28, 0.55, 0.85))
    shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.4)
    shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.35)
    mat.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")

    # Body cube mesh
    body = UsdGeom.Mesh.Define(stage, "/Robot/Body")
    body.CreatePointsAttr(
        [
            Gf.Vec3f(-0.5, -0.5, 0.5),
            Gf.Vec3f(0.5, -0.5, 0.5),
            Gf.Vec3f(0.5, 0.5, 0.5),
            Gf.Vec3f(-0.5, 0.5, 0.5),
            Gf.Vec3f(-0.5, -0.5, -0.5),
            Gf.Vec3f(0.5, -0.5, -0.5),
            Gf.Vec3f(0.5, 0.5, -0.5),
            Gf.Vec3f(-0.5, 0.5, -0.5),
        ]
    )
    body.CreateFaceVertexCountsAttr([4, 4, 4, 4, 4, 4])
    body.CreateFaceVertexIndicesAttr(
        [0, 1, 2, 3, 4, 7, 6, 5, 0, 4, 5, 1, 1, 5, 6, 2, 2, 6, 7, 3, 3, 7, 4, 0]
    )
    UsdShade.MaterialBindingAPI.Apply(body.GetPrim()).Bind(mat)

    # Head prism above body
    head = UsdGeom.Mesh.Define(stage, "/Robot/Head")
    head.AddTranslateOp().Set(Gf.Vec3d(0.0, 0.85, 0.0))
    head.CreatePointsAttr(
        [
            Gf.Vec3f(-0.3, -0.25, 0.3),
            Gf.Vec3f(0.3, -0.25, 0.3),
            Gf.Vec3f(0.3, 0.25, 0.3),
            Gf.Vec3f(-0.3, 0.25, 0.3),
            Gf.Vec3f(-0.3, -0.25, -0.3),
            Gf.Vec3f(0.3, -0.25, -0.3),
            Gf.Vec3f(0.3, 0.25, -0.3),
            Gf.Vec3f(-0.3, 0.25, -0.3),
        ]
    )
    head.CreateFaceVertexCountsAttr([4, 4, 4, 4, 4, 4])
    head.CreateFaceVertexIndicesAttr(
        [0, 1, 2, 3, 4, 7, 6, 5, 0, 4, 5, 1, 1, 5, 6, 2, 2, 6, 7, 3, 3, 7, 4, 0]
    )
    UsdShade.MaterialBindingAPI.Apply(head.GetPrim()).Bind(mat)
    stage.GetRootLayer().Save()


def _write_images(base_dir: Path) -> None:
    img = Image.new("RGBA", (256, 256), (30, 41, 59, 255))
    draw = ImageDraw.Draw(img)
    bars = [
        (226, 232, 240, 255),
        (245, 158, 11, 255),
        (56, 189, 248, 255),
        (16, 185, 129, 255),
        (139, 92, 246, 255),
        (239, 68, 68, 255),
    ]
    w = 256 // len(bars)
    for idx, color in enumerate(bars):
        draw.rectangle([idx * w, 0, (idx + 1) * w - 1, 170], fill=color)
    for y in range(172, 256, 16):
        for x in range(0, 256, 16):
            shade = 200 if ((x // 16 + y // 16) % 2 == 0) else 40
            draw.rectangle([x, y, x + 15, y + 15], fill=(shade, shade, shade, 255))
    img.save(base_dir / "beauty.png")
    img.convert("RGB").save(base_dir / "beauty.tif")

    for frame in range(1, 5):
        seq = Image.new("RGB", (128, 128), (15, 23, 42))
        d = ImageDraw.Draw(seq)
        cx = 24 + frame * 20
        d.rectangle([cx - 12, 40, cx + 12, 88], fill=(139, 92, 246))
        seq.save(base_dir / f"turntable.{frame:04d}.png")

    # Multi-AOV float EXR (RGBA, depth.Z, N, specular)
    h, w = 128, 128
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx - w / 2.0) / (w / 2.0)
    ny = (yy - h / 2.0) / (h / 2.0)
    r2 = nx * nx + ny * ny
    nz = np.sqrt(np.maximum(0.0, 1.0 - r2))

    rgba = np.zeros((h, w, 4), dtype=np.float32)
    rgba[:, :, 0] = np.clip(0.2 + 1.4 * np.exp(-r2 * 4.0), 0.0, 4.0)
    rgba[:, :, 1] = np.clip(0.15 + 0.8 * (xx / w), 0.0, 2.0)
    rgba[:, :, 2] = np.clip(0.25 + 1.1 * (yy / h), 0.0, 2.0)
    rgba[:, :, 3] = 1.0

    depth_z = np.where(r2 <= 1.0, 1.0 - nz * 0.6, 1.0).astype(np.float32)
    normals = np.stack([nx * 0.5 + 0.5, -ny * 0.5 + 0.5, nz], axis=2).astype(np.float32)
    specular = np.clip(np.exp(-r2 * 14.0) * 2.5, 0.0, 4.0)
    spec_rgb = np.stack([specular, specular * 0.9, specular * 1.1], axis=2).astype(np.float32)

    with OpenEXR.File(
        {"compression": OpenEXR.ZIP_COMPRESSION},
        {"RGBA": rgba, "depth.Z": depth_z, "N": normals, "specular": spec_rgb},
    ) as exr:
        exr.write(str(base_dir / "beauty_aovs.exr"))

    # Multi-page TIFF
    page0 = np.asarray(img.convert("RGB"), dtype=np.uint8)
    page1 = np.where(
        ((np.arange(256)[:, None] - 128) ** 2 + (np.arange(256)[None, :] - 128) ** 2) < 80**2,
        np.uint8(255),
        np.uint8(32),
    )
    with tifffile.TiffWriter(base_dir / "multipage.tif") as tw:
        tw.write(page0, photometric="rgb")
        tw.write(page1, photometric="minisblack")

    # Multi-layer PSD
    psd = psd_tools.PSDImage.new("RGB", (128, 128))
    bg = np.full((128, 128, 4), [30, 41, 59, 255], dtype=np.uint8)
    key = np.zeros((128, 128, 4), dtype=np.uint8)
    key[20:108, 20:108] = [16, 185, 129, 220]
    rim = np.zeros((128, 128, 4), dtype=np.uint8)
    rim[32:96, 32:96] = [139, 92, 246, 230]
    psd.create_pixel_layer_from_array(bg, name="Background")
    psd.create_pixel_layer_from_array(key, name="KeyLight")
    psd.create_pixel_layer_from_array(rim, name="RimAccent")
    psd.save(str(base_dir / "concept_layers.psd"))


def _write_wav(path: Path) -> None:
    sample_rate = 48000
    duration_s = 1.0
    freq = 440.0
    n_frames = int(sample_rate * duration_s)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(n_frames):
            val = int(12000 * math.sin(2.0 * math.pi * freq * (i / sample_rate)))
            frames.extend(struct.pack("<hh", val, val))
        wf.writeframes(bytes(frames))


def _write_mp4(path: Path) -> bool:
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        return False
    cmd = [
        ffmpeg_bin,
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=1.5:size=320x180:rate=24",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1.5",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        str(path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return res.returncode == 0


def _write_data(base_dir: Path) -> None:
    with (base_dir / "metrics.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["frame", "render_time_ms", "memory_mb", "status"])
        writer.writerow([1, "142.5", "512.0", "ok"])
        writer.writerow([2, "139.8", "514.2", "ok"])
        writer.writerow([3, "151.1", "518.9", "warn"])
    (base_dir / "manifest.json").write_text(
        json.dumps({"asset": "hero_robot", "fps": 24, "colorspace": "ACEScg"}, indent=2),
        encoding="utf-8",
    )
    (base_dir / "pipeline_config.yaml").write_text(
        "project: demo\n"
        "asset: hero_robot\n"
        "render:\n"
        "  engine: cycles\n"
        "  samples: 64\n"
        "  colorspace: ACEScg\n"
        "  aovs:\n"
        "    - RGBA\n"
        "    - depth.Z\n"
        "    - N\n"
        "    - specular\n"
        "publish:\n"
        "  review_fps: 24\n"
        "  approved: true\n",
        encoding="utf-8",
    )


def _write_oiio_assets(base_dir: Path) -> None:
    # Float32 HDR equirectangular studio light dome
    h, w = 128, 256
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u = xx / float(w)
    v = yy / float(h)
    key = np.exp(-(((u - 0.35) ** 2) / 0.008 + ((v - 0.32) ** 2) / 0.02)) * 5.5
    fill = np.exp(-(((u - 0.75) ** 2) / 0.025 + ((v - 0.45) ** 2) / 0.05)) * 1.4
    hdr_rgb = np.zeros((h, w, 3), dtype=np.float32)
    hdr_rgb[:, :, 0] = 0.08 + 0.35 * (1.0 - v) + key + fill * 0.4
    hdr_rgb[:, :, 1] = 0.11 + 0.42 * (1.0 - v) + key * 0.92 + fill * 0.85
    hdr_rgb[:, :, 2] = 0.16 + 0.55 * (1.0 - v) + key * 0.78 + fill * 1.2

    hdr_spec = OpenImageIO.ImageSpec(w, h, 3, OpenImageIO.FLOAT)
    hdr_spec.attribute("oiio:ColorSpace", "Linear Rec.709 (sRGB)")
    out_hdr = OpenImageIO.ImageOutput.create(str(base_dir / "env_light.hdr"))
    assert out_hdr is not None
    out_hdr.open(str(base_dir / "env_light.hdr"), hdr_spec)
    out_hdr.write_image(hdr_rgb)
    out_hdr.close()

    # 10-bit/16-bit DPX cinema plate with timecode
    dw, dh = 256, 144
    plate_rgb = np.zeros((dh, dw, 3), dtype=np.uint16)
    gx = np.linspace(4000, 62000, dw, dtype=np.uint16)[None, :]
    gy = np.linspace(4000, 52000, dh, dtype=np.uint16)[:, None]
    plate_rgb[:, :, 0] = gx
    plate_rgb[:, :, 1] = gx // 2 + gy // 2
    plate_rgb[:, :, 2] = gy
    dpx_spec = OpenImageIO.ImageSpec(dw, dh, 3, OpenImageIO.UINT16)
    dpx_spec.attribute("oiio:BitsPerSample", 10)
    dpx_spec.attribute("oiio:ColorSpace", "Rec709")
    dpx_spec.attribute("dpx:TimeCode", "01:00:00:00")
    out_dpx = OpenImageIO.ImageOutput.create(str(base_dir / "plate.dpx"))
    assert out_dpx is not None
    out_dpx.open(str(base_dir / "plate.dpx"), dpx_spec)
    out_dpx.write_image(plate_rgb)
    out_dpx.close()

    # Targa albedo + mipmapped .tx texture via ImageBufAlgo.make_texture
    tga_img = Image.new("RGBA", (256, 256), (48, 60, 82, 255))
    tdraw = ImageDraw.Draw(tga_img)
    for idx, col in enumerate([(139, 92, 246, 255), (16, 185, 129, 255), (56, 189, 248, 255)]):
        tdraw.rectangle([16 + idx * 72, 24, 80 + idx * 72, 232], fill=col)
    tga_path = base_dir / "albedo.tga"
    tga_img.save(tga_path)

    tx_path = base_dir / "albedo.tx"
    tx_buf = OpenImageIO.ImageBuf(str(tga_path))
    OpenImageIO.ImageBufAlgo.make_texture(OpenImageIO.MakeTxTexture, tx_buf, str(tx_path))

    # Gappy multi-resolution UDIM texture set (1001=256px, 1002=128px, 1011=256px; 1012 missing)
    udim_specs = [
        (1001, 256, (139, 92, 246), "1001 U0V0"),
        (1002, 128, (16, 185, 129), "1002 U1V0"),
        (1011, 256, (56, 189, 248), "1011 U0V1"),
    ]
    for tile_num, size_px, accent_rgb, tag in udim_specs:
        tile_img = Image.new("RGBA", (size_px, size_px), (28, 38, 56, 255))
        ud = ImageDraw.Draw(tile_img)
        step = max(16, size_px // 4)
        for y in range(0, size_px, step):
            for x in range(0, size_px, step):
                if ((x // step) + (y // step)) % 2 == 0:
                    ud.rectangle([x + 2, y + 2, x + step - 3, y + step - 3], fill=(42, 55, 78, 255))
        ud.rectangle([4, 4, size_px - 5, size_px - 5], outline=(*accent_rgb, 255), width=3)
        ud.rectangle(
            [size_px // 5, size_px // 5, (size_px * 4) // 5, (size_px * 4) // 5],
            outline=(226, 232, 240, 255),
            width=2,
        )
        ud.text((10, 10), f"UDIM {tag}", fill=(226, 232, 240, 255))
        tile_img.save(base_dir / f"robot_albedo.{tile_num}.png")


def _write_pdf(path: Path) -> None:
    def _esc(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    def _txt(size: int, x: int, y: int, body: str) -> str:
        return f"BT /F1 {size} Tf {x} {y} Td ({_esc(body)}) Tj ET"

    page1_lines = [
        _txt(16, 54, 740, "ORGANUM Shot Review Brief"),
        _txt(11, 54, 714, "Asset: hero_robot | Version: v001 | Colorspace: ACEScg"),
        _txt(11, 54, 688, "Page 1 - Lighting and Lookdev Approval Notes"),
        _txt(10, 54, 664, "1. Key dome light env_light.hdr verified at +1.0 EV."),
        _txt(10, 54, 646, "2. Chassis brushed roughness reduced by 12 percent."),
    ]
    page2_lines = [
        _txt(14, 54, 740, "Page 2 - Asset Sign-off Checklist"),
        _txt(10, 54, 712, "- USD variants clean and weathered verified."),
        _txt(10, 54, 694, "- Turntable sequence frames 0001-0004 aligned."),
    ]
    c1 = "\n".join(page1_lines).encode("latin-1")
    c2 = "\n".join(page2_lines).encode("latin-1")

    res = "<< /Font << /F1 5 0 R >> >>"
    objects: list[bytes] = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n",
        f"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        f"/Resources {res} /Contents 6 0 R >>\nendobj\n".encode("ascii"),
        f"4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        f"/Resources {res} /Contents 7 0 R >>\nendobj\n".encode("ascii"),
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        b"6 0 obj\n<< /Length " + str(len(c1)).encode("ascii")
        + b" >>\nstream\n" + c1 + b"\nendstream\nendobj\n",
        b"7 0 obj\n<< /Length " + str(len(c2)).encode("ascii")
        + b" >>\nstream\n" + c2 + b"\nendstream\nendobj\n",
        b"8 0 obj\n<< /Title (ORGANUM Shot Review Brief) "
        b"/Author (Lead Artist) /Producer (ORGANUM) >>\nendobj\n",
    ]
    buf = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = [0]
    for obj in objects:
        offsets.append(len(buf))
        buf.extend(obj)
    xref_pos = len(buf)
    buf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    buf.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        buf.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 8 0 R >>\n"
    buf.extend(f"{trailer}startxref\n{xref_pos}\n%%EOF\n".encode("ascii"))
    path.write_bytes(bytes(buf))


def _write_edl(path: Path) -> None:
    path.write_text(
        "TITLE: HERO_ROBOT_EDIT\n"
        "FCM: NON-DROP FRAME\n\n"
        "001  TURN_001 V     C        00:00:00:00 00:00:01:12 00:00:00:00 00:00:01:12\n"
        "* FROM CLIP NAME: turntable.mp4\n\n"
        "002  BEAU_001 V     C        00:00:00:00 00:00:01:00 00:00:01:12 00:00:02:12\n"
        "* FROM CLIP NAME: beauty.png\n",
        encoding="utf-8",
    )


async def _build_demo_project() -> None:
    settings = get_settings()
    project_root = settings.demo_project_path.resolve()
    project_json = project_root / "00_Pipeline" / "project.json"
    if project_root.exists():
        shutil.rmtree(project_root)

    settings.app_db_url.startswith("sqlite")
    Path(settings.app_db_url.split("///", 1)[1]).parent.mkdir(parents=True, exist_ok=True)
    app_engine, app_session_factory = create_engine_and_sessionmaker(settings.app_db_url)
    format_registry = build_default_registry()
    proj_registry = ProjectRegistry(settings, format_registry)

    try:
        async with app_engine.begin() as conn:
            await conn.run_sync(AppBase.metadata.create_all)

        async with app_session_factory() as app_db:
            if not project_json.is_file():
                ctx = await proj_registry.create_project(
                    app_db,
                    path=project_root,
                    name="ORGANUM Demo",
                    starter_departments=DEFAULT_STARTER_DEPARTMENTS,
                )
            else:
                ctx, _ = await proj_registry.open_project(app_db, project_root)

        prod_root = ctx.production_dir
        hero = prod_root / "hero_robot"
        hero.mkdir(parents=True, exist_ok=True)
        (hero / ".entity.json").write_text(
            json.dumps({"uuid": str(uuid.uuid4()), "schema_version": 2}, indent=2),
            encoding="utf-8",
        )

        # Create entity task directories under products/v0001/ and scenefiles/
        task_dirs = {
            "model": hero / "Modeling" / "main" / "products" / "v0001",
            "lookdev": hero / "Lookdev" / "textures" / "products" / "v0001",
            "render": hero / "Lighting" / "beauty" / "products" / "v0001",
            "turntable": hero / "Animation" / "turntable" / "products" / "v0001",
            "audio": hero / "FX" / "audio" / "products" / "v0001",
            "edit": hero / "Compositing" / "edit" / "products" / "v0001",
            "data": hero / "Compositing" / "data" / "products" / "v0001",
            "doc": hero / "Modeling" / "brief" / "products" / "v0001",
        }
        for d in task_dirs.values():
            d.mkdir(parents=True, exist_ok=True)
            (d.parent / "master.json").write_text(
                json.dumps({"version": "v0001"}, indent=2), encoding="utf-8"
            )
            (d.parent.parent / "scenefiles").mkdir(parents=True, exist_ok=True)

        # Sample DCC scenefiles & work subfolder (live disk, not in DB)
        model_scene_dir = hero / "Modeling" / "main" / "scenefiles"
        (model_scene_dir / "robot_v001.hip").write_text(
            "# Demo Houdini placeholder scenefile\n", encoding="utf-8"
        )
        (model_scene_dir / "robot_lookdev.ma").write_text(
            "//Maya ASCII demo placeholder\n", encoding="utf-8"
        )
        (model_scene_dir / "robot_sculpt.blend").write_text(
            "# Demo Blender placeholder scenefile\n", encoding="utf-8"
        )
        (model_scene_dir / "work").mkdir(parents=True, exist_ok=True)
        (model_scene_dir / "work" / "notes.txt").write_text(
            "Modeling notes: bevel chassis plates and check UDIM seam.\n", encoding="utf-8"
        )
        ref_img = Image.new("RGB", (64, 64), (24, 34, 52))
        ImageDraw.Draw(ref_img).rectangle([8, 8, 56, 56], outline=(139, 92, 246), width=3)
        ref_img.save(model_scene_dir / "concept_ref.png")

        (hero / "Lighting" / "beauty" / "scenefiles" / "lighting_v001.hip").write_text(
            "# Demo Lighting Houdini scenefile\n", encoding="utf-8"
        )
        (hero / "Lighting" / "beauty" / "scenefiles" / "comp_slap.nk").write_text(
            "# Demo Nuke script\n", encoding="utf-8"
        )
        (hero / "Lookdev" / "textures" / "scenefiles" / "hero_robot_lookdev.hip").write_text(
            "# Demo Houdini placeholder scenefile\n", encoding="utf-8"
        )

        _write_obj_and_mtl(task_dirs["model"])
        _write_gltf(task_dirs["model"])
        _write_usda(task_dirs["model"])
        _write_images(task_dirs["render"])
        _write_oiio_assets(task_dirs["lookdev"])
        _write_wav(task_dirs["audio"] / "sfx.wav")
        _write_data(task_dirs["data"])
        _write_pdf(task_dirs["doc"] / "review_brief.pdf")
        _write_edl(task_dirs["edit"] / "edit.edl")
        mp4_ok = _write_mp4(task_dirs["turntable"] / "turntable.mp4")

        # Secondary grouped entity inside a plain folder (drone under props/)
        drone = prod_root / "props" / "hover_drone"
        (drone / "Modeling" / "main" / "products" / "v0001").mkdir(parents=True, exist_ok=True)
        (drone / "Modeling" / "main" / "scenefiles").mkdir(parents=True, exist_ok=True)
        (drone / "Modeling" / "main" / "scenefiles" / "drone_v001.ma").write_text(
            "//Maya ASCII drone\n", encoding="utf-8"
        )
        drone_id = uuid.uuid4()
        (drone / ".entity.json").write_text(
            json.dumps({"uuid": str(drone_id), "schema_version": 2}, indent=2),
            encoding="utf-8",
        )
        (drone / "Modeling" / "main" / "products" / "master.json").write_text(
            json.dumps({"version": "v0001"}, indent=2), encoding="utf-8"
        )
        _write_obj_and_mtl(drone / "Modeling" / "main" / "products" / "v0001")

        # Reconcile demo project into project.db and seed entity metadata/tags
        async with app_session_factory() as app_db:
            ctx, rep = await proj_registry.open_project(app_db, project_root)
            async with ctx.session_factory() as proj_db:
                hero_meta = json.loads((hero / ".entity.json").read_text(encoding="utf-8"))
                hero_ent = await proj_db.get(Entity, uuid.UUID(str(hero_meta["uuid"])))
                if hero_ent is not None:
                    hero_ent.entity_type = "Character"
                    hero_ent.description = "Primary bipedal mechanical hero character."
                    await set_entity_tags(proj_db, hero_ent.id, ["hero", "biped", "mech"])
                    await replace_entity_data(
                        proj_db,
                        hero_ent.id,
                        [
                            ("polycount", "int", "42800"),
                            ("rig_version", "str", "v04"),
                            ("scale_cm", "float", "185.0"),
                            ("approved", "bool", "false"),
                        ],
                    )
                drone_ent = await proj_db.get(Entity, drone_id)
                if drone_ent is not None:
                    drone_ent.entity_type = "Prop"
                    drone_ent.description = "Autonomous hover scout drone."
                    await set_entity_tags(proj_db, drone_ent.id, ["prop", "drone"])
                    await replace_entity_data(
                        proj_db,
                        drone_ent.id,
                        [("scale_cm", "float", "62.5")],
                    )
                await proj_db.commit()
            print(
                f"Demo project built at {project_root} ({ctx.uuid}): "
                f"entities={rep.entities_scanned} versions={rep.versions_registered} "
                f"files={rep.files_scanned} mp4={mp4_ok}"
            )
    finally:
        await proj_registry.dispose_all()
        await app_engine.dispose()


def main() -> None:
    asyncio.run(_build_demo_project())


if __name__ == "__main__":
    main()

