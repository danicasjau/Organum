from __future__ import annotations

from collections import deque
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.project_db import Department, Entity, Task
from app.models.tasks import DependencyTemplate, EntityLink, TaskDependency
from app.services.auth_service import write_audit
from app.services.permissions import AuthContext
from app.services.task_service import (
    add_task_dependencies_batch,
    would_create_task_dependency_cycle,
)


async def assert_no_entity_link_cycle(
    db: AsyncSession,
    *,
    source_entity_id: UUID,
    target_entity_id: UUID,
    extra_edges: list[tuple[UUID, UUID]] | None = None,
) -> None:
    """Reject self-links and directed cycles in source_entity -> target_entity."""
    if source_entity_id == target_entity_id:
        raise AppError("invalid_link", "An entity cannot be linked to itself", status_code=400)

    rows = (
        await db.execute(
            select(EntityLink.source_entity_id, EntityLink.target_entity_id).where(
                EntityLink.is_active.is_(True)
            )
        )
    ).all()
    adj: dict[UUID, list[UUID]] = {}
    for src_id, dst_id in rows:
        adj.setdefault(src_id, []).append(dst_id)
    if extra_edges:
        for src_id, dst_id in extra_edges:
            adj.setdefault(src_id, []).append(dst_id)

    # Adding source -> target creates a cycle iff source is reachable from target
    visited: set[UUID] = set()
    q: deque[UUID] = deque([target_entity_id])
    while q:
        cur = q.popleft()
        if cur == source_entity_id:
            raise ConflictError("Creating this entity link would introduce a cycle")
        if cur in visited:
            continue
        visited.add(cur)
        for nxt in adj.get(cur, ()):
            if nxt not in visited:
                q.append(nxt)


async def create_entity_link(
    db: AsyncSession,
    auth: AuthContext,
    *,
    source_entity_id: UUID,
    target_entity_id: UUID,
    link_type: str | None = None,
    note: str | None = None,
    ip: str | None = None,
) -> EntityLink:
    src = await db.get(Entity, source_entity_id)
    dst = await db.get(Entity, target_entity_id)
    if src is None:
        raise NotFoundError("entity", str(source_entity_id))
    if dst is None:
        raise NotFoundError("entity", str(target_entity_id))

    clean_type = link_type.strip() if link_type and link_type.strip() else None
    clean_note = note.strip() if note and note.strip() else None

    await assert_no_entity_link_cycle(
        db, source_entity_id=source_entity_id, target_entity_id=target_entity_id
    )

    dup_stmt = select(EntityLink).where(
        EntityLink.source_entity_id == source_entity_id,
        EntityLink.target_entity_id == target_entity_id,
        EntityLink.link_type.is_(None)
        if clean_type is None
        else EntityLink.link_type == clean_type,
    )
    existing = (await db.execute(dup_stmt)).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("Duplicate entity link with matching source, target, and link type")

    link = EntityLink(
        source_entity_id=source_entity_id,
        target_entity_id=target_entity_id,
        link_type=clean_type,
        note=clean_note,
        created_by=auth.user.id,
        is_active=True,
    )
    db.add(link)
    await db.flush()
    await write_audit(
        db,
        user_id=auth.user.id,
        action="entity_link.create",
        target_type="entity_link",
        target_id=str(link.id),
        ip=ip,
        detail={
            "source": str(source_entity_id),
            "target": str(target_entity_id),
            "link_type": clean_type,
        },
    )
    await db.commit()
    return link


async def bulk_create_entity_links(
    db: AsyncSession,
    auth: AuthContext,
    *,
    source_ids: list[UUID],
    target_ids: list[UUID],
    link_type: str | None = None,
    note: str | None = None,
    ip: str | None = None,
) -> list[EntityLink]:
    if not source_ids or not target_ids:
        return []
    clean_type = link_type.strip() if link_type and link_type.strip() else None
    clean_note = note.strip() if note and note.strip() else None

    needed_ids = set(source_ids) | set(target_ids)
    found_ents = {
        e.id
        for e in (await db.execute(select(Entity).where(Entity.id.in_(needed_ids)))).scalars().all()
    }
    missing = [str(eid) for eid in needed_ids if eid not in found_ids_or(found_ents)]
    if missing:
        raise NotFoundError("entity", missing[0])

    existing_rows = (await db.execute(select(EntityLink))).scalars().all()
    existing_triples = {
        (r.source_entity_id, r.target_entity_id, r.link_type) for r in existing_rows
    }
    extra_edges: list[tuple[UUID, UUID]] = []
    created: list[EntityLink] = []

    for sid in dict.fromkeys(source_ids):
        for tid in dict.fromkeys(target_ids):
            if (sid, tid, clean_type) in existing_triples:
                continue
            await assert_no_entity_link_cycle(
                db,
                source_entity_id=sid,
                target_entity_id=tid,
                extra_edges=extra_edges,
            )
            link = EntityLink(
                source_entity_id=sid,
                target_entity_id=tid,
                link_type=clean_type,
                note=clean_note,
                created_by=auth.user.id,
                is_active=True,
            )
            db.add(link)
            created.append(link)
            extra_edges.append((sid, tid))
            existing_triples.add((sid, tid, clean_type))

    if created:
        await db.flush()
        await write_audit(
            db,
            user_id=auth.user.id,
            action="entity_link.bulk_create",
            target_type="entity_link",
            target_id="bulk",
            ip=ip,
            detail={"count": len(created), "link_type": clean_type},
        )
        await db.commit()
    return created


