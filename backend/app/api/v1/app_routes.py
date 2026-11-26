from __future__ import annotations

import asyncio
import os
import platform
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_db, get_project_registry, get_settings_dep
from app.core.errors import AppError, NotFoundError
from app.core.project_registry import ProjectRegistry
from app.core.security import (
    check_origin,
    get_current_auth,
    get_optional_auth,
    require_admin_global,
)
from app.core.settings import Settings
from app.models.app_db import KnownProject, Launcher, UiPref
from app.schemas.api import (
    AutodetectedLauncherOut,
    FsBrowseResponse,
    FsDirEntryOut,
    KnownProjectOut,
    LauncherOut,
    LaunchersPutRequest,
    ProjectCreateRequest,
    ProjectOpenRequest,
    UiPrefOut,
    UiPrefPutRequest,
)
from app.services.launcher_service import autodetect_launchers, is_loopback_client
from app.services.permissions import AuthContext

router = APIRouter(tags=["app"])


async def _has_valid_projects(app_db: AsyncSession) -> bool:
    rows = (await app_db.execute(select(KnownProject))).scalars().all()
    return any((Path(r.path) / "00_Pipeline" / "project.json").is_file() for r in rows)


def _to_known_out(k: KnownProject) -> KnownProjectOut:
    p = Path(k.path)
    exists = (p / "00_Pipeline" / "project.json").is_file()
    return KnownProjectOut(
        uuid=k.uuid,
        name=k.name,
        path=k.path,
        last_opened=k.last_opened,
        exists_on_disk=exists,
    )


