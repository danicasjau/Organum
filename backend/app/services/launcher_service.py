from __future__ import annotations

import ipaddress
import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

from app.core.errors import AppError

_CANDIDATE_APPS: list[dict[str, Any]] = [
    {
        "extension": ".hip",
        "label": "SideFX Houdini",
        "bins": ("houdinifx", "houdini", "happrentice"),
        "globs_win": (r"C:\Program Files\Side Effects Software\Houdini *\bin\houdinifx.exe",),
    },
    {
        "extension": ".hiplc",
        "label": "SideFX Houdini Indie",
        "bins": ("houdini", "hindie", "houdinifx"),
        "globs_win": (r"C:\Program Files\Side Effects Software\Houdini *\bin\hindie.exe",),
    },
    {
        "extension": ".ma",
        "label": "Autodesk Maya",
        "bins": ("maya",),
        "globs_win": (r"C:\Program Files\Autodesk\Maya*\bin\maya.exe",),
    },
    {
        "extension": ".mb",
        "label": "Autodesk Maya (Binary)",
        "bins": ("maya",),
        "globs_win": (r"C:\Program Files\Autodesk\Maya*\bin\maya.exe",),
    },
    {
        "extension": ".blend",
        "label": "Blender",
        "bins": ("blender",),
        "globs_win": (r"C:\Program Files\Blender Foundation\Blender*\blender.exe",),
    },
    {
        "extension": ".nk",
        "label": "Foundry Nuke",
        "bins": ("Nuke15.0", "Nuke14.0", "nuke"),
        "globs_win": (r"C:\Program Files\Nuke*\Nuke*.exe",),
    },
    {
        "extension": ".psd",
        "label": "Adobe Photoshop",
        "bins": ("photoshop",),
        "globs_win": (r"C:\Program Files\Adobe\Adobe Photoshop*\Photoshop.exe",),
    },
    {
        "extension": ".spp",
        "label": "Substance 3D Painter",
        "bins": ("Adobe Substance 3D Painter", "substance_painter"),
        "globs_win": (
            r"C:\Program Files\Adobe\Adobe Substance 3D Painter*\Adobe Substance 3D Painter.exe",
        ),
    },
]


def is_loopback_client(host: str | None) -> bool:
    if not host:
        return True
    if host in ("localhost", "127.0.0.1", "::1", "testclient"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def ensure_inside_root(root: Path, target_rel_or_abs: str) -> Path:
    resolved_root = root.resolve()
    candidate = (resolved_root / target_rel_or_abs.lstrip("/\\")).resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise AppError("invalid_path", "Target path escapes project root", status_code=400) from exc
    if not candidate.exists():
        raise AppError("not_found", f"Path does not exist: {target_rel_or_abs}", status_code=404)
    return candidate


def autodetect_launchers() -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    sys_name = platform.system()
    for spec in _CANDIDATE_APPS:
        exe_path: str | None = None
        for b in spec["bins"]:
            hit = shutil.which(b)
            if hit:
                exe_path = hit
                break
        if exe_path is None and sys_name == "Windows":
            for pattern in spec["globs_win"]:
                drive, rest = os.path.splitdrive(pattern)
                base = Path(f"{drive}/")
                matches = sorted(base.glob(rest.lstrip("\\/")), reverse=True)
                if matches:
                    exe_path = str(matches[0])
                    break
        if exe_path:
            found.append(
                {
                    "extension": str(spec["extension"]),
                    "label": str(spec["label"]),
                    "executable_path": exe_path,
                    "args_template": "{file}",
                }
            )
    return found


def build_launch_argv(executable_path: str, args_template: str, target_file: Path) -> list[str]:
    tokens = args_template.split() if args_template.strip() else ["{file}"]
    args = [
        str(target_file) if tok == "{file}" else tok.replace("{file}", str(target_file))
        for tok in tokens
    ]
    if "{file}" not in args_template:
        args.append(str(target_file))
    return [executable_path, *args]


def spawn_detached(argv: list[str]) -> None:
    subprocess.Popen(
        argv,
        shell=False,
        close_fds=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
