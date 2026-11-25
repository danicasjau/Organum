from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import trimesh

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.glb_utils import export_trimesh_scene_to_glb


def _parse_obj_groups_and_mtls(path: Path) -> tuple[list[str], list[str], list[str]]:
    groups: list[str] = []
    materials: list[str] = []
    textures: list[str] = []
    mtllibs: list[str] = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if line.startswith(("o ", "g ")):
            name = line[2:].strip()
            if name and name not in groups:
                groups.append(name)
        elif line.startswith("usemtl "):
            m = line[7:].strip()
            if m and m not in materials:
                materials.append(m)
        elif line.startswith("mtllib "):
            mtllibs.append(line[7:].strip())

    for mtl in mtllibs:
        mtl_path = (path.parent / mtl).resolve()
        if mtl_path.is_file():
            for raw in mtl_path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = raw.strip()
                if line.lower().startswith("map_"):
                    parts = line.split(None, 1)
                    if len(parts) == 2 and parts[1] not in textures:
                        textures.append(parts[1])
    return groups, materials, textures


def _probe_sync(path: Path) -> ProbeResult:
    loaded = trimesh.load(str(path), force="scene")
    tris = 0
    verts = 0
    if isinstance(loaded, trimesh.Scene):
        for g in loaded.geometry.values():
            if isinstance(g, trimesh.Trimesh):
                tris += len(g.faces)
                verts += len(g.vertices)
    groups, materials, _ = _parse_obj_groups_and_mtls(path)
    return ProbeResult(
        format_id="obj",
        media_kind="scene3d",
        details={
            "groups": groups,
            "materials": materials,
            "triangles": tris,
            "vertices": verts,
        },
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    groups, materials, textures = _parse_obj_groups_and_mtls(path)
    loaded = trimesh.load(str(path), force="scene")
    tree: list[dict[str, Any]] = []
    tris = 0
    verts = 0
    if isinstance(loaded, trimesh.Scene):
        for name, geom in loaded.geometry.items():
            if isinstance(geom, trimesh.Trimesh):
                tris += len(geom.faces)
                verts += len(geom.vertices)
                tree.append({"id": f"geom_{name}", "name": name, "type": "Mesh"})
    if not tree:
        tree = [{"id": f"grp_{g}", "name": g, "type": "Group"} for g in groups]

    return InspectionDocument(
        kind="scene3d",
        summary={
            "name": path.name,
            "format": "obj",
            "triangles": tris,
            "vertices": verts,
            "groups": len(groups),
            "materials": len(materials),
        },
        tree=tree,
        metadata={
            "triangles": tris,
            "vertices": verts,
            "materials": [{"index": i, "name": m} for i, m in enumerate(materials)],
            "textures": [
                {"index": i, "name": t, "mime": "image/png"} for i, t in enumerate(textures)
            ],
        },
        capabilities={"scene_3d": True, "freeze_2d": True, "annotations_3d": True},
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind == "scene_glb":
        scene = trimesh.load(str(path), force="scene")
        dest = out_dir / "scene.glb"
        size = export_trimesh_scene_to_glb(scene, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="model/gltf-binary",
            size=size,
        )
    if kind == "texture_png":
        from PIL import Image

        _, _, textures = _parse_obj_groups_and_mtls(path)
        idx = int(params.get("texture_index", 0))
        if idx >= len(textures):
            raise ValueError(f"Texture index {idx} out of range")
        tex_path = (path.parent / textures[idx]).resolve()
        if not tex_path.is_file():
            raise ValueError(f"Texture file '{textures[idx]}' not found")
        dest = out_dir / f"tex_{idx}.png"
        with Image.open(tex_path) as img:
            img.convert("RGBA").save(dest, format="PNG")
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="image/png",
            size=dest.stat().st_size,
        )
    raise NotImplementedError(f"Unsupported OBJ derive kind '{kind}'")


class ObjHandler(FormatHandler):
    handler_id = "obj"
    handler_version = "1.0.0"
    media_kind = "scene3d"
    extensions = (".obj",)

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