def found_ids_or(s: set[UUID]) -> set[UUID]:
    return s


async def delete_entity_link(
    db: AsyncSession,
    auth: AuthContext,
    link_id: UUID,
    *,
    ip: str | None = None,
) -> None:
    link = await db.get(EntityLink, link_id)
    if link is None:
        raise NotFoundError("entity_link", str(link_id))
    detail = {
        "source": str(link.source_entity_id),
        "target": str(link.target_entity_id),
        "link_type": link.link_type,
    }
    await db.delete(link)
    await write_audit(
        db,
        user_id=auth.user.id,
        action="entity_link.delete",
        target_type="entity_link",
        target_id=str(link_id),
        ip=ip,
        detail=detail,
    )
    await db.commit()


async def get_linked_entity_ids(
    db: AsyncSession,
    seed_entity_ids: list[UUID],
    *,
    max_depth: int = 1,
) -> set[UUID]:
    """Return seed entity IDs plus upstream/downstream linked entity IDs within max_depth."""
    if not seed_entity_ids:
        return set()
    rows = (
        await db.execute(
            select(EntityLink.source_entity_id, EntityLink.target_entity_id).where(
                EntityLink.is_active.is_(True)
            )
        )
    ).all()
    undirected: dict[UUID, set[UUID]] = {}
    for src, dst in rows:
        undirected.setdefault(src, set()).add(dst)
        undirected.setdefault(dst, set()).add(src)

    visited: set[UUID] = set(seed_entity_ids)
    frontier: set[UUID] = set(seed_entity_ids)
    for _ in range(max(1, min(max_depth, 3))):
        nxt: set[UUID] = set()
        for eid in frontier:
            for nb in undirected.get(eid, set()):
                if nb not in visited:
                    visited.add(nb)
                    nxt.add(nb)
        if not nxt:
            break
        frontier = nxt
    return visited


async def get_entity_links_detailed(
    db: AsyncSession,
    entity_id: UUID,
    *,
    max_depth: int = 3,
) -> dict[str, object]:
    """Return direct and indirect (depth 2..max_depth) Uses / Used In links for an entity."""
    ent = await db.get(Entity, entity_id)
    if ent is None:
        raise NotFoundError("entity", str(entity_id))

    all_links = (
        (await db.execute(select(EntityLink).where(EntityLink.is_active.is_(True)))).scalars().all()
    )
    all_entities = {e.id: e for e in (await db.execute(select(Entity))).scalars().all()}

    direct_uses = [lk for lk in all_links if lk.target_entity_id == entity_id]
    direct_used_in = [lk for lk in all_links if lk.source_entity_id == entity_id]

    forward: dict[UUID, list[UUID]] = {}
    backward: dict[UUID, list[UUID]] = {}
    link_types: set[str] = set()
    for lk in all_links:
        forward.setdefault(lk.source_entity_id, []).append(lk.target_entity_id)
        backward.setdefault(lk.target_entity_id, []).append(lk.source_entity_id)
        if lk.link_type:
            link_types.add(lk.link_type)

    def _bfs_indirect(
        adj: dict[UUID, list[UUID]], direct_ids: set[UUID]
    ) -> list[dict[str, object]]:
        visited: set[UUID] = {entity_id}
        q: deque[tuple[UUID, int, list[UUID]]] = deque()
        for nb in adj.get(entity_id, ()):
            if nb not in visited:
                q.append((nb, 1, []))
                visited.add(nb)
        results: list[dict[str, object]] = []
        seen_out: set[UUID] = set(direct_ids) | {entity_id}
        while q:
            cur, depth, via_path = q.popleft()
            if depth >= 2 and cur not in seen_out:
                seen_out.add(cur)
                target_ent = all_entities.get(cur)
                if target_ent is not None:
                    via_names = [all_entities[vid].name for vid in via_path if vid in all_entities]
                    results.append(
                        {
                            "entity_id": target_ent.id,
                            "entity_name": target_ent.name,
                            "entity_type": target_ent.entity_type,
                            "is_archived": target_ent.archived_at is not None,
                            "depth": depth,
                            "via_entity_names": via_names,
                        }
                    )
            if depth < max_depth:
                next_via = [*via_path, cur]
                for nxt in adj.get(cur, ()):
                    if nxt not in visited:
                        visited.add(nxt)
                        q.append((nxt, depth + 1, next_via))
        return results

    uses_indirect = _bfs_indirect(backward, {lk.source_entity_id for lk in direct_uses})
    used_in_indirect = _bfs_indirect(forward, {lk.target_entity_id for lk in direct_used_in})

    return {
        "entity_id": entity_id,
        "uses": direct_uses,
        "used_in": direct_used_in,
        "uses_indirect": uses_indirect,
        "used_in_indirect": used_in_indirect,
        "link_types": sorted(link_types),
        "entities_map": all_entities,
    }


