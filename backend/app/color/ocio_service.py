from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import PyOpenColorIO

from app.core.settings import get_settings

_BUILTIN_CONFIG = "cg-config-v2.2.0_aces-v1.3_ocio-v2.4"

# Map Organum UI colorspace IDs to OCIO builtin colorspace names
_CS_CANDIDATES: dict[str, tuple[str, ...]] = {
    "srgb": ("sRGB Encoded Rec.709 (sRGB)", "sRGB - Display", "sRGB", "srgb_tx"),
    "linear_srgb": ("Linear Rec.709 (sRGB)", "Utility - Linear - sRGB", "Linear - sRGB"),
    "linear": ("Linear Rec.709 (sRGB)", "Utility - Linear - sRGB", "Linear - sRGB"),
    "rec709": ("Rec.1886 Rec.709 - Display", "Rec.709", "Gamma 2.4 Encoded Rec.709"),
    "rec2020": ("Linear Rec.2020", "Rec.2020"),
    "acescg": ("ACEScg", "ACES - ACEScg"),
    "aces2065_1": ("ACES2065-1", "ACES - ACES2065-1"),
    "display_p3": ("sRGB Encoded P3-D65", "Display P3 - Display", "Display P3"),
    "raw": ("Raw", "Utility - Raw", "raw"),
}


@dataclass(frozen=True)
class BakedLutResult:
    src: str
    dst: str
    size: int
    engine: str
    config_name: str
    cache_key: str
    values: list[float]


_LUT_CACHE: dict[tuple[str, str, str, int], BakedLutResult] = {}


def _load_ocio_config(config_path: str | None = None) -> tuple[Any | None, str, str]:
    target = config_path or get_settings().ocio_config_path
    if target:
        p = Path(target)
        if p.exists():
            cfg = PyOpenColorIO.Config.CreateFromFile(str(p))
            raw_bytes = p.read_bytes()
            cfg_hash = hashlib.sha256(raw_bytes).hexdigest()[:12]
            return cfg, p.name, cfg_hash
    try:
        cfg = PyOpenColorIO.Config.CreateFromBuiltinConfig(_BUILTIN_CONFIG)
        return cfg, _BUILTIN_CONFIG, hashlib.sha256(_BUILTIN_CONFIG.encode()).hexdigest()[:12]
    except Exception:
        return None, "builtin_fallback", "fallback-1"


def _resolve_cs_name(cfg: Any, space_id: str) -> str | None:
    available = {str(cs.getName()) for cs in cfg.getColorSpaces()}
    if space_id in available:
        return space_id
    for candidate in _CS_CANDIDATES.get(space_id.lower(), ()):
        if candidate in available:
            return candidate
    low = space_id.lower()
    for name in available:
        if low in name.lower():
            return name
    return None


def _fallback_apply_rgb(
    rgb: np.ndarray[Any, np.dtype[np.float32]],
    src: str,
    dst: str,
) -> np.ndarray[Any, np.dtype[np.float32]]:
    out = rgb.copy()
    if src == dst or src == "raw" or dst == "raw":
        return out
    # Linearize common encoded inputs
    if src in ("srgb", "display_p3"):
        linear = np.power(np.maximum((out + 0.055) / 1.055, 0.0), 2.4)
        out = np.where(out <= 0.04045, out / 12.92, linear)
    elif src == "rec709":
        out = np.power(np.maximum(out, 0.0), 2.4)
    # Approximate AP1 (ACEScg) -> Linear sRGB 3x3
    if src == "acescg":
        m = np.array(
            [
                [1.70505, -0.62179, -0.08326],
                [-0.13026, 1.14080, -0.01055],
                [-0.02400, -0.12897, 1.15297],
            ],
            dtype=np.float32,
        )
        out = out @ m.T
    # Display encode
    if dst in ("srgb", "display_p3"):
        c = np.maximum(out, 0.0)
        out = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)
    elif dst in ("rec709", "rec2020"):
        out = np.power(np.maximum(out, 0.0), 1.0 / 2.2)
    return np.asarray(np.clip(out, -0.5, 4.0), dtype=np.float32)


def bake_3d_lut(
    src: str,
    dst: str,
    size: int = 17,
    config_path: str | None = None,
) -> BakedLutResult:
    cube_size = 9 if size <= 9 else 17 if size <= 17 else 33
    cfg, cfg_name, cfg_hash = _load_ocio_config(config_path)
    key = (cfg_hash, src, dst, cube_size)
    if key in _LUT_CACHE:
        return _LUT_CACHE[key]

    axis = np.linspace(0.0, 1.0, cube_size, dtype=np.float32)
    b, g, r = np.meshgrid(axis, axis, axis, indexing="ij")
    grid = np.stack([r, g, b], axis=-1).reshape(-1, 3).astype(np.float32)

    engine = "builtin_fallback"
    if cfg is not None:
        src_name = _resolve_cs_name(cfg, src)
        dst_name = _resolve_cs_name(cfg, dst)
        if src_name and dst_name:
            proc = cfg.getProcessor(src_name, dst_name)
            cpu = proc.getDefaultCPUProcessor()
            cpu.applyRGB(grid)
            engine = "opencolorio"
        else:
            grid = _fallback_apply_rgb(grid, src, dst)
    else:
        grid = _fallback_apply_rgb(grid, src, dst)

    values = [round(float(x), 6) for x in grid.reshape(-1)]
    cache_key = hashlib.sha256(f"{cfg_hash}:{src}:{dst}:{cube_size}".encode()).hexdigest()[:16]
    res = BakedLutResult(
        src=src,
        dst=dst,
        size=cube_size,
        engine=engine,
        config_name=cfg_name,
        cache_key=cache_key,
        values=values,
    )
    _LUT_CACHE[key] = res
    return res


def get_ocio_status() -> dict[str, str]:
    cfg, cfg_name, _ = _load_ocio_config()
    return {
        "ocio_version": str(PyOpenColorIO.GetVersion()),
        "config_name": cfg_name if cfg is not None else "builtin_fallback",
    }
