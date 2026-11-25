from __future__ import annotations

from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.errors import AppError, NotFoundError
from app.core.security import client_ip_from_request, get_project_auth, require
from app.models.project_db import Department, Entity
from app.models.tasks import DependencyTemplate, EntityLink
from app.schemas.api import (
    ApplyDependenciesRequest,
    DependencyTemplateCreateRequest,
    DependencyTemplateOut,
    DependencyTemplateUpdateRequest,
    EntityGraphEdgeOut,
    EntityGraphNodeOut,
    EntityLinkBulkCreateRequest,
    EntityLinkCreateRequest,
    EntityLinkOut,
    EntityLinksGraphOut,
    EntityLinksResponse,
    IndirectEntityLinkOut,
    SuggestDependenciesRequest,
    SuggestedDependencyOut,
)
from app.services.entity_links_service import (
    apply_suggested_dependencies,
    bulk_create_entity_links,
    create_entity_link,
    delete_entity_link,
    get_entity_links_detailed,
    get_entity_links_graph,
    suggest_dependencies_for_entity,
)
from app.services.permissions import AuthContext
from app.services.task_service import get_project_policy

router = APIRouter(tags=["entity_links"])


def _has_any_perm(auth: AuthContext, *keys: str) -> bool:
    if auth.role.name == "admin":
        return True
    return any(auth.permissions.get(k, "none") != "none" for k in keys)


def _serialize_link(lk: EntityLink, ents: dict[UUID, Entity]) -> EntityLinkOut:
    src = ents.get(lk.source_entity_id)
    dst = ents.get(lk.target_entity_id)
    return EntityLinkOut(
        id=lk.id,
        source_entity_id=lk.source_entity_id,
        source_name=src.name if src else "",
        source_type=src.entity_type if src else None,
        source_archived=bool(src and src.archived_at is not None),
        target_entity_id=lk.target_entity_id,
        target_name=dst.name if dst else "",
        target_type=dst.entity_type if dst else None,
        target_archived=bool(dst and dst.archived_at is not None),
        link_type=lk.link_type,
        note=lk.note,
        created_at=lk.created_at,
    )


