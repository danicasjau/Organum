from __future__ import annotations

import re
from pathlib import Path

from app.core.errors import AppError

_WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f<>:\"|?*]")
_WS_RE = re.compile(r"\s+")


def sanitize_folder_name(raw: str) -> str:
    """Sanitize a user-supplied name into a portable, cross-platform folder name."""
    if "/" in raw or "\\" in raw:
        raise AppError(
            "invalid_name",
            "Folder name cannot contain path separators ('/' or '\\')",
            status_code=400,
        )
    if _CONTROL_RE.search(raw):
        raise AppError(
            "invalid_name",
            "Folder name contains invalid characters",
            status_code=400,
        )
    cleaned = raw.strip().strip(".")
    cleaned = _WS_RE.sub("_", cleaned).strip("_.")
    if not cleaned or cleaned in (".", ".."):
        raise AppError("invalid_name", "Folder name cannot be empty", status_code=400)
    if len(cleaned) > 120:
        raise AppError("invalid_name", "Folder name exceeds 120 characters", status_code=400)
    if cleaned.upper().split(".")[0] in _WINDOWS_RESERVED:
        raise AppError(
            "invalid_name",
            f"'{cleaned}' is a reserved system device name",
            status_code=400,
        )
    return cleaned


def check_case_insensitive_collision(
    parent_dir: Path,
    folder_name: str,
    ignore_name: str | None = None,
) -> bool:
    """Return True if any entry inside parent_dir matches folder_name case-insensitively."""
    if not parent_dir.exists():
        return False
    target_low = folder_name.lower()
    ignore_low = ignore_name.lower() if ignore_name else None
    for child in parent_dir.iterdir():
        child_low = child.name.lower()
        if ignore_low and child_low == ignore_low:
            continue
        if child_low == target_low:
            return True
    return False


def format_version_label(version_number: int) -> str:
    """Format canonical version directory name v0001, v0002, ..."""
    return f"v{version_number:04d}"
