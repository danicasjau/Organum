from __future__ import annotations

import asyncio
import csv
import json
from pathlib import Path
from typing import Any

import yaml

from app.formats.base import DerivedResult, FormatHandler, InspectionDocument, ProbeResult

_MAX_CSV_INSPECT_ROWS = 5000


def _infer_col_type(samples: list[str]) -> str:
    non_empty = [s.strip() for s in samples if s.strip() != ""]
    if not non_empty:
        return "string"
    if all(s.lower() in ("true", "false") for s in non_empty):
        return "boolean"
    for s in non_empty:
        try:
            float(s)
        except ValueError:
            return "string"
    return "number"


def _build_json_tree(obj: Any, prefix: str = "root", depth: int = 0) -> list[dict[str, Any]]:
    if depth >= 3:
        return []
    nodes: list[dict[str, Any]] = []
    if isinstance(obj, dict):
        for idx, (k, v) in enumerate(list(obj.items())[:100]):
            node_id = f"{prefix}.{k}_{idx}"
            val_type = type(v).__name__
            children = _build_json_tree(v, prefix=node_id, depth=depth + 1)
            label = f"{k}: {val_type}" if isinstance(v, (dict, list)) else f"{k} = {str(v)[:40]}"
            nodes.append(
                {
                    "id": node_id,
                    "name": label,
                    "type": val_type,
                    "children": children,
                }
            )
    elif isinstance(obj, list):
        for idx, item in enumerate(obj[:50]):
            node_id = f"{prefix}[{idx}]"
            val_type = type(item).__name__
            children = _build_json_tree(item, prefix=node_id, depth=depth + 1)
            nodes.append(
                {
                    "id": node_id,
                    "name": f"[{idx}] ({val_type})",
                    "type": val_type,
                    "children": children,
                }
            )
    return nodes


def _probe_sync(path: Path) -> ProbeResult:
    ext = path.suffix.lower().lstrip(".")
    details: dict[str, Any] = {}
    if ext == "csv":
        with path.open("r", encoding="utf-8", errors="replace", newline="") as fh:
            reader = csv.reader(fh)
            headers = next(reader, [])
            col_samples: list[list[str]] = [[] for _ in headers]
            row_count = 0
            truncated = False
            for row in reader:
                row_count += 1
                if row_count <= 100:
                    for i in range(min(len(headers), len(row))):
                        col_samples[i].append(row[i])
                if row_count >= _MAX_CSV_INSPECT_ROWS:
                    truncated = True
                    break
        columns = [
            {"name": h or f"col_{i}", "type": _infer_col_type(col_samples[i])}
            for i, h in enumerate(headers)
        ]
        details = {
            "row_count": row_count,
            "column_count": len(headers),
            "columns": columns,
            "truncated_scan": truncated,
        }
    else:
        text = path.read_text(encoding="utf-8", errors="replace")
        parsed = json.loads(text) if ext == "json" else yaml.safe_load(text)
        root_type = type(parsed).__name__
        details = {
            "root_type": root_type,
            "key_count": len(parsed) if isinstance(parsed, (dict, list)) else 1,
            "keys": list(parsed.keys())[:50] if isinstance(parsed, dict) else [],
        }

    return ProbeResult(format_id=ext, media_kind="data", details=details)


def _inspect_sync(path: Path, probe: ProbeResult) -> InspectionDocument:
    ext = path.suffix.lower().lstrip(".")
    tree: list[dict[str, Any]] = []
    if ext != "csv":
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            parsed = json.loads(text) if ext == "json" else yaml.safe_load(text)
            tree = _build_json_tree(parsed)
        except Exception:
            tree = []

    return InspectionDocument(
        kind="data",
        summary={
            "name": path.name,
            "format": ext,
            **{
                k: probe.details[k]
                for k in ("row_count", "column_count", "root_type", "key_count")
                if k in probe.details
            },
        },
        metadata=dict(probe.details),
        tree=tree,
        capabilities={
            "data_table": ext == "csv",
            "structured_data": ext in ("json", "yaml", "yml"),
        },
    )


def _derive_sync(path: Path, kind: str, params: dict[str, Any], out_dir: Path) -> DerivedResult:
    del params
    if kind != "parsed_json":
        raise NotImplementedError(f"Unsupported data derive kind '{kind}'")
    ext = path.suffix.lower().lstrip(".")
    text = path.read_text(encoding="utf-8", errors="replace")
    parsed = json.loads(text) if ext == "json" else yaml.safe_load(text)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "parsed.json"
    dest.write_text(json.dumps(parsed, indent=2, default=str), encoding="utf-8")
    return DerivedResult(
        kind=kind,
        storage_key=dest.name,
        mime_type="application/json",
        size=dest.stat().st_size,
    )


class DataHandler(FormatHandler):
    handler_id = "data_inspector"
    handler_version = "1.0.0"
    media_kind = "data"
    extensions = (".json", ".yaml", ".yml", ".csv")

    async def probe(self, path: Path) -> ProbeResult:
        return await asyncio.to_thread(_probe_sync, path)

    async def inspect(self, path: Path, probe: ProbeResult) -> InspectionDocument:
        return await asyncio.to_thread(_inspect_sync, path, probe)

    async def derive(
        self, path: Path, kind: str, params: dict[str, Any], out_dir: Path
    ) -> DerivedResult:
        return await asyncio.to_thread(_derive_sync, path, kind, params, out_dir)

    def capabilities(self) -> dict[str, bool]:
        return {"data_table": True, "structured_data": True}
