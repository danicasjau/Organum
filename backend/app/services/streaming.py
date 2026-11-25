from __future__ import annotations

import re

from fastapi import Request, Response
from fastapi.responses import StreamingResponse

from app.core.errors import AppError
from app.storage.base import StorageBackend

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def build_ranged_file_response(
    request: Request,
    storage: StorageBackend,
    storage_key: str,
    etag_token: str,
    media_type: str,
    immutable: bool = False,
) -> Response:
    """Serve a stored file with ETag/If-None-Match and HTTP Range (206) support."""
    etag = f'"{etag_token}"'
    cache_control = "public, max-age=31536000, immutable" if immutable else "no-cache"
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match.strip() == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": cache_control},
        )

    stat = storage.stat(storage_key)
    total = stat.size
    range_header = request.headers.get("range")
    base_headers = {
        "Accept-Ranges": "bytes",
        "ETag": etag,
        "Cache-Control": cache_control,
    }

    if not range_header:
        return StreamingResponse(
            storage.open_stream(storage_key, start=0, end=total - 1 if total > 0 else 0),
            media_type=media_type,
            headers={**base_headers, "Content-Length": str(total)},
        )

    m = _RANGE_RE.match(range_header.strip())
    if not m:
        raise AppError("invalid_range", "Malformed Range header", status_code=416)

    start_s, end_s = m.groups()
    if start_s == "" and end_s == "":
        raise AppError("invalid_range", "Empty Range header", status_code=416)

    if start_s == "":
        suffix = int(end_s)
        start = max(0, total - suffix)
        end = total - 1
    else:
        start = int(start_s)
        end = int(end_s) if end_s else total - 1

    if start >= total or start > end or end >= total:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{total}"},
        )

    length = end - start + 1
    return StreamingResponse(
        storage.open_stream(storage_key, start=start, end=end),
        status_code=206,
        media_type=media_type,
        headers={
            **base_headers,
            "Content-Length": str(length),
            "Content-Range": f"bytes {start}-{end}/{total}",
        },
    )

