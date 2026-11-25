from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.project_entities import (
    _client_product_out,
    _product_out,
    _product_version_out,
)
from app.core.deps import get_db, get_format_registry, get_project_context
from app.core.errors import NotFoundError
from app.core.project_registry import ProjectContext
from app.core.security import get_project_auth, require, require_not_archived
from app.formats.base import FormatRegistry
from app.schemas.api import (
    ClientProductOut,
    ProductMasterPutRequest,
    ProductOut,
    ProductVersionOut,
    PublishScenefilesRequest,
)
from app.services.permissions import AuthContext, assert_can, client_shared_version_ids
from app.services.publish_service import (
    load_task_with_product,
    publish_from_scenefiles,
    publish_from_uploads,
    set_product_master,
    soft_delete_version,
)

router = APIRouter(tags=["products"])


@router.get("/tasks/{task_id}/product", response_model=ProductOut | ClientProductOut)
async def get_task_product(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProductOut | ClientProductOut:
    task, _ = await load_task_with_product(db, task_id)
    if auth.role.name == "client":
        shared_vers = await client_shared_version_ids(db, auth.user.company_id)
        client_prod = _client_product_out(task, shared_vers)
        if client_prod is None:
            raise NotFoundError("task", str(task_id))
        return client_prod
    await assert_can(db, auth, "product.view", task)
    await db.commit()
    prod = _product_out(task)
    assert prod is not None
    return prod


@router.post("/tasks/{task_id}/publish", response_model=ProductVersionOut, status_code=201)
async def publish_scenefiles_endpoint(
    task_id: UUID,
    payload: PublishScenefilesRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
) -> ProductVersionOut:
    await require_not_archived(auth)
    task, _ = await load_task_with_product(db, task_id)
    await assert_can(db, auth, "product.publish", task)
    version = await publish_from_scenefiles(
        db,
        ctx,
        registry,
        task_id,
        payload.scenefile_rel_paths,
        comment=payload.comment,
        set_master=payload.set_master,
        created_by_user_id=auth.user.id,
    )
    task, _ = await load_task_with_product(db, task_id)
    loaded_v = next(v for v in task.product.versions if v.id == version.id)  # type: ignore[union-attr]
    return _product_version_out(loaded_v, author_name=auth.user.full_name)


@router.post("/tasks/{task_id}/publish/upload", response_model=ProductVersionOut, status_code=201)
async def publish_upload_endpoint(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
    registry: Annotated[FormatRegistry, Depends(get_format_registry)],
    files: list[UploadFile] = File(...),
    comment: str = Form(default=""),
    set_master: bool | None = Form(default=None),
) -> ProductVersionOut:
    await require_not_archived(auth)
    task, _ = await load_task_with_product(db, task_id)
    await assert_can(db, auth, "product.publish", task)
    version = await publish_from_uploads(
        db,
        ctx,
        registry,
        task_id,
        files,
        comment=comment,
        set_master=set_master,
        created_by_user_id=auth.user.id,
    )
    task, _ = await load_task_with_product(db, task_id)
    loaded_v = next(v for v in task.product.versions if v.id == version.id)  # type: ignore[union-attr]
    return _product_version_out(loaded_v, author_name=auth.user.full_name)


@router.put("/products/{product_id}/master", response_model=ProductOut)
async def set_product_master_endpoint(
    product_id: UUID,
    payload: ProductMasterPutRequest,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProductOut:
    await require_not_archived(auth)
    from app.models.project_db import Product

    prod_row = await db.get(Product, product_id)
    if prod_row is None:
        raise NotFoundError("product", str(product_id))
    task, _ = await load_task_with_product(db, prod_row.task_id)
    if not auth.has_any_scope("entity.manage"):
        ok = await assert_can(db, auth, "product.publish", task)
        _ = ok
    prod = await set_product_master(db, ctx, product_id, payload.version_id)
    task, _ = await load_task_with_product(db, prod.task_id)
    out = _product_out(task)
    assert out is not None
    return out


@router.delete("/versions/{version_id}", status_code=204)
async def delete_product_version_endpoint(
    version_id: UUID,
    auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    _ = auth
    await soft_delete_version(db, ctx, version_id)
    return Response(status_code=204)
