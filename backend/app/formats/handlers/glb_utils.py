from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import trimesh


def export_trimesh_scene_to_glb(loaded: Any, dest: Path) -> int:
    """Export a trimesh Scene/Geometry to binary GLB and return byte size."""
    scene: Any = (
        loaded if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    )
    glb_raw = cast(bytes, scene.export(file_type="glb"))
    dest.write_bytes(glb_raw)
    return dest.stat().st_size


def make_pbr_material(
    name: str,
    base_color_255: list[int],
    metallic: float,
    roughness: float,
) -> Any:
    mat_cls: Any = trimesh.visual.material.PBRMaterial
    return mat_cls(
        name=name,
        baseColorFactor=base_color_255,
        metallicFactor=metallic,
        roughnessFactor=roughness,
    )


def make_texture_visual(material: Any) -> Any:
    vis_cls: Any = trimesh.visual.TextureVisuals
    return vis_cls(material=material)

