from __future__ import annotations

import asyncio
import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

from app.core.errors import AppError, NotFoundError
from app.storage.base import StorageBackend, StoredStat


class LocalStorage(StorageBackend):
    """Local filesystem storage backend with path-traversal protection."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def resolve_safe(self, key: str) -> Path:
        clean = key.lstrip("/\\")
        target = (self._root / clean).resolve()
        try:
            target.relative_to(self._root)
        except ValueError as exc:
            raise AppError("invalid_path", "Path escapes storage root", status_code=400) from exc
        return target

    def exists(self, key: str) -> bool:
        return self.resolve_safe(key).is_file()

    def stat(self, key: str) -> StoredStat:
        path = self.resolve_safe(key)
        if not path.is_file():
            raise NotFoundError("file", key)
        st = path.stat()
        return StoredStat(size=st.st_size, mtime=st.st_mtime)

    async def open_stream(
        self, key: str, start: int = 0, end: int | None = None, chunk_size: int = 1024 * 1024
    ) -> AsyncIterator[bytes]:
        path = self.resolve_safe(key)
        if not path.is_file():
            raise NotFoundError("file", key)
        size = path.stat().st_size
        actual_end = size - 1 if end is None else min(end, size - 1)
        remaining = max(0, actual_end - start + 1)

        with path.open("rb") as fh:
            fh.seek(start)
            while remaining > 0:
                to_read = min(chunk_size, remaining)
                data = fh.read(to_read)
                if not data:
                    break
                remaining -= len(data)
                yield data

    async def write_stream(self, key: str, chunks: AsyncIterator[bytes]) -> int:
        dest = self.resolve_safe(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        fd, tmp_name = tempfile.mkstemp(dir=dest.parent, prefix=".tmp_", suffix=".part")
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as fh:
                async for chunk in chunks:
                    fh.write(chunk)
                    total += len(chunk)
            await asyncio.to_thread(tmp_path.replace, dest)
        except Exception:
            await asyncio.to_thread(tmp_path.unlink, missing_ok=True)
            raise
        return total

    async def delete(self, key: str) -> None:
        path = self.resolve_safe(key)
        path.unlink(missing_ok=True)
