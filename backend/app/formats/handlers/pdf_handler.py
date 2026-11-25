from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from app.formats.base import FormatHandler, InspectionDocument, ProbeResult


def _flatten_outline(reader: PdfReader, items: Any, depth: int = 0) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return nodes
    for item in items:
        if isinstance(item, list):
            if nodes:
                nodes[-1]["children"] = _flatten_outline(reader, item, depth + 1)
            continue
        title = getattr(item, "title", None) or str(item)
        page_num: int | None = None
        try:
            page_num = reader.get_destination_page_number(item)
        except Exception:
            page_num = None
        nodes.append(
            {
                "id": f"bm_{depth}_{len(nodes)}_{page_num if page_num is not None else 0}",
                "name": str(title),
                "type": "Bookmark",
                "page": page_num,
            }
        )
    return nodes


def _probe_sync(path: Path) -> ProbeResult:
    reader = PdfReader(str(path))
    pages: list[dict[str, Any]] = []
    for idx, page in enumerate(reader.pages):
        box = page.mediabox
        pages.append(
            {
                "index": idx,
                "label": f"Page {idx + 1}",
                "width": round(float(box.width), 2),
                "height": round(float(box.height), 2),
            }
        )

    info: dict[str, str] = {}
    if reader.metadata:
        for key, val in reader.metadata.items():
            if val is not None:
                info[str(key).lstrip("/")] = str(val)[:200]

    outline_nodes: list[dict[str, Any]] = []
    try:
        raw_outline = reader.outline
        if raw_outline:
            outline_nodes = _flatten_outline(reader, raw_outline)
    except Exception:
        outline_nodes = []

    return ProbeResult(
        format_id="pdf",
        media_kind="document",
        details={
            "page_count": len(reader.pages),
            "encrypted": bool(reader.is_encrypted),
            "pages": pages,
            "info": info,
            "outline": outline_nodes,
        },
    )


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    meta: dict[str, Any] = dict(probe.details)
    outline = probe.details.get("outline")
    tree: list[dict[str, Any]] = (
        outline
        if isinstance(outline, list) and outline
        else [
            {
                "id": f"page_{p['index']}",
                "name": str(p.get("label", f"Page {int(p['index']) + 1}")),
                "type": "Page",
                "page": int(p["index"]),
            }
            for p in (probe.details.get("pages") or [])
        ]
    )
    return InspectionDocument(
        kind="document",
        summary={
            "name": path.name,
            "format": "pdf",
            "page_count": probe.details.get("page_count", 0),
            "encrypted": probe.details.get("encrypted", False),
        },
        metadata=meta,
        tree=tree,
        capabilities={"document": True, "pdf": True, "annotations_2d": False},
    )


class PdfHandler(FormatHandler):
    handler_id = "pdf_document"
    handler_version = "1.0.0"
    media_kind = "document"
    extensions = (".pdf",)
    magic_signatures = (b"%PDF-",)

    async def probe(self, path: Path) -> ProbeResult:
        return await asyncio.to_thread(_probe_sync, path)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return await asyncio.to_thread(_inspect_sync, path, probe)

    def capabilities(self) -> dict[str, bool]:
        return {"document": True, "pdf": True, "annotations_2d": False}
