from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
from pxr import Gf, Usd, UsdGeom, UsdShade

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult
from app.formats.handlers.glb_utils import (
    export_trimesh_scene_to_glb,
    make_pbr_material,
    make_texture_visual,
)


def _prim_node(prim: Usd.Prim) -> dict[str, Any]:
    img = UsdGeom.Imageable(prim)
    purpose = img.ComputePurpose() if img else ""
    vis = img.ComputeVisibility() if img else UsdGeom.Tokens.inherited
    model_api = Usd.ModelAPI(prim)
    kind = model_api.GetKind() if model_api else ""
    vsets = {}
    if prim.HasVariantSets():
        vs = prim.GetVariantSets()
        for name in vs.GetNames():
            vset = vs.GetVariantSet(name)
            vsets[name] = {
                "selected": vset.GetVariantSelection(),
                "options": list(vset.GetVariantNames()),
            }

    children = [_prim_node(c) for c in prim.GetChildren()]
    node: dict[str, Any] = {
        "id": str(prim.GetPath()),
        "name": prim.GetName(),
        "path": str(prim.GetPath()),
        "type": prim.GetTypeName() or "Scope",
        "kind": kind,
        "purpose": str(purpose),
        "visible": vis != UsdGeom.Tokens.invisible,
    }
    if vsets:
        node["variants"] = vsets
    if children:
        node["children"] = children
    return node


