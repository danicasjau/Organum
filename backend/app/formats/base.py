from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class ProbeResult(BaseModel):
    """Lightweight metadata extracted when scanning a file."""

    format_id: str
    media_kind: str
    detected_colorspace: str | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    duration_seconds: float | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class InspectionDocument(BaseModel):
    """Normalized inspection shape consumed by the frontend right panel (§5.7)."""

    kind: str
    summary: dict[str, Any] = Field(default_factory=dict)
    tree: list[dict[str, Any]] = Field(default_factory=list)
    layers: list[dict[str, Any]] = Field(default_factory=list)
    aovs: list[dict[str, Any]] = Field(default_factory=list)
    streams: list[dict[str, Any]] = Field(default_factory=list)
    timeline: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, bool] = Field(default_factory=dict)


class DerivedResult(BaseModel):
    kind: str
    storage_key: str
    mime_type: str
    size: int


class FormatHandler(ABC):
    """Plugin interface for format probing, inspection, and artifact derivation."""

    handler_id: str
    handler_version: str
    media_kind: str
    extensions: tuple[str, ...] = ()
    magic_signatures: tuple[bytes, ...] = ()

    def matches(self, path: Path, header: bytes) -> bool:
        ext = path.suffix.lower()
        if ext in self.extensions:
            return True
        return any(header.startswith(sig) for sig in self.magic_signatures)

    @abstractmethod
    async def probe(self, path: Path) -> ProbeResult:
        """Extract fast probe metadata."""

    @abstractmethod
    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        """Build full normalized inspection document."""

    async def derive(
        self,
        path: Path,
        kind: str,
        params: dict[str, Any],
        out_dir: Path,
    ) -> DerivedResult:
        raise NotImplementedError(f"Handler '{self.handler_id}' does not derive '{kind}'")

    def capabilities(self) -> dict[str, bool]:
        return {}


class FormatRegistry:
    """Ordered plugin registry matching files by magic bytes and extension."""

    def __init__(self) -> None:
        self._handlers: list[FormatHandler] = []
        self._fallback: FormatHandler | None = None

    def register(self, handler: FormatHandler) -> None:
        self._handlers.append(handler)

    def set_fallback(self, handler: FormatHandler) -> None:
        self._fallback = handler

    def resolve(self, path: Path) -> FormatHandler:
        header = b""
        if path.is_file():
            with path.open("rb") as fh:
                header = fh.read(64)
        ext = path.suffix.lower()
        for handler in self._handlers:
            if ext in handler.extensions:
                return handler
        for handler in self._handlers:
            if any(header.startswith(sig) for sig in handler.magic_signatures):
                return handler
        if self._fallback is None:
            raise RuntimeError("No fallback format handler registered")
        return self._fallback