async def suggest_dependencies_for_entity(
    db: AsyncSession,
    entity_id: UUID,
    *,
    link_ids: list[UUID] | None = None,
    depth: int = 1,
) -> list[dict[str, object]]:
    """Compute preview of template-implied task dependencies across linked entities."""
    ent = await db.get(Entity, entity_id)
    if ent is None:
        raise NotFoundError("entity", str(entity_id))

    clamped_depth = max(1, min(depth, 2))
    templates = (
        (await db.execute(select(DependencyTemplate).where(DependencyTemplate.enabled.is_(True))))
        .scalars()
        .all()
    )
    if not templates:
        return []

    all_links = (
        (await db.execute(select(EntityLink).where(EntityLink.is_active.is_(True)))).scalars().all()
    )
    if link_ids is not None:
        wanted = set(link_ids)
        filtered_links = [lk for lk in all_links if lk.id in wanted]
    else:
        filtered_links = list(all_links)

    # Collect (upstream_entity_id, downstream_entity_id) pairs within depth
    direct_pairs: list[tuple[UUID, UUID]] = []
    forward: dict[UUID, list[UUID]] = {}
    backward: dict[UUID, list[UUID]] = {}
    for lk in filtered_links:
        forward.setdefault(lk.source_entity_id, []).append(lk.target_entity_id)
        backward.setdefault(lk.target_entity_id, []).append(lk.source_entity_id)
        if lk.source_entity_id == entity_id or lk.target_entity_id == entity_id:
            direct_pairs.append((lk.source_entity_id, lk.target_entity_id))

    ent_pairs: list[tuple[UUID, UUID]] = list(dict.fromkeys(direct_pairs))
    if clamped_depth >= 2 and link_ids is None:
        # Depth 2 traversal: include indirect ancestors and descendants
        for up1 in backward.get(entity_id, ()):
            for up2 in backward.get(up1, ()):
                if up2 != entity_id and (up2, entity_id) not in ent_pairs:
                    ent_pairs.append((up2, entity_id))
        for down1 in forward.get(entity_id, ()):
            for down2 in forward.get(down1, ()):
                if down2 != entity_id and (entity_id, down2) not in ent_pairs:
                    ent_pairs.append((entity_id, down2))

    if not ent_pairs:
        return []

    involved_ents = {eid for pair in ent_pairs for eid in pair}
    tasks_rows = (
        (
            await db.execute(
                select(Task)
                .where(Task.entity_id.in_(involved_ents))
                .order_by(Task.sort_order.asc())
            )
        )
        .scalars()
        .all()
    )
    depts_map = {d.id: d for d in (await db.execute(select(Department))).scalars().all()}
    ents_map = {
        e.id: e
        for e in (await db.execute(select(Entity).where(Entity.id.in_(involved_ents))))
        .scalars()
        .all()
    }

    tasks_by_ent_dept: dict[tuple[UUID, UUID], list[Task]] = {}
    for t in tasks_rows:
        tasks_by_ent_dept.setdefault((t.entity_id, t.department_id), []).append(t)

    existing_deps = {
        (r.task_id, r.upstream_task_id): r.threshold
        for r in (await db.execute(select(TaskDependency))).scalars().all()
    }

    suggestions: list[dict[str, object]] = []
    seen_task_pairs: set[tuple[UUID, UUID]] = set()
    for up_eid, down_eid in ent_pairs:
        for tpl in templates:
            up_candidates = [
                t
                for t in tasks_by_ent_dept.get((up_eid, tpl.upstream_department_id), [])
                if not tpl.upstream_task_name or t.name == tpl.upstream_task_name
            ]
            down_candidates = [
                t
                for t in tasks_by_ent_dept.get((down_eid, tpl.downstream_department_id), [])
                if not tpl.downstream_task_name or t.name == tpl.downstream_task_name
            ]
            for ut in up_candidates:
                for dt in down_candidates:
                    if ut.id == dt.id or (dt.id, ut.id) in seen_task_pairs:
                        continue
                    seen_task_pairs.add((dt.id, ut.id))
                    already = (dt.id, ut.id) in existing_deps
                    would_cycle = (
                        False
                        if already
                        else await would_create_task_dependency_cycle(
                            db, task_id=dt.id, upstream_task_id=ut.id
                        )
                    )
                    up_dept = depts_map.get(ut.department_id)
                    dn_dept = depts_map.get(dt.department_id)
                    up_ent = ents_map.get(ut.entity_id)
                    dn_ent = ents_map.get(dt.entity_id)
                    suggestions.append(
                        {
                            "upstream_task_id": ut.id,
                            "upstream_task_code": ut.task_code,
                            "upstream_entity_name": up_ent.name if up_ent else "",
                            "upstream_department": up_dept.name if up_dept else "",
                            "downstream_task_id": dt.id,
                            "downstream_task_code": dt.task_code,
                            "downstream_entity_name": dn_ent.name if dn_ent else "",
                            "downstream_department": dn_dept.name if dn_dept else "",
                            "threshold": tpl.threshold,
                            "already_exists": already,
                            "would_cycle": would_cycle,
                            "template_id": tpl.id,
                        }
                    )
    return suggestions


