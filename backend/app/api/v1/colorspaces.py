from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.color.ocio_service import bake_3d_lut, get_ocio_status
from app.core.security import get_current_auth
from app.schemas.api import ColorspaceInfo, ColorspaceListResponse, LutResponse
from app.services.permissions import AuthContext

router = APIRouter(prefix="/colorspaces", tags=["colorspaces"])

_INPUT_SPACES = [
    ColorspaceInfo(id="srgb", label="sRGB", category="display", is_default=True),
    ColorspaceInfo(id="linear_srgb", label="Linear sRGB", category="linear"),
    ColorspaceInfo(id="rec709", label="Rec.709", category="video"),
    ColorspaceInfo(id="acescg", label="ACEScg", category="aces"),
    ColorspaceInfo(id="aces2065_1", label="ACES2065-1", category="aces"),
    ColorspaceInfo(id="display_p3", label="Display P3", category="display"),
    ColorspaceInfo(id="raw", label="Raw", category="data"),
]

_DISPLAY_VIEWS = [
    ColorspaceInfo(id="srgb", label="sRGB", category="display", is_default=True),
    ColorspaceInfo(id="rec709", label="Rec.709", category="video"),
    ColorspaceInfo(id="rec2020", label="Rec.2020", category="hdr"),
    ColorspaceInfo(id="display_p3", label="Display P3", category="display"),
    ColorspaceInfo(id="linear", label="Linear", category="linear"),
    ColorspaceInfo(id="raw", label="Raw", category="data"),
]


@router.get("", response_model=ColorspaceListResponse)
async def list_colorspaces(
    _auth: Annotated[AuthContext, Depends(get_current_auth)],
) -> ColorspaceListResponse:
    status = get_ocio_status()
    return ColorspaceListResponse(
        input_spaces=_INPUT_SPACES,
        display_views=_DISPLAY_VIEWS,
        ocio_version=status["ocio_version"],
        ocio_config=status["config_name"],
    )


@router.get("/lut", response_model=LutResponse)
async def get_colorspace_lut(
    _auth: Annotated[AuthContext, Depends(get_current_auth)],
    src: str = Query(default="acescg"),
    dst: str = Query(default="srgb"),
    size: int = Query(default=17, ge=9, le=33),
) -> LutResponse:
    res = bake_3d_lut(src=src, dst=dst, size=size)
    return LutResponse(
        src=res.src,
        dst=res.dst,
        size=res.size,
        engine=res.engine,
        config_name=res.config_name,
        cache_key=res.cache_key,
        values=res.values,
    )


