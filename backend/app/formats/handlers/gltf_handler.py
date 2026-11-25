from __future__ import annotations

import asyncio
import base64
import io
import shutil
from pathlib import Path
from typing import Any

import pygltflib
import trimesh
from PIL import Image

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.glb_utils import export_trimesh_scene_to_glb


def _extract_gltf_textures(gltf: pygltflib.GLTF2, base_dir: Path) -> list[dict[str, Any]]:
    textures: list[dict[str, Any]] = []
    for idx, tex in enumerate(gltf.textures or []):
        img_idx = tex.source
        img_name = f"texture_{idx}"
        mime = "image/png"
        if img_idx is not None and gltf.images and 0 <= img_idx < len(gltf.images):
            img_obj = gltf.images[img_idx]
            img_name = img_obj.name or img_obj.uri or img_name
            if img_obj.mimeType:
                mime = img_obj.mimeType
        textures.append({"index": idx, "name": img_name, "mime": mime})
    return textures


def _load_gltf_image_pil(path: Path, texture_index: int) -> Image.Image:
    gltf = pygltflib.GLTF2().load(str(path))
    if not gltf.textures or texture_index >= len(gltf.textures):
        raise ValueError(f"Texture index {texture_index} out of range")
    src_idx = gltf.textures[texture_index].source
    if src_idx is None or not gltf.images or src_idx >= len(gltf.images):
        raise ValueError(f"Missing image source for texture {texture_index}")
    img_obj = gltf.images[src_idx]

    raw_bytes: bytes | None = None
    if img_obj.bufferView is not None:
        bv = gltf.bufferViews[img_obj.bufferView]
        buf = gltf.buffers[bv.buffer]
        buf_bytes = gltf.get_data_from_buffer_uri(buf.uri)
        offset = bv.byteOffset or 0
        raw_bytes = buf_bytes[offset : offset + bv.byteLength]
    elif img_obj.uri:
        if img_obj.uri.startswith("data:"):
            _, b64 = img_obj.uri.split(",", 1)
            raw_bytes = base64.b64decode(b64)
        else:
            tex_path = (path.parent / img_obj.uri).resolve()
            raw_bytes = tex_path.read_bytes()

    if raw_bytes is None:
        raise ValueError("Unable to resolve texture image bytes")
    return Image.open(io.BytesIO(raw_bytes)).convert("RGBA")


def _build_node_tree(gltf: pygltflib.GLTF2) -> list[dict[str, Any]]:
    nodes = gltf.nodes or []
    if not nodes:
        return []
    child_indices = {c for n in nodes for c in (n.children or [])}
    roots = [i for i in range(len(nodes)) if i not in child_indices]

    def _visit(idx: int) -> dict[str, Any]:
        n = nodes[idx]
        entry: dict[str, Any] = {
            "id": f"node_{idx}",
            "name": n.name or f"node_{idx}",
            "type": "Mesh" if n.mesh is not None else "Xform",
        }
        if n.children:
            entry["children"] = [_visit(c) for c in n.children]
        return entry

    return [_visit(r) for r in roots]


def _scene_stats(path: Path) -> tuple[int, int, list[str]]:
    loaded = trimesh.load(str(path), force="scene")
    tris = 0
    verts = 0
    mats: list[str] = []
    if isinstance(loaded, trimesh.Scene):
        for geom in loaded.geometry.values():
            if isinstance(geom, trimesh.Trimesh):
                tris += len(geom.faces)
                verts += len(geom.vertices)
    elif isinstance(loaded, trimesh.Trimesh):
        tris = len(loaded.faces)
        verts = len(loaded.vertices)
    return tris, verts, mats


def _probe_sync(path: Path) -> ProbeResult:
    ext = path.suffix.lower().lstrip(".")
    gltf = pygltflib.GLTF2().load(str(path))
    tris, verts, _ = _scene_stats(path)
    return ProbeResult(
        format_id=ext,
        media_kind="scene3d",
        details={
            "nodes": len(gltf.nodes or []),
            "meshes": len(gltf.meshes or []),
            "materials": len(gltf.materials or []),
            "textures": len(gltf.textures or []),
            "animations": len(gltf.animations or []),
            "triangles": tris,
            "vertices": verts,
        },
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    gltf = pygltflib.GLTF2().load(str(path))
    tris, verts, _ = _scene_stats(path)
    textures = _extract_gltf_textures(gltf, path.parent)
    materials = [
        {"index": i, "name": m.name or f"material_{i}"}
        for i, m in enumerate(gltf.materials or [])
    ]
    animations = [
        {"index": i, "name": a.name or f"anim_{i}", "channels": len(a.channels or [])}
        for i, a in enumerate(gltf.animations or [])
    ]
    timeline_doc: dict[str, Any] | None = None
    if animations:
        max_t = 0.0
        for anim in gltf.animations or []:
            for sampler in anim.samplers or []:
                acc_idx = sampler.input
                if acc_idx is not None and gltf.accessors and acc_idx < len(gltf.accessors):
                    acc = gltf.accessors[acc_idx]
                    if acc.max:
                        max_t = max(max_t, float(acc.max[0]))
        dur_s = max_t if max_t > 0 else 2.0
        timeline_doc = {
            "start": 0,
            "end": max(1, round(dur_s * 24.0)),
            "fps": 24.0,
            "duration": round(dur_s, 3),
        }
    return InspectionDocument(
        kind="scene3d",
        summary={
            "name": path.name,
            "format": probe.format_id,
            "triangles": tris,
            "vertices": verts,
            "meshes": len(gltf.meshes or []),
            "materials": len(materials),
        },
        tree=_build_node_tree(gltf),
        timeline=timeline_doc,
        metadata={
            "generator": gltf.asset.generator if gltf.asset else "",
            "gltf_version": gltf.asset.version if gltf.asset else "2.0",
            "triangles": tris,
            "vertices": verts,
            "materials": materials,
            "textures": textures,
            "animations": animations,
        },
        capabilities={
            "scene_3d": True,
            "freeze_2d": True,
            "annotations_3d": True,
            "has_animation": len(animations) > 0,
            "time_based": len(animations) > 0,
        },
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind == "scene_glb":
        dest = out_dir / "scene.glb"
        if path.suffix.lower() == ".glb":
            shutil.copy2(path, dest)
            size = dest.stat().st_size
        else:
            scene = trimesh.load(str(path), force="scene")
            size = export_trimesh_scene_to_glb(scene, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="model/gltf-binary",
            size=size,
        )
    if kind == "texture_png":
        tex_idx = int(params.get("texture_index", 0))
        img = _load_gltf_image_pil(path, tex_idx)
        dest = out_dir / f"tex_{tex_idx}.png"
        img.save(dest, format="PNG")
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="image/png",
            size=dest.stat().st_size,
        )
    raise NotImplementedError(f"Unsupported glTF derive kind '{kind}'")


class GltfHandler(FormatHandler):
    handler_id = "gltf"
    handler_version = "1.0.0"
    media_kind = "scene3d"
    extensions = (".gltf", ".glb")
    magic_signatures = (b"glTF",)

    async def probe(self, path: Path) -> ProbeResult:
        return await asyncio.to_thread(_probe_sync, path)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return await asyncio.to_thread(_inspect_sync, path, probe)

    async def derive(
        self, path: Path, kind: str, params: dict[str, Any], out_dir: Path
    ) -> DerivedResult:
        return await asyncio.to_thread(_derive_sync, path, kind, params, out_dir)

    def capabilities(self) -> dict[str, bool]:
        return {"scene_3d": True, "freeze_2d": True, "annotations_3d": True}
