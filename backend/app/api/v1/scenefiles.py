from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse
from watchfiles import awatch

from app.core.deps import get_db, get_format_registry, get_project_context
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.project_registry import ProjectContext
from app.core.security import get_project_auth, require_not_archived
from app.formats.base import FormatRegistry, InspectionDocument
from app.schemas.api import (
    SceneDeleteRequest,
    SceneEntryOut,
    SceneListResponse,
    SceneMkdirRequest,
    SceneMoveRequest,
    SceneRenameRequest,
)
from app.services.entity_service import (
    move_to_trash,
    register_active_watch,
    unregister_active_watch,
)
from app.services.naming import check_case_insensitive_collision, sanitize_folder_name
from app.services.permissions import AuthContext, assert_can, can
from app.services.publish_service import load_task_with_product, task_dirs
from app.services.streaming import build_ranged_file_response
from app.storage.local import LocalStorage

router = APIRouter(tags=["scenefiles"])

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".tga", ".webp", ".bmp", ".exr", ".hdr"}
_MEDIA_EXTS = _IMAGE_EXTS | {
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".wav",
    ".flac",
    ".ogg",
    ".mp3",
    ".gltf",
    ".glb",
    ".obj",
    ".usda",
    ".usdc",
    ".usd",
    ".pdf",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".edl",
}


def _resolve_in_scenefiles(scenefiles_root: Path, rel_path: str) -> Path:
    root = scenefiles_root.resolve()
    clean = rel_path.strip().strip("/\\")
    if not clean:
        return root
    cand = (root / clean).resolve()
    try:
        cand.relative_to(root)
    except ValueError as exc:
        raise AppError("invalid_path", "Path escapes task scenefiles/", status_code=400) from exc
    return cand


async def _task_scenefiles_root(
    db: AsyncSession,
    ctx: ProjectContext,
    task_id: UUID,
    auth: AuthContext,
    *,
    write: bool = False,
) -> Path:
    if auth.role.name == "client":
        raise NotFoundError("task", str(task_id))
    task, _ = await load_task_with_product(db, task_id)
    if write:
        await require_not_archived(auth)
        if not auth.has_any_scope("entity.manage"):
            ok, _ = await can(db, auth, "product.publish", task)
            if not ok:
                raise AppError(
                    "forbidden", "Insufficient permissions to modify scenefiles", status_code=403
                )
    else:
        await assert_can(db, auth, "media.view", task)
    _, _, scene_dir = task_dirs(ctx, task)
    scene_dir.mkdir(parents=True, exist_ok=True)
    return scene_dir


@router.get("/tasks/{task_id}/scenefiles", response_model=SceneListResponse)
async def list_scenefiles(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    path: str = Query(default=""),
) -> SceneListResponse:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth)
    target = _resolve_in_scenefiles(scene_root, path)
    if not target.exists() or not target.is_dir():
        raise NotFoundError("scenefile_dir", path)

    def _scan() -> list[SceneEntryOut]:
        items: list[SceneEntryOut] = []
        children = sorted(
            (p for p in target.iterdir() if not p.name.startswith(".")),
            key=lambda p: (not p.is_dir(), p.name.lower()),
        )
        for child in children:
            stat = child.stat()
            rel = child.relative_to(scene_root.resolve()).as_posix()
            proj_rel = child.resolve().relative_to(ctx.root.resolve()).as_posix()
            ext = "" if child.is_dir() else child.suffix.lower()
            is_img = (not child.is_dir()) and ext in _IMAGE_EXTS
            is_med = (not child.is_dir()) and ext in _MEDIA_EXTS
            thumb = (
                f"/api/v1/projects/{ctx.uuid}/tasks/{task_id}/scenefiles/thumbnail?path={rel}"
                if is_img
                else None
            )
            items.append(
                SceneEntryOut(
                    name=child.name,
                    rel_path=rel,
                    project_rel_path=proj_rel,
                    is_dir=child.is_dir(),
                    size=0 if child.is_dir() else stat.st_size,
                    mtime=stat.st_mtime,
                    extension=ext,
                    is_image=is_img,
                    is_media=is_med,
                    thumb_url=thumb,
                )
            )
        return items

    entries = await asyncio.to_thread(_scan)
    cur_rel = (
        ""
        if target.resolve() == scene_root.resolve()
        else target.relative_to(scene_root.resolve()).as_posix()
    )
    parent_rel = None if not cur_rel else ("" if "/" not in cur_rel else cur_rel.rsplit("/", 1)[0])
    try:
        cur_proj_rel: str | None = target.resolve().relative_to(ctx.root.resolve()).as_posix()
    except ValueError:
        cur_proj_rel = None
    return SceneListResponse(
        current_path=cur_rel,
        parent_path=parent_rel,
        entries=entries,
        current_project_rel_path=cur_proj_rel,
    )