@router.get("/entities/{entity_id}/links", response_model=EntityLinksResponse)
async def get_entity_links_endpoint(
    entity_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EntityLinksResponse:
    if auth.role.name == "client":
        raise AppError("forbidden", "Entity links are not available to clients", status_code=403)
    if not _has_any_perm(auth, "task.view", "media.view", "entity.link"):
        raise AppError("forbidden", "Permission required", status_code=403)

    data = await get_entity_links_detailed(db, entity_id, max_depth=3)
    ents = cast(dict[UUID, Entity], data["entities_map"])
    uses = cast(list[EntityLink], data["uses"])
    used_in = cast(list[EntityLink], data["used_in"])
    uses_ind = cast(list[dict[str, Any]], data["uses_indirect"])
    used_in_ind = cast(list[dict[str, Any]], data["used_in_indirect"])

    return EntityLinksResponse(
        entity_id=entity_id,
        uses=[_serialize_link(lk, ents) for lk in uses],
        used_in=[_serialize_link(lk, ents) for lk in used_in],
        uses_indirect=[IndirectEntityLinkOut(**d) for d in uses_ind],
        used_in_indirect=[IndirectEntityLinkOut(**d) for d in used_in_ind],
        link_types=cast(list[str], data["link_types"]),
    )


@router.post("/entity-links", response_model=EntityLinkOut, status_code=201)
async def create_entity_link_endpoint(
    payload: EntityLinkCreateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("entity.link", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EntityLinkOut:
    link = await create_entity_link(
        db,
        auth,
        source_entity_id=payload.source_entity_id,
        target_entity_id=payload.target_entity_id,
        link_type=payload.link_type,
        note=payload.note,
        ip=client_ip_from_request(request),
    )
    ents = {
        e.id: e
        for e in (
            await db.execute(
                select(Entity).where(Entity.id.in_((link.source_entity_id, link.target_entity_id)))
            )
        )
        .scalars()
        .all()
    }
    return _serialize_link(link, ents)


@router.post("/entity-links/bulk", response_model=list[EntityLinkOut], status_code=201)
async def bulk_create_entity_links_endpoint(
    payload: EntityLinkBulkCreateRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("entity.link", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[EntityLinkOut]:
    links = await bulk_create_entity_links(
        db,
        auth,
        source_ids=payload.source_ids,
        target_ids=payload.target_ids,
        link_type=payload.link_type,
        note=payload.note,
        ip=client_ip_from_request(request),
    )
    if not links:
        return []
    ent_ids = {lk.source_entity_id for lk in links} | {lk.target_entity_id for lk in links}
    ents = {
        e.id: e
        for e in (await db.execute(select(Entity).where(Entity.id.in_(ent_ids)))).scalars().all()
    }
    return [_serialize_link(lk, ents) for lk in links]


@router.delete("/entity-links/{link_id}", status_code=204)
async def delete_entity_link_endpoint(
    link_id: UUID,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("entity.link", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    await delete_entity_link(db, auth, link_id, ip=client_ip_from_request(request))
    return Response(status_code=204)


@router.get("/entity-links/graph", response_model=EntityLinksGraphOut)
async def entity_links_graph_endpoint(
    auth: Annotated[AuthContext, Depends(require("views.graph"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_id: UUID | None = None,
    hops: Annotated[int, Query(ge=1, le=3)] = 2,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> EntityLinksGraphOut:
    if auth.role.name == "client":
        raise AppError("forbidden", "Entity graph is not available to clients", status_code=403)
    res = await get_entity_links_graph(db, entity_id=entity_id, hops=hops, limit=limit)
    nodes = [EntityGraphNodeOut(**n) for n in cast(list[dict[str, Any]], res["nodes"])]
    edges = [EntityGraphEdgeOut(**e) for e in cast(list[dict[str, Any]], res["edges"])]
    return EntityLinksGraphOut(nodes=nodes, edges=edges, truncated=bool(res["truncated"]))


@router.post(
    "/entities/{entity_id}/suggest-dependencies", response_model=list[SuggestedDependencyOut]
)
async def suggest_dependencies_endpoint(
    entity_id: UUID,
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    payload: SuggestDependenciesRequest | None = None,
) -> list[SuggestedDependencyOut]:
    if auth.role.name == "client":
        raise AppError("forbidden", "Dependency suggestions are not available to clients", 403)
    if not _has_any_perm(auth, "task.dependencies", "entity.link", "task.view"):
        raise AppError("forbidden", "Permission required", status_code=403)
    meta, _ = await get_project_policy(db)
    default_depth = meta.link_dependency_depth if meta else 1
    req_depth = payload.depth if payload and payload.depth is not None else default_depth
    rows = await suggest_dependencies_for_entity(
        db,
        entity_id,
        link_ids=payload.link_ids if payload else None,
        depth=req_depth,
    )
    return [SuggestedDependencyOut(**cast(dict[str, Any], r)) for r in rows]


@router.post("/entities/{entity_id}/apply-dependencies")
async def apply_dependencies_endpoint(
    entity_id: UUID,
    payload: ApplyDependenciesRequest,
    request: Request,
    auth: Annotated[AuthContext, Depends(require("task.dependencies", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, int]:
    added = await apply_suggested_dependencies(
        db,
        auth,
        entity_id=entity_id,
        pairs=[(p.downstream_task_id, p.upstream_task_id, p.threshold) for p in payload.pairs],
        ip=client_ip_from_request(request),
    )
    return {"applied": added}


@router.get("/dependency-templates", response_model=list[DependencyTemplateOut])
async def list_dependency_templates(
    auth: Annotated[AuthContext, Depends(get_project_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DependencyTemplateOut]:
    if auth.role.name == "client":
        raise AppError("forbidden", "Dependency templates are not available to clients", 403)
    rows = (
        (await db.execute(select(DependencyTemplate).order_by(DependencyTemplate.created_at.asc())))
        .scalars()
        .all()
    )
    depts = {d.id: d for d in (await db.execute(select(Department))).scalars().all()}
    return [
        DependencyTemplateOut(
            id=r.id,
            upstream_department_id=r.upstream_department_id,
            upstream_department_name=depts[r.upstream_department_id].name
            if r.upstream_department_id in depts
            else "",
            upstream_task_name=r.upstream_task_name,
            downstream_department_id=r.downstream_department_id,
            downstream_department_name=depts[r.downstream_department_id].name
            if r.downstream_department_id in depts
            else "",
            downstream_task_name=r.downstream_task_name,
            threshold=cast(Literal["APP", "PUBLISHED", "ANY_STATUS"], r.threshold),
            enabled=r.enabled,
        )
        for r in rows
    ]


@router.post("/dependency-templates", response_model=DependencyTemplateOut, status_code=201)
async def create_dependency_template(
    payload: DependencyTemplateCreateRequest,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DependencyTemplateOut:
    up_d = await db.get(Department, payload.upstream_department_id)
    dn_d = await db.get(Department, payload.downstream_department_id)
    if up_d is None:
        raise NotFoundError("department", str(payload.upstream_department_id))
    if dn_d is None:
        raise NotFoundError("department", str(payload.downstream_department_id))

    tpl = DependencyTemplate(
        upstream_department_id=up_d.id,
        upstream_task_name=payload.upstream_task_name.strip()
        if payload.upstream_task_name and payload.upstream_task_name.strip()
        else None,
        downstream_department_id=dn_d.id,
        downstream_task_name=payload.downstream_task_name.strip()
        if payload.downstream_task_name and payload.downstream_task_name.strip()
        else None,
        threshold=payload.threshold,
        enabled=payload.enabled,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return DependencyTemplateOut(
        id=tpl.id,
        upstream_department_id=tpl.upstream_department_id,
        upstream_department_name=up_d.name,
        upstream_task_name=tpl.upstream_task_name,
        downstream_department_id=tpl.downstream_department_id,
        downstream_department_name=dn_d.name,
        downstream_task_name=tpl.downstream_task_name,
        threshold=cast(Literal["APP", "PUBLISHED", "ANY_STATUS"], tpl.threshold),
        enabled=tpl.enabled,
    )


@router.patch("/dependency-templates/{template_id}", response_model=DependencyTemplateOut)
async def update_dependency_template(
    template_id: UUID,
    payload: DependencyTemplateUpdateRequest,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DependencyTemplateOut:
    tpl = await db.get(DependencyTemplate, template_id)
    if tpl is None:
        raise NotFoundError("dependency_template", str(template_id))
    if payload.upstream_department_id is not None:
        if await db.get(Department, payload.upstream_department_id) is None:
            raise NotFoundError("department", str(payload.upstream_department_id))
        tpl.upstream_department_id = payload.upstream_department_id
    if payload.downstream_department_id is not None:
        if await db.get(Department, payload.downstream_department_id) is None:
            raise NotFoundError("department", str(payload.downstream_department_id))
        tpl.downstream_department_id = payload.downstream_department_id
    if "upstream_task_name" in payload.model_fields_set:
        tpl.upstream_task_name = (
            payload.upstream_task_name.strip()
            if payload.upstream_task_name and payload.upstream_task_name.strip()
            else None
        )
    if "downstream_task_name" in payload.model_fields_set:
        tpl.downstream_task_name = (
            payload.downstream_task_name.strip()
            if payload.downstream_task_name and payload.downstream_task_name.strip()
            else None
        )
    if payload.threshold is not None:
        tpl.threshold = payload.threshold
    if payload.enabled is not None:
        tpl.enabled = payload.enabled
    await db.commit()
    await db.refresh(tpl)
    up_d = await db.get(Department, tpl.upstream_department_id)
    dn_d = await db.get(Department, tpl.downstream_department_id)
    return DependencyTemplateOut(
        id=tpl.id,
        upstream_department_id=tpl.upstream_department_id,
        upstream_department_name=up_d.name if up_d else "",
        upstream_task_name=tpl.upstream_task_name,
        downstream_department_id=tpl.downstream_department_id,
        downstream_department_name=dn_d.name if dn_d else "",
        downstream_task_name=tpl.downstream_task_name,
        threshold=cast(Literal["APP", "PUBLISHED", "ANY_STATUS"], tpl.threshold),
        enabled=tpl.enabled,
    )


@router.delete("/dependency-templates/{template_id}", status_code=204)
async def delete_dependency_template(
    template_id: UUID,
    _auth: Annotated[AuthContext, Depends(require("entity.manage", write=True))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    tpl = await db.get(DependencyTemplate, template_id)
    if tpl is None:
        raise NotFoundError("dependency_template", str(template_id))
    await db.delete(tpl)
    await db.commit()
    return Response(status_code=204)
