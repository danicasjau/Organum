from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_db, get_settings_dep
from app.core.settings import Settings
from app.schemas.api import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=HealthResponse)
async def healthz(settings: Annotated[Settings, Depends(get_settings_dep)]) -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
    )


@router.get("/readyz", response_model=ReadinessResponse)
async def readyz(db: Annotated[AsyncSession, Depends(get_app_db)]) -> ReadinessResponse:
    await db.execute(text("SELECT 1"))
    return ReadinessResponse(status="ready", database="ok")


@router.get("/api/v1/health", response_model=HealthResponse)
async def api_health(settings: Annotated[Settings, Depends(get_settings_dep)]) -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
    )