@router.get("/tasks/{task_id}/scenefiles/thumbnail")
async def get_scenefile_thumbnail(
    task_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    path: str = Query(...),
) -> Response:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth)
    target = _resolve_in_scenefiles(scene_root, path)
    if not target.is_file():
        raise NotFoundError("scenefile", path)

    stat = target.stat()
    key_raw = f"{target.as_posix()}:{stat.st_mtime}:{stat.st_size}".encode()
    digest = hashlib.sha256(key_raw).hexdigest()
    thumb_key = f"scene_thumbs/{digest[:2]}/{digest}.png"
    thumb_storage = LocalStorage(ctx.cache_dir)
    out_path = thumb_storage.resolve_safe(thumb_key)

    if not out_path.is_file():

        def _make_thumb() -> None:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(target) as im:
                rgb = im.convert("RGBA")
                rgb.thumbnail((128, 128), Image.Resampling.LANCZOS)
                rgb.save(out_path, format="PNG")

        try:
            await asyncio.to_thread(_make_thumb)
        except Exception as exc:
            raise AppError(
                "thumbnail_error", f"Cannot render thumbnail: {exc}", status_code=400
            ) from exc

    return build_ranged_file_response(
        request,
        thumb_storage,
        thumb_key,
        etag_token=digest,
        media_type="image/png",
        immutable=True,
    )


@router.get("/tasks/{task_id}/scenefiles/content")
async def get_scenefile_content(
    task_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    path: str = Query(...),
) -> Response:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth)
    target = _resolve_in_scenefiles(scene_root, path)
    if not target.is_file():
        raise NotFoundError("scenefile", path)
    scene_storage = LocalStorage(scene_root)
    rel = target.relative_to(scene_root.resolve()).as_posix()
    mime, _ = mimetypes.guess_type(target.name)
    stat = target.stat()
    return build_ranged_file_response(
        request,
        scene_storage,
        rel,
        etag_token=f"{stat.st_mtime}-{stat.st_size}",
        media_type=mime or "application/octet-stream",
        immutable=False,
    )


@router.get("/tasks/{task_id}/scenefiles/inspect", response_model=InspectionDocument)
async def inspect_scenefile_live(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
    path: str = Query(...),
) -> InspectionDocument:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth)
    target = _resolve_in_scenefiles(scene_root, path)
    if not target.is_file():
        raise NotFoundError("scenefile", path)
    handler = registry.resolve(target)
    probe = await handler.probe(target)
    doc = await handler.inspect(target, probe)
    stat = target.stat()
    doc.summary.setdefault("size", stat.st_size)
    doc.summary.setdefault("handler_id", handler.handler_id)
    doc.summary.setdefault(
        "scenefile_rel_path", target.relative_to(scene_root.resolve()).as_posix()
    )
    return doc


@router.post("/tasks/{task_id}/scenefiles/mkdir", status_code=201)
async def mkdir_scenefile(
    task_id: UUID,
    payload: SceneMkdirRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth, write=True)
    parent = _resolve_in_scenefiles(scene_root, payload.path)
    if not parent.is_dir():
        raise NotFoundError("scenefile_dir", payload.path)
    clean = sanitize_folder_name(payload.name)
    if await asyncio.to_thread(check_case_insensitive_collision, parent, clean):
        raise ConflictError(f"Folder '{clean}' already exists")
    dest = parent / clean
    await asyncio.to_thread(dest.mkdir, parents=False, exist_ok=False)
    return {"rel_path": dest.relative_to(scene_root.resolve()).as_posix()}