def _probe_sync(path: Path) -> ProbeResult:
    stage = Usd.Stage.Open(str(path))
    up_axis = str(UsdGeom.GetStageUpAxis(stage))
    mpu = float(UsdGeom.GetStageMetersPerUnit(stage))
    start_tc = stage.GetStartTimeCode()
    end_tc = stage.GetEndTimeCode()
    fps = float(stage.GetTimeCodesPerSecond())
    prim_count = sum(1 for _ in stage.Traverse())
    return ProbeResult(
        format_id=path.suffix.lower().lstrip("."),
        media_kind="scene3d",
        fps=fps,
        details={
            "upAxis": up_axis,
            "metersPerUnit": mpu,
            "startTimeCode": start_tc,
            "endTimeCode": end_tc,
            "timeCodesPerSecond": fps,
            "primCount": prim_count,
        },
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    stage = Usd.Stage.Open(str(path))
    up_axis = str(UsdGeom.GetStageUpAxis(stage))
    mpu = float(UsdGeom.GetStageMetersPerUnit(stage))
    start_tc = float(stage.GetStartTimeCode())
    end_tc = float(stage.GetEndTimeCode())
    fps = float(stage.GetTimeCodesPerSecond())
    has_anim = stage.HasAuthoredTimeCodeRange() and end_tc > start_tc

    root = stage.GetPseudoRoot()
    tree = [_prim_node(c) for c in root.GetChildren()]

    materials: list[dict[str, Any]] = []
    variants: list[dict[str, Any]] = []
    tris = 0
    verts = 0
    for prim in stage.Traverse():
        if prim.IsA(UsdGeom.Mesh):
            mesh = UsdGeom.Mesh(prim)
            pts = mesh.GetPointsAttr().Get()
            fvc = mesh.GetFaceVertexCountsAttr().Get()
            if pts:
                verts += len(pts)
            if fvc:
                tris += sum(max(0, int(c) - 2) for c in fvc)
        if prim.IsA(UsdShade.Material):
            materials.append({"path": str(prim.GetPath()), "name": prim.GetName()})
        if prim.HasVariantSets():
            vs = prim.GetVariantSets()
            for vname in vs.GetNames():
                vset = vs.GetVariantSet(vname)
                variants.append(
                    {
                        "prim": str(prim.GetPath()),
                        "set": vname,
                        "selected": vset.GetVariantSelection(),
                        "options": list(vset.GetVariantNames()),
                    }
                )

    used_layers = [lyr.identifier for lyr in stage.GetUsedLayers()]

    return InspectionDocument(
        kind="scene3d",
        summary={
            "name": path.name,
            "format": probe.format_id,
            "upAxis": up_axis,
            "metersPerUnit": mpu,
            "triangles": tris,
            "vertices": verts,
            "materials": len(materials),
        },
        tree=tree,
        timeline={"start": start_tc, "end": end_tc, "fps": fps} if has_anim else None,
        metadata={
            "upAxis": up_axis,
            "metersPerUnit": mpu,
            "startTimeCode": start_tc,
            "endTimeCode": end_tc,
            "timeCodesPerSecond": fps,
            "layerStack": used_layers,
            "variants": variants,
            "materials": materials,
            "triangles": tris,
            "vertices": verts,
        },
        capabilities={
            "scene_3d": True,
            "freeze_2d": True,
            "annotations_3d": True,
            "has_animation": has_anim,
        },
    )


def _extract_material_color(prim: Usd.Prim) -> tuple[list[float], float, float]:
    base_color = [0.7, 0.72, 0.76, 1.0]
    metallic = 0.1
    roughness = 0.5
    binding = UsdShade.MaterialBindingAPI(prim)
    mat, _ = binding.ComputeBoundMaterial()
    if not mat:
        return base_color, metallic, roughness
    surf_out = mat.GetSurfaceOutput()
    if not surf_out:
        return base_color, metallic, roughness
    sources = surf_out.GetConnectedSources()
    if not sources or not sources[0]:
        return base_color, metallic, roughness
    shader = UsdShade.Shader(sources[0][0].source.GetPrim())
    if not shader:
        return base_color, metallic, roughness
    dc_in = shader.GetInput("diffuseColor")
    if dc_in:
        val = dc_in.Get()
        if isinstance(val, Gf.Vec3f):
            base_color = [float(val[0]), float(val[1]), float(val[2]), 1.0]
    met_in = shader.GetInput("metallic")
    if met_in and met_in.Get() is not None:
        metallic = float(met_in.Get())
    rough_in = shader.GetInput("roughness")
    if rough_in and rough_in.Get() is not None:
        roughness = float(rough_in.Get())
    return base_color, metallic, roughness


def _export_usd_to_glb(path: Path, dest: Path) -> None:
    stage = Usd.Stage.Open(str(path))
    up_axis = str(UsdGeom.GetStageUpAxis(stage))
    mpu = float(UsdGeom.GetStageMetersPerUnit(stage)) or 1.0
    xform_cache = UsdGeom.XformCache(Usd.TimeCode.Default())

    # Z-up -> Y-up rotation (-90 deg around X)
    if up_axis.upper() == "Z":
        axis_mat = np.array(
            [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]],
            dtype=np.float64,
        )
    else:
        axis_mat = np.eye(4, dtype=np.float64)
    scale_mat = np.diag([mpu, mpu, mpu, 1.0])
    root_xform = axis_mat @ scale_mat

    scene = trimesh.Scene()
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        img = UsdGeom.Imageable(prim)
        if img and img.ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue

        usd_mesh = UsdGeom.Mesh(prim)
        pts = usd_mesh.GetPointsAttr().Get()
        fvc = usd_mesh.GetFaceVertexCountsAttr().Get()
        fvi = usd_mesh.GetFaceVertexIndicesAttr().Get()
        if not pts or not fvc or not fvi:
            continue

        verts = np.array([[p[0], p[1], p[2]] for p in pts], dtype=np.float64)
        faces: list[list[int]] = []
        offset = 0
        for count in fvc:
            c = int(count)
            poly = fvi[offset : offset + c]
            offset += c
            if c >= 3:
                for i in range(1, c - 1):
                    faces.append([int(poly[0]), int(poly[i]), int(poly[i + 1])])
        if not faces:
            continue

        base_color, metallic, roughness = _extract_material_color(prim)
        material = make_pbr_material(
            name=prim.GetName(),
            base_color_255=[int(c * 255) for c in base_color],
            metallic=metallic,
            roughness=roughness,
        )
        tmesh = trimesh.Trimesh(
            vertices=verts,
            faces=np.array(faces, dtype=np.int64),
            process=False,
        )
        tmesh.visual = make_texture_visual(material)

        gf_mat = xform_cache.GetLocalToWorldTransform(prim)
        # USD row-vector matrix -> column-vector 4x4
        usd_world = np.array(gf_mat, dtype=np.float64).T
        world = root_xform @ usd_world
        scene.add_geometry(tmesh, node_name=prim.GetName(), transform=world)

    export_trimesh_scene_to_glb(scene, dest)


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    if kind == "scene_glb":
        dest = out_dir / "scene.glb"
        _export_usd_to_glb(path, dest)
        return DerivedResult(
            kind=kind,
            storage_key=dest.name,
            mime_type="model/gltf-binary",
            size=dest.stat().st_size,
        )
    raise NotImplementedError(f"Unsupported USD derive kind '{kind}'")


class UsdHandler(FormatHandler):
    handler_id = "usd"
    handler_version = "1.0.0"
    media_kind = "scene3d"
    extensions = (".usd", ".usda", ".usdc", ".usdz")

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