@router.get("/projects", response_model=list[KnownProjectOut])
async def list_known_projects(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> list[KnownProjectOut]:
    rows = (
        (await app_db.execute(select(KnownProject).order_by(KnownProject.last_opened.desc())))
        .scalars()
        .all()
    )
    if auth.role.name in {"client", "external"}:
        rows = [r for r in rows if r.uuid == auth.project_uuid]
    return [_to_known_out(r) for r in rows]


@router.post("/projects", response_model=KnownProjectOut, status_code=201)
async def create_new_project(
    payload: ProjectCreateRequest,
    request: Request,
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
    auth: Annotated[AuthContext | None, Depends(get_optional_auth)] = None,
) -> KnownProjectOut:
    check_origin(request, settings)
    await _require_admin_unless_bootstrapping(app_db, auth, "create projects")
    ctx = await registry.create_project(
        app_db,
        path=Path(payload.path),
        name=payload.name,
        starter_departments=payload.starter_departments,
    )
    known = await app_db.get(KnownProject, ctx.uuid)
    assert known is not None
    return _to_known_out(known)


async def _require_admin_unless_bootstrapping(
    app_db: AsyncSession, auth: AuthContext | None, action: str
) -> None:
    """Allow anonymous access only while no usable project exists (first run)."""
    if not await _has_valid_projects(app_db):
        return
    if auth is None:
        raise AppError("unauthorized", f"Authentication required to {action}", status_code=401)
    if auth.role.name != "admin":
        raise AppError("forbidden", f"Only administrators can {action}", status_code=403)


@router.post("/projects/open", response_model=KnownProjectOut)
async def open_existing_project(
    payload: ProjectOpenRequest,
    request: Request,
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
    auth: Annotated[AuthContext | None, Depends(get_optional_auth)] = None,
) -> KnownProjectOut:
    check_origin(request, settings)
    # First run with only stale entries: "locate" an existing project folder anonymously.
    await _require_admin_unless_bootstrapping(app_db, auth, "open projects")
    ctx, _ = await registry.open_project(app_db, Path(payload.path))
    known = await app_db.get(KnownProject, ctx.uuid)
    assert known is not None
    return _to_known_out(known)


@router.delete("/projects/{project_uuid}", status_code=204)
async def forget_known_project(
    project_uuid: str,
    _auth: Annotated[AuthContext, Depends(require_admin_global())],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
) -> Response:
    await registry.forget_project(app_db, project_uuid)
    return Response(status_code=204)


def _list_drives() -> list[str]:
    if platform.system() != "Windows":
        return ["/"]
    drives: list[str] = []
    for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        cand = f"{letter}:\\"
        if os.path.exists(cand):
            drives.append(cand)
    return drives or ["C:\\"]


def _browse_sync(path_str: str, fallback_dir: Path) -> FsBrowseResponse:
    drives = _list_drives()
    if path_str.strip():
        target = Path(path_str.strip()).resolve()
    else:
        target = fallback_dir.resolve()
        if not target.exists():
            target = Path.home().resolve()

    if not target.exists() or not target.is_dir():
        raise AppError("not_found", f"Directory '{target}' does not exist", status_code=404)

    dirs: list[FsDirEntryOut] = []
    try:
        for child in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            if child.is_dir() and not child.name.startswith("."):
                dirs.append(FsDirEntryOut(name=child.name, path=str(child)))
    except PermissionError:
        dirs = []

    parent = str(target.parent) if target.parent != target else None
    return FsBrowseResponse(
        current_path=str(target),
        parent_path=parent,
        drives=drives,
        directories=dirs,
    )


@router.get("/fs/browse", response_model=FsBrowseResponse)
async def browse_server_folders(
    request: Request,
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
    auth: Annotated[AuthContext | None, Depends(get_optional_auth)] = None,
    path: str = Query(default=""),
) -> FsBrowseResponse:
    if await _has_valid_projects(app_db):
        if auth is None:
            raise AppError("unauthorized", "Authentication required", status_code=401)
        if auth.role.name != "admin":
            raise AppError(
                "forbidden", "Only administrators can browse server folders", status_code=403
            )
    client_host = request.client.host if request.client else None
    if not is_loopback_client(settings.bind_host) or not is_loopback_client(client_host):
        raise AppError(
            "forbidden",
            "Server filesystem browser is only available on loopback bindings",
            status_code=403,
        )
    return await asyncio.to_thread(_browse_sync, path, settings.demo_project_path.parent)


@router.get("/launchers", response_model=list[LauncherOut])
async def list_launchers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> list[LauncherOut]:
    if auth.role.name == "client":
        raise AppError("forbidden", "Launchers are not accessible to clients", status_code=403)
    rows = (
        (await app_db.execute(select(Launcher).order_by(Launcher.extension, Launcher.label)))
        .scalars()
        .all()
    )
    return [
        LauncherOut(
            id=r.id,
            extension=r.extension,
            label=r.label,
            executable_path=r.executable_path,
            args_template=r.args_template,
            is_default=r.is_default,
        )
        for r in rows
    ]


@router.put("/launchers", response_model=list[LauncherOut])
async def save_launchers(
    payload: LaunchersPutRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> list[LauncherOut]:
    if auth.role.name != "admin" and not auth.has_any_scope("scenefile.launch"):
        raise AppError(
            "forbidden", "Insufficient permissions to configure launchers", status_code=403
        )
    await app_db.execute(delete(Launcher))
    created: list[Launcher] = []
    for item in payload.launchers:
        ext = item.extension.strip().lower()
        if not ext:
            continue
        if not ext.startswith("."):
            ext = f".{ext}"
        row = Launcher(
            id=item.id or uuid.uuid4(),
            extension=ext,
            label=item.label.strip() or ext,
            executable_path=item.executable_path.strip(),
            args_template=item.args_template.strip() or "{file}",
            is_default=item.is_default,
        )
        app_db.add(row)
        created.append(row)
    await app_db.commit()
    return [
        LauncherOut(
            id=r.id,
            extension=r.extension,
            label=r.label,
            executable_path=r.executable_path,
            args_template=r.args_template,
            is_default=r.is_default,
        )
        for r in created
    ]


@router.post("/launchers/autodetect", response_model=list[AutodetectedLauncherOut])
async def autodetect_installed_launchers(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
) -> list[AutodetectedLauncherOut]:
    if auth.role.name != "admin" and not auth.has_any_scope("scenefile.launch"):
        raise AppError(
            "forbidden", "Insufficient permissions to autodetect launchers", status_code=403
        )
    return [AutodetectedLauncherOut(**item) for item in autodetect_launchers()]


@router.get("/ui-prefs", response_model=list[UiPrefOut])
async def list_ui_prefs(
    _auth: Annotated[AuthContext, Depends(get_current_auth)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> list[UiPrefOut]:
    rows = (await app_db.execute(select(UiPref).order_by(UiPref.key))).scalars().all()
    return [UiPrefOut(key=r.key, value_json=r.value_json) for r in rows]


@router.put("/ui-prefs/{key}", response_model=UiPrefOut)
async def put_ui_pref(
    key: str,
    payload: UiPrefPutRequest,
    _auth: Annotated[AuthContext, Depends(get_current_auth)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> UiPrefOut:
    existing = await app_db.get(UiPref, key)
    if existing is None:
        existing = UiPref(key=key, value_json=payload.value_json)
        app_db.add(existing)
    else:
        existing.value_json = payload.value_json
    await app_db.commit()
    return UiPrefOut(key=existing.key, value_json=existing.value_json)


@router.get("/icons", response_model=list[str])
async def list_custom_extension_icons(
    _auth: Annotated[AuthContext, Depends(get_current_auth)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> list[str]:
    """List available user override icon extensions from data/icons/."""
    icons_root = settings.icons_dir.resolve()

    def _scan() -> list[str]:
        if not icons_root.is_dir():
            return []
        exts: set[str] = set()
        for p in icons_root.iterdir():
            if p.is_file() and p.suffix.lower() in (".png", ".svg") and p.stem.isalnum():
                exts.add(p.stem.lower())
        return sorted(exts)

    return await asyncio.to_thread(_scan)


@router.get("/icons/{ext}")
async def get_custom_extension_icon(
    ext: str,
    _auth: Annotated[AuthContext, Depends(get_current_auth)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> Response:
    """Serve optional user override icon from data/icons/<ext>.(png|svg)."""
    clean_ext = ext.strip().lower().lstrip(".")
    if not clean_ext or not clean_ext.isalnum():
        raise AppError("invalid_name", "Invalid icon extension", status_code=400)
    icons_root = settings.icons_dir.resolve()
    for suffix, media in ((".png", "image/png"), (".svg", "image/svg+xml")):
        candidate = (icons_root / f"{clean_ext}{suffix}").resolve()
        try:
            candidate.relative_to(icons_root)
        except ValueError:
            continue
        if candidate.is_file():
            return Response(content=candidate.read_bytes(), media_type=media)
    raise NotFoundError("icon", clean_ext)
