from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select

from app.core.project_registry import DEFAULT_STARTER_DEPARTMENTS, ProjectRegistry
from app.core.settings import get_settings
from app.db.session import create_engine_and_sessionmaker
from app.formats.registry import build_default_registry
from app.models.app_db import AppBase
from app.models.project_db import (
    Department,
    Entity,
    EntityDepartment,
    Product,
    Tag,
    Task,
)
from app.models.tasks import (
    DependencyTemplate,
    EntityLink,
    TaskDependency,
    TaskTag,
    TimeLog,
)
from app.models.user import (
    Company,
    CompanyDepartment,
    Role,
    TaskAssignment,
    TaskShare,
    User,
    UserDepartment,
)
from app.services.auth_service import hash_password
from app.services.permissions import sync_user_project_index


async def generate_scale_project(
    *,
    project_dir: Path,
    app_db_path: Path | None,
    entity_count: int = 300,
    target_tasks: int = 3000,
) -> dict[str, int]:
    """Generate a large production project for scale, Gantt, Grid, and Link testing."""
    settings = get_settings()
    if app_db_path is None:
        app_db_path = project_dir.parent / "scale_app.db"
    app_db_url = f"sqlite+aiosqlite:///{app_db_path.resolve().as_posix()}"
    app_engine, app_session_factory = create_engine_and_sessionmaker(app_db_url)
    async with app_engine.begin() as conn:
        await conn.run_sync(AppBase.metadata.create_all)

    registry = ProjectRegistry(settings, build_default_registry())
    try:
        async with app_session_factory() as app_db:
            ctx = await registry.create_project(
                app_db,
                path=project_dir,
                name="ORGANUM Scale Show",
                starter_departments=DEFAULT_STARTER_DEPARTMENTS,
            )
            async with ctx.session_factory() as db:
                roles = {r.name: r for r in (await db.execute(select(Role))).scalars().all()}
                depts = list((await db.execute(select(Department))).scalars().all())
                dept_by_name = {d.name: d for d in depts}

                c_int = Company(
                    name="Main Studio",
                    short_code="MAIN",
                    kind="internal",
                    color="--series-1",
                )
                c_cli = Company(
                    name="Scale Client",
                    short_code="CLI",
                    kind="external",
                    color="--series-3",
                )
                db.add_all([c_int, c_cli])
                await db.flush()
                for d in depts:
                    db.add(CompanyDepartment(company_id=c_int.id, department_id=d.id))

                pw_hash = hash_password("DemoPass123!")
                role_users: dict[str, User] = {}
                for uname, fname, rname, cid in (
                    ("prod_scale", "Scale Producer", "producer", c_int.id),
                    ("dir_scale", "Scale Director", "director", c_int.id),
                    ("sup_scale", "Scale Supervisor", "supervisor", c_int.id),
                    ("lead_scale", "Scale Lead", "lead", c_int.id),
                    ("art_scale_1", "Scale Artist 1", "artist", c_int.id),
                    ("art_scale_2", "Scale Artist 2", "artist", c_int.id),
                    ("ext_scale", "Scale Vendor", "external", c_cli.id),
                    ("cli_scale", "Scale Client", "client", c_cli.id),
                ):
                    u = User(
                        username=uname,
                        full_name=fname,
                        email=f"{uname}@organum.local",
                        password_hash=pw_hash,
                        role_id=roles[rname].id,
                        company_id=cid,
                        is_active=True,
                        must_change_password=False,
                        has_initial_password=False,
                    )
                    db.add(u)
                    role_users[uname] = u
                await db.flush()
                for u in role_users.values():
                    if u.company_id == c_int.id:
                        for d in depts:
                            db.add(UserDepartment(user_id=u.id, department_id=d.id))

                # Ensure DependencyTemplates exist
                for up_n, dn_n, th in (
                    ("Modeling", "Rigging", "APP"),
                    ("Rigging", "Lighting", "APP"),
                    ("Lookdev", "Lighting", "PUBLISHED"),
                ):
                    if up_n in dept_by_name and dn_n in dept_by_name:
                        db.add(
                            DependencyTemplate(
                                upstream_department_id=dept_by_name[up_n].id,
                                downstream_department_id=dept_by_name[dn_n].id,
                                threshold=th,
                                enabled=True,
                            )
                        )

                # Determine entities split: ~20% Props (assets), ~15% Characters, ~65% Shots
                n_assets = max(10, int(entity_count * 0.20))
                n_chars = max(5, int(entity_count * 0.15))
                n_shots = max(10, entity_count - n_assets - n_chars)

                asset_ents: list[Entity] = []
                char_ents: list[Entity] = []
                shot_ents: list[Entity] = []

                for sub in ("assets", "chars", "shots"):
                    (ctx.production_dir / sub).mkdir(parents=True, exist_ok=True)

                specs: list[tuple[str, str, str, list[Entity]]] = []
                for i in range(1, n_assets + 1):
                    specs.append((f"prop_{i:03d}", f"assets/prop_{i:03d}", "Prop", asset_ents))
                for i in range(1, n_chars + 1):
                    specs.append((f"char_{i:03d}", f"chars/char_{i:03d}", "Character", char_ents))
                for i in range(1, n_shots + 1):
                    specs.append((f"sh{i:04d}", f"shots/sh{i:04d}", "Shot", shot_ents))

                all_entities: list[Entity] = []
                for name, rel, etype, bucket in specs:
                    ent_id = uuid.uuid4()
                    ent_dir = ctx.production_dir / rel
                    ent_dir.mkdir(parents=True, exist_ok=True)
                    (ent_dir / ".entity.json").write_text(
                        json.dumps({"uuid": str(ent_id), "schema_version": 2}),
                        encoding="utf-8",
                    )
                    ent = Entity(
                        id=ent_id,
                        name=name,
                        folder_name=name,
                        rel_path=rel,
                        entity_type=etype,
                    )
                    db.add(ent)
                    bucket.append(ent)
                    all_entities.append(ent)
                await db.flush()

                # Link assets -> characters -> shots (acyclic)
                links_created = 0
                for idx, asset in enumerate(asset_ents):
                    target_char = char_ents[idx % len(char_ents)]
                    db.add(
                        EntityLink(
                            source_entity_id=asset.id,
                            target_entity_id=target_char.id,
                            link_type="prop",
                            created_by=role_users["prod_scale"].id,
                        )
                    )
                    links_created += 1
                for idx, shot in enumerate(shot_ents):
                    src_char = char_ents[idx % len(char_ents)]
                    db.add(
                        EntityLink(
                            source_entity_id=src_char.id,
                            target_entity_id=shot.id,
                            link_type="cast",
                            created_by=role_users["prod_scale"].id,
                        )
                    )
                    links_created += 1

                tag_hero = Tag(name="hero")
                tag_fx = Tag(name="heavy_fx")
                db.add_all([tag_hero, tag_fx])
                await db.flush()

                # Compute task names per entity to hit target_tasks cleanly
                tasks_per_entity = max(
                    1, (target_tasks + len(all_entities) - 1) // len(all_entities)
                )
                base_depts = depts[: min(len(depts), 7)]
                extra_variants = max(1, (tasks_per_entity + len(base_depts) - 1) // len(base_depts))

                now_d = datetime.now(UTC).date()
                statuses = ("WTG", "RDY", "IP", "P_LEAD", "P_SUP", "P_CLIENT", "APP", "RTK")
                priorities = ("normal", "normal", "high", "stopper")
                created_tasks = 0

                for e_idx, ent in enumerate(all_entities):
                    if created_tasks >= target_tasks:
                        break
                    tasks_by_dept: dict[str, Task] = {}
                    for d_idx, dept in enumerate(base_depts):
                        if created_tasks >= target_tasks:
                            break
                        ed = EntityDepartment(
                            entity_id=ent.id,
                            department_id=dept.id,
                            sort_order=d_idx,
                        )
                        db.add(ed)
                        await db.flush()
                        for v_idx in range(extra_variants):
                            if created_tasks >= target_tasks:
                                break
                            t_name = "main" if v_idx == 0 else f"pass_{v_idx}"
                            d_code = dept.short_code or dept.folder_name[:3].upper()
                            t_code = f"{ent.folder_name}_{d_code}_{t_name}"
                            st = statuses[(e_idx + d_idx + v_idx) % len(statuses)]
                            pr = priorities[(e_idx + d_idx) % len(priorities)]
                            bid = 8.0 + ((d_idx % 4) * 8.0)
                            logged = 4.0 if st in {"IP", "P_LEAD", "APP"} else 0.0
                            t = Task(
                                task_code=t_code,
                                task_name=f"{dept.name} - {t_name}",
                                entity_department_id=ed.id,
                                entity_id=ent.id,
                                parent_entity_type=ent.entity_type,
                                department_id=dept.id,
                                name=t_name,
                                folder_name=t_name,
                                sort_order=v_idx,
                                status=st,
                                priority=pr,
                                bid_hours=bid,
                                logged_hours=logged,
                                ideal_start_date=now_d + timedelta(days=(e_idx % 10) - 3),
                                ideal_finish_date=now_d + timedelta(days=(e_idx % 10) + 4),
                            )
                            db.add(t)
                            await db.flush()
                            db.add(Product(task_id=t.id, name=f"{dept.folder_name}/{t_name}"))
                            artist = (
                                role_users["art_scale_1"]
                                if (created_tasks % 2 == 0)
                                else role_users["art_scale_2"]
                            )
                            db.add(
                                TaskAssignment(
                                    task_id=t.id,
                                    user_id=artist.id,
                                    assignment_role="artist",
                                )
                            )
                            if logged > 0:
                                db.add(
                                    TimeLog(
                                        task_id=t.id,
                                        user_id=artist.id,
                                        work_date=now_d - timedelta(days=1),
                                        hours=logged,
                                        note="Seeded pass",
                                    )
                                )
                            if created_tasks % 15 == 0:
                                db.add(TaskTag(task_id=t.id, tag_id=tag_hero.id))
                            if st == "P_CLIENT" and created_tasks % 20 == 0:
                                db.add(
                                    TaskShare(
                                        task_id=t.id,
                                        company_id=c_cli.id,
                                        shared_by=role_users["prod_scale"].id,
                                    )
                                )
                            if v_idx == 0:
                                tasks_by_dept[dept.name] = t
                            created_tasks += 1

                    if "Rigging" in tasks_by_dept and "Modeling" in tasks_by_dept:
                        db.add(
                            TaskDependency(
                                task_id=tasks_by_dept["Rigging"].id,
                                upstream_task_id=tasks_by_dept["Modeling"].id,
                                threshold="APP",
                                from_entity_link=False,
                                created_by=role_users["sup_scale"].id,
                            )
                        )
                    if "Lighting" in tasks_by_dept and "Rigging" in tasks_by_dept:
                        db.add(
                            TaskDependency(
                                task_id=tasks_by_dept["Lighting"].id,
                                upstream_task_id=tasks_by_dept["Rigging"].id,
                                threshold="APP",
                                from_entity_link=False,
                                created_by=role_users["sup_scale"].id,
                            )
                        )

                await db.commit()
                active_usernames = [
                    str(u)
                    for u in (
                        await db.execute(select(User.username).where(User.is_active.is_(True)))
                    )
                    .scalars()
                    .all()
                ]
                await sync_user_project_index(app_db, ctx.uuid, ctx.name, active_usernames)
                await app_db.commit()

                return {
                    "entities": len(all_entities),
                    "tasks": created_tasks,
                    "entity_links": links_created,
                }
    finally:
        await registry.dispose_all()
        await app_engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed large ORGANUM project for scale testing.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "demo_scale_project",
    )
    parser.add_argument("--app-db", type=Path, default=None)
    parser.add_argument("--entities", type=int, default=300)
    parser.add_argument("--target-tasks", type=int, default=3000)
    args = parser.parse_args()
    summary = asyncio.run(
        generate_scale_project(
            project_dir=args.output,
            app_db_path=args.app_db,
            entity_count=args.entities,
            target_tasks=args.target_tasks,
        )
    )
    print(f"Scale project created at {args.output}: {summary}")


if __name__ == "__main__":
    main()