async def apply_suggested_dependencies(
    db: AsyncSession,
    auth: AuthContext,
    *,
    entity_id: UUID,
    pairs: list[tuple[UUID, UUID, str]],  # (task_id, upstream_task_id, threshold)
    ip: str | None = None,
) -> int:
    ent = await db.get(Entity, entity_id)
    if ent is None:
        raise NotFoundError("entity", str(entity_id))

    edges = [(down_id, up_id, thresh, True) for down_id, up_id, thresh in pairs]
    added = await add_task_dependencies_batch(db, auth, edges)
    await write_audit(
        db,
        user_id=auth.user.id,
        action="entity_link.apply_dependencies",
        target_type="entity",
        target_id=str(entity_id),
        ip=ip,
        detail={"applied_count": added},
    )
    await db.commit()
    return added


async def get_entity_links_graph(
    db: AsyncSession,
    *,
    entity_id: UUID | None = None,
    hops: int = 2,
    limit: int = 500,
) -> dict[str, object]:
    """Return entity-mode graph nodes + edges with hop neighborhood and node cap."""
    all_entities = {
        e.id: e
        for e in (await db.execute(select(Entity).order_by(Entity.name.asc()))).scalars().all()
    }
    all_links = (
        (await db.execute(select(EntityLink).where(EntityLink.is_active.is_(True)))).scalars().all()
    )

    if entity_id is not None:
        if entity_id not in all_entities:
            raise NotFoundError("entity", str(entity_id))
        kept_ids = await get_linked_entity_ids(db, [entity_id], max_depth=max(1, min(hops, 3)))
    else:
        kept_ids = set(all_entities.keys())

    truncated = False
    ordered_ids = sorted(
        kept_ids, key=lambda eid: all_entities[eid].name.lower() if eid in all_entities else ""
    )
    if len(ordered_ids) > limit:
        ordered_ids = ordered_ids[:limit]
        truncated = True
    kept_set = set(ordered_ids)

    nodes = [
        {
            "id": all_entities[eid].id,
            "name": all_entities[eid].name,
            "entity_type": all_entities[eid].entity_type,
            "is_archived": all_entities[eid].archived_at is not None,
        }
        for eid in ordered_ids
        if eid in all_entities
    ]
    edges = [
        {
            "id": lk.id,
            "source_entity_id": lk.source_entity_id,
            "target_entity_id": lk.target_entity_id,
            "link_type": lk.link_type,
        }
        for lk in all_links
        if lk.source_entity_id in kept_set and lk.target_entity_id in kept_set
    ]
    return {"nodes": nodes, "edges": edges, "truncated": truncated}
