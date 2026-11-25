from __future__ import annotations

import asyncio
import os
import platform
import subprocess
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_db, get_project_context, get_settings_dep
from app.core.errors import AppError, NotFoundError
from app.core.project_registry import ProjectContext
from app.core.settings import Settings
from app.models.app_db import Launcher
from app.schemas.api import LaunchRequest, LaunchResponse, RevealRequest
from app.services.launcher_service import (
    build_launch_argv,
    ensure_inside_root,
    is_loopback_client,
    spawn_detached,
)

router = APIRouter(tags=["launch"])


def _assert_loopback_and_origin(request: Request, settings: Settings) -> None:
    if not is_loopback_client(settings.bind_host):
        raise AppError(
            "forbidden",
            "Local launching is disabled when ORGANUM is bound to a non-loopback address",
            status_code=403,
        )
    client_host = request.client.host if request.client else None
    if not is_loopback_client(client_host):
        raise AppError(
            "forbidden",
            "Local launching is restricted to loopback clients",
            status_code=403,
        )
    origin = request.headers.get("origin")
    if origin:
        parsed = urlparse(origin)
        if parsed.hostname and not is_loopback_client(parsed.hostname):
            raise AppError(
                "forbidden",
                f"Origin '{parsed.hostname}' is not allowed to launch local executables",
                status_code=403,
            )


def _resolve_project_target(ctx: ProjectContext, rel_path: str) -> Path:
    clean = rel_path.strip().lstrip("/\\")
    if (ctx.root / clean).exists():
        return ensure_inside_root(ctx.root, clean)
    return ensure_inside_root(ctx.root, f"01_Production/{clean}")


def _os_open_default(target: Path) -> None:
    sys_name = platform.system()
    if sys_name == "Windows":
        startfile = getattr(os, "startfile", None)
        if startfile is not None:
            startfile(str(target))
    elif sys_name == "Darwin":
        spawn_detached(["open", str(target)])
    else:
        spawn_detached(["xdg-open", str(target)])


def _os_reveal(target: Path) -> None:
    sys_name = platform.system()
    if sys_name == "Windows":
        if target.is_file():
            subprocess.Popen(
                ["explorer.exe", f"/select,{target}"],
                shell=False,
                close_fds=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            spawn_detached(["explorer.exe", str(target)])
    elif sys_name == "Darwin":
        if target.is_file():
            spawn_detached(["open", "-R", str(target)])
        else:
            spawn_detached(["open", str(target)])
    else:
        folder = target if target.is_dir() else target.parent
        spawn_detached(["xdg-open", str(folder)])


@router.post("/launch", response_model=LaunchResponse)
async def launch_file_endpoint(
    payload: LaunchRequest,
    request: Request,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> LaunchResponse:
    _assert_loopback_and_origin(request, settings)
    target = _resolve_project_target(ctx, payload.rel_path)

    launcher: Launcher | None = None
    if payload.launcher_id is not None:
        launcher = await app_db.get(Launcher, payload.launcher_id)
        if launcher is None:
            raise NotFoundError("launcher", str(payload.launcher_id))
    else:
        ext = target.suffix.lower()
        if ext:
            rows = (
                await app_db.execute(
                    select(Launcher)
                    .where(Launcher.extension == ext)
                    .order_by(Launcher.is_default.desc(), Launcher.label.asc())
                )
            ).scalars().all()
            launcher = rows[0] if rows else None

    if launcher is not None:
        exe = Path(launcher.executable_path)
        if not await asyncio.to_thread(exe.exists):
            raise AppError(
                "launcher_missing",
                f"Configured launcher executable not found: {launcher.executable_path}",
                status_code=400,
            )
        argv = build_launch_argv(launcher.executable_path, launcher.args_template, target)
        await asyncio.to_thread(spawn_detached, argv)
        return LaunchResponse(launched=True, method=launcher.label, target=str(target))

    try:
        await asyncio.to_thread(_os_open_default, target)
    except OSError as exc:
        raise AppError(
            "launch_failed",
            f"No launcher configured for '{target.suffix or target.name}' "
            f"and OS open failed: {exc}",
            status_code=400,
        ) from exc
    return LaunchResponse(launched=True, method="os_default", target=str(target))


@router.post("/reveal", response_model=LaunchResponse)
async def reveal_in_file_manager(
    payload: RevealRequest,
    request: Request,
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> LaunchResponse:
    _assert_loopback_and_origin(request, settings)
    target = _resolve_project_target(ctx, payload.rel_path)
    try:
        await asyncio.to_thread(_os_reveal, target)
    except OSError as exc:
        raise AppError(
            "reveal_failed", f"Unable to open file manager: {exc}", status_code=400
        ) from exc
    return LaunchResponse(launched=True, method="file_manager", target=str(target))
