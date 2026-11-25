from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class StoredStat:
    size: int
    mtime: float


class StorageBackend(ABC):
    """Port for reading and writing product and cache files."""

    @property
    @abstractmethod
    def root(self) -> Path:
        """Root directory or prefix."""

    @abstractmethod
    def resolve_safe(self, key: str) -> Path:
        """Resolve a relative storage key safely inside the root."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Return True if the object exists."""

    @abstractmethod
    def stat(self, key: str) -> StoredStat:
        """Return size and mtime for the object."""

    @abstractmethod
    def open_stream(
        self, key: str, start: int = 0, end: int | None = None, chunk_size: int = 1024 * 1024
    ) -> AsyncIterator[bytes]:
        """Stream bytes for an optional inclusive byte range."""

    @abstractmethod
    async def write_stream(self, key: str, chunks: AsyncIterator[bytes]) -> int:
        """Persist chunks atomically and return total bytes written."""

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete an object if it exists."""