@router.post("/tasks/{task_id}/scenefiles/upload", status_code=201)
async def upload_scenefiles(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    files: list[UploadFile] = File(...),
    path: str = Form(default=""),
) -> dict[str, list[str]]:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth, write=True)
    dest_dir = _resolve_in_scenefiles(scene_root, path)
    if not dest_dir.is_dir():
        raise NotFoundError("scenefile_dir", path)
    saved: list[str] = []
    for up in files:
        raw_name = Path(up.filename or "upload.bin").name
        if not raw_name or raw_name in (".", ".."):
            raw_name = "upload.bin"
        dest = dest_dir / raw_name
        with dest.open("wb") as fh:
            while True:
                chunk = await up.read(65536)
                if not chunk:
                    break
                fh.write(chunk)
        saved.append(dest.relative_to(scene_root.resolve()).as_posix())
    return {"uploaded": saved}


@router.post("/tasks/{task_id}/scenefiles/rename")
async def rename_scenefile(
    task_id: UUID,
    payload: SceneRenameRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth, write=True)
    src = _resolve_in_scenefiles(scene_root, payload.rel_path)
    if src.resolve() == scene_root.resolve():
        raise AppError("invalid_path", "Cannot rename scenefiles root", status_code=400)
    if not src.exists():
        raise NotFoundError("scenefile", payload.rel_path)
    if "/" in payload.new_name or "\\" in payload.new_name:
        raise AppError("invalid_name", "Name cannot contain path separators", status_code=400)
    new_name = (
        payload.new_name.strip() if not src.is_dir() else sanitize_folder_name(payload.new_name)
    )
    if not new_name or new_name in (".", ".."):
        raise AppError("invalid_name", "New name cannot be empty", status_code=400)
    dest = src.parent / new_name
    if dest.resolve() != src.resolve():
        collision = await asyncio.to_thread(
            check_case_insensitive_collision, src.parent, new_name, src.name
        )
        if collision:
            raise ConflictError(f"'{new_name}' already exists")
        await asyncio.to_thread(shutil.move, str(src), str(dest))
    return {"rel_path": dest.relative_to(scene_root.resolve()).as_posix()}


@router.post("/tasks/{task_id}/scenefiles/move")
async def move_scenefiles(
    task_id: UUID,
    payload: SceneMoveRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, list[str]]:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth, write=True)
    dest_dir = _resolve_in_scenefiles(scene_root, payload.dest_dir)
    if not dest_dir.is_dir():
        raise NotFoundError("scenefile_dir", payload.dest_dir)
    moved: list[str] = []
    for rel in payload.rel_paths:
        src = _resolve_in_scenefiles(scene_root, rel)
        if not src.exists() or src.resolve() == scene_root.resolve():
            continue
        dst = dest_dir / src.name
        if dst.resolve() == src.resolve():
            continue
        if src.is_dir():
            try:
                dst.resolve().relative_to(src.resolve())
                raise AppError("invalid_path", "Cannot move folder into itself", status_code=400)
            except ValueError:
                pass
        if await asyncio.to_thread(check_case_insensitive_collision, dest_dir, src.name):
            raise ConflictError(f"Destination already contains '{src.name}'")
        await asyncio.to_thread(shutil.move, str(src), str(dst))
        moved.append(dst.relative_to(scene_root.resolve()).as_posix())
    return {"moved": moved}


@router.post("/tasks/{task_id}/scenefiles/delete")
async def delete_scenefiles(
    task_id: UUID,
    payload: SceneDeleteRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, int]:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth, write=True)
    count = 0
    for rel in payload.rel_paths:
        target = _resolve_in_scenefiles(scene_root, rel)
        if target.resolve() == scene_root.resolve() or not target.exists():
            continue
        await asyncio.to_thread(move_to_trash, ctx.trash_dir, target)
        count += 1
    return {"trashed": count}


@router.get("/tasks/{task_id}/scenefiles/watch")
async def watch_scenefiles_sse(
    task_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    path: str = Query(default=""),
) -> EventSourceResponse:
    scene_root = await _task_scenefiles_root(db, ctx, task_id, auth)
    target = _resolve_in_scenefiles(scene_root, path)
    if not target.is_dir():
        target = scene_root

    async def _gen() -> AsyncIterator[dict[str, str]]:
        stop_ev = asyncio.Event()
        register_active_watch(target, stop_ev)
        try:
            async for changes in awatch(target, debounce=250, stop_event=stop_ev):
                if await request.is_disconnected():
                    stop_ev.set()
                    break
                yield {"event": "changed", "data": json.dumps({"count": len(changes)})}
        except asyncio.CancelledError:
            stop_ev.set()
        finally:
            unregister_active_watch(stop_ev)

    return EventSourceResponse(_gen())
