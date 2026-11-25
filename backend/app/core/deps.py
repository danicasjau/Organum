from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.project_registry import ProjectContext, ProjectRegistry
from app.core.settings import Settings
from app.formats.base import FormatRegistry
from app.jobs.base import JobRunner
from app.storage.base import StorageBackend


def get_settings_dep(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


async def get_app_db(request: Request) -> AsyncGenerator[AsyncSession, None]:
    session_factory = request.app.state.app_session_factory
    async with session_factory() as session:
        yield session


def get_project_registry(request: Request) -> ProjectRegistry:
    return cast(ProjectRegistry, request.app.state.project_registry)


async def get_project_context(
    project_uuid: str,
    registry: Annotated[ProjectRegistry, Depends(get_project_registry)],
    app_db: Annotated[AsyncSession, Depends(get_app_db)],
) -> ProjectContext:
    return await registry.get_project(project_uuid, app_db)


async def get_db(
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
) -> AsyncGenerator[AsyncSession, None]:
    async with ctx.session_factory() as session:
        yield session


def get_storage(
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
) -> StorageBackend:
    return ctx.storage


def get_cache_storage(
    ctx: Annotated[ProjectContext, Depends(get_project_context)],
) -> StorageBackend:
    return ctx.cache_storage


def get_job_runner(request: Request) -> JobRunner:
    return cast(JobRunner, request.app.state.job_runner)


def get_format_registry(request: Request) -> FormatRegistry:
    return cast(FormatRegistry, request.app.state.format_registry)
