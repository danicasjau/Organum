from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from app.models.project_db import FileEntry
from app.storage.base import StorageBackend

IMAGE_EXTS: frozenset[str] = frozenset(
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".tif",
        ".tiff",
        ".tga",
        ".webp",
        ".exr",
        ".hdr",
        ".pic",
        ".dpx",
        ".tx",
        ".tex",
    }
)

DEFAULT_UDIM_PATH_KEYWORDS: tuple[str, ...] = (
    "tex",
    "textures",
    "maps",
    "lookdev",
    "texturing",
    "udim",
    "material",
    "materials",
    "shading",
)

TEXTURE_STEM_KEYWORDS: frozenset[str] = frozenset(
    {
        "diffuse",
        "diff",
        "albedo",
        "basecolor",
        "base_color",
        "col",
        "color",
        "rough",
        "roughness",
        "metal",
        "metallic",
        "normal",
        "nrm",
        "bump",
        "height",
        "disp",
        "displacement",
        "ao",
        "spec",
        "specular",
        "mask",
        "opacity",
        "emissive",
        "sss",
        "coat",
        "udim",
    }
)

SHOT_CONTEXT_KEYWORDS: frozenset[str] = frozenset(
    {
        "comp",
        "compositing",
        "render",
        "renders",
        "plate",
        "plates",
        "shot",
        "shots",
        "anim",
        "animation",
        "turntable",
        "fx",
        "playblast",
        "lighting",
        "beauty",
    }
)

_NUMERIC_SEQ_RE = re.compile(r"^(?P<stem>.+?)(?P<sep>[._-])(?P<frame>\d{3,8})(?P<ext>\.[^.]+)$")
_MARI_UDIM_RE = re.compile(
    r"^(?P<stem>.+?)(?P<sep>[._-])u(?P<u>\d+)_v(?P<v>\d+)(?P<ext>\.[^.]+)$",
    re.IGNORECASE,
)


@dataclass(slots=True)
class UdimScoreResult:
    kind: str  # "udim" | "frames"
    score: int
    reasons: list[str]
    can_be_udim: bool


def mari_uv_to_udim(u: int, v: int) -> int | None:
    """Convert 1-based Mari (u, v) tile indices to 4-digit UDIM integer."""
    if 1 <= u <= 10 and 1 <= v <= 99:
        return 1001 + (u - 1) + 10 * (v - 1)
    return None


def udim_to_uv(udim: int) -> tuple[int, int]:
    """Return 0-based (u, v) cell coordinates for a UDIM tile (1001 -> (0, 0))."""
    offset = max(0, udim - 1001)
    return offset % 10, offset // 10


def _tokenize(text: str) -> set[str]:
    tokens = {tok.lower() for tok in re.split(r"[/\\._\-\s]+", text) if tok}
    return tokens


def check_uniform_image_dimensions(paths: list[Path]) -> bool | None:
    """Inspect image header sizes without full decode; return None if unreadable."""
    dims: set[tuple[int, int]] = set()
    for path in paths[:24]:
        try:
            with Image.open(path) as im:
                dims.add((int(im.width), int(im.height)))
        except Exception:
            return None
    if not dims:
        return None
    return len(dims) == 1


def score_udim_vs_frames(
    numbers: list[int],
    *,
    rel_dir: str,
    stem: str,
    mari_style: bool = False,
    same_size: bool | None = None,
    extra_keywords: list[str] | None = None,
) -> UdimScoreResult:
    """Score whether a numbered image set represents UDIM tiles or frame sequence (§9.4)."""
    if mari_style:
        return UdimScoreResult(
            kind="udim",
            score=10,
            reasons=["+10 Mari u1_v1 tile naming"],
            can_be_udim=True,
        )

    if not numbers or any(n < 1001 or n > 1999 for n in numbers):
        return UdimScoreResult(
            kind="frames",
            score=-10,
            reasons=["-10 numbers outside UDIM range 1001..1999"],
            can_be_udim=False,
        )

    score = 0
    reasons: list[str] = []
    path_tokens = _tokenize(rel_dir)
    stem_tokens = _tokenize(stem)

    merged_path_kws = set(DEFAULT_UDIM_PATH_KEYWORDS)
    if extra_keywords:
        merged_path_kws.update(k.strip().lower() for k in extra_keywords if k.strip())

    if path_tokens & merged_path_kws:
        score += 3
        reasons.append("+3 texture-like folder/department path")

    if stem_tokens & TEXTURE_STEM_KEYWORDS:
        score += 3
        reasons.append("+3 texture-map stem keyword")

    unique_sorted = sorted(set(numbers))
    expected_span = unique_sorted[-1] - unique_sorted[0] + 1
    is_contiguous = len(unique_sorted) == expected_span

    if len(unique_sorted) >= 2 and not is_contiguous:
        score += 2
        reasons.append("+2 sparse/gappy UDIM tile numbers")

    if same_size is True:
        score += 1
        reasons.append("+1 uniform tile dimensions")

    if max(unique_sorted) > 1010 and len(unique_sorted) > 10 and is_contiguous:
        score -= 4
        reasons.append("-4 long contiguous run above 1010")

    if (path_tokens | stem_tokens) & SHOT_CONTEXT_KEYWORDS:
        score -= 3
        reasons.append("-3 shot/render/motion context")

    kind = "udim" if score >= 0 else "frames"
    return UdimScoreResult(kind=kind, score=score, reasons=reasons, can_be_udim=True)


def collect_version_files(
    version_dir: Path,
    production_root: Path,
    udim_keywords: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Collect single files, frame sequences, and UDIM tile sets in a product version dir."""
    num_groups: dict[tuple[str, str, str, int], list[tuple[int, Path]]] = defaultdict(list)
    mari_groups: dict[tuple[str, str, str], list[tuple[int, Path]]] = defaultdict(list)
    non_seq: list[Path] = []
    rel_dir = version_dir.relative_to(production_root).as_posix()

    for path in sorted(version_dir.rglob("*")):
        if not path.is_file() or path.name.startswith(".") or path.name == "master.json":
            continue
        ext_low = path.suffix.lower()
        if path.parent == version_dir and ext_low in IMAGE_EXTS:
            m_mari = _MARI_UDIM_RE.match(path.name)
            if m_mari:
                udim = mari_uv_to_udim(int(m_mari.group("u")), int(m_mari.group("v")))
                if udim is not None:
                    key_m = (m_mari.group("stem"), m_mari.group("sep"), m_mari.group("ext"))
                    mari_groups[key_m].append((udim, path))
                    continue
            m_num = _NUMERIC_SEQ_RE.match(path.name)
            if m_num:
                key_n = (
                    m_num.group("stem"),
                    m_num.group("sep"),
                    m_num.group("ext"),
                    len(m_num.group("frame")),
                )
                num_groups[key_n].append((int(m_num.group("frame")), path))
                continue
        non_seq.append(path)

    discovered: list[dict[str, Any]] = []

    for (stem, sep, ext), tiles in sorted(mari_groups.items()):
        tiles.sort(key=lambda pair: pair[0])
        first_num, first_path = tiles[0]
        last_num, _ = tiles[-1]
        pattern_name = f"{stem}{sep}<UDIM>{ext}"
        discovered.append(
            {
                "relative_path": f"{rel_dir}/{pattern_name}",
                "filename": pattern_name,
                "disk_path": first_path,
                "is_sequence": True,
                "sequence_pattern": pattern_name,
                "sequence_kind": "udim",
                "frame_start": first_num,
                "frame_end": last_num,
                "frame_count": len(tiles),
            }
        )

    for (stem, sep, ext, pad), frames in sorted(num_groups.items()):
        if len(frames) < 2:
            non_seq.extend(p for _, p in frames)
            continue
        frames.sort(key=lambda pair: pair[0])
        nums = [n for n, _ in frames]
        paths = [p for _, p in frames]
        same_size = check_uniform_image_dimensions(paths) if pad == 4 else None
        scored = score_udim_vs_frames(
            nums,
            rel_dir=rel_dir,
            stem=stem,
            mari_style=False,
            same_size=same_size,
            extra_keywords=udim_keywords,
        )
        first_num, first_path = frames[0]
        last_num, _ = frames[-1]
        pattern_name = f"{stem}{sep}{'#' * pad}{ext}"
        discovered.append(
            {
                "relative_path": f"{rel_dir}/{pattern_name}",
                "filename": pattern_name,
                "disk_path": first_path,
                "is_sequence": True,
                "sequence_pattern": pattern_name,
                "sequence_kind": scored.kind,
                "frame_start": first_num,
                "frame_end": last_num,
                "frame_count": len(frames),
            }
        )

    for path in sorted(non_seq):
        discovered.append(
            {
                "relative_path": path.relative_to(production_root).as_posix(),
                "filename": path.name,
                "disk_path": path,
                "is_sequence": False,
                "sequence_pattern": None,
                "sequence_kind": "none",
                "frame_start": None,
                "frame_end": None,
                "frame_count": None,
            }
        )
    return discovered


def _parse_pattern_parts(sequence_pattern: str) -> tuple[str, str, int] | None:
    """Split a pattern like 'albedo.####.png' or 'albedo_<UDIM>.exr' into (prefix, suffix, pad)."""
    if "<UDIM>" in sequence_pattern:
        prefix, suffix = sequence_pattern.split("<UDIM>", 1)
        return prefix, suffix, 4
    m = re.search(r"#+", sequence_pattern)
    if m:
        return sequence_pattern[: m.start()], sequence_pattern[m.end() :], len(m.group(0))
    return None


@dataclass(slots=True)
class UdimTileEntry:
    udim: int
    u: int
    v: int
    filename: str
    relative_path: str
    disk_path: Path
    width: int | None
    height: int | None
    size: int
    mari_style: bool


def resolve_udim_tiles(entry: FileEntry, storage: StorageBackend) -> list[UdimTileEntry]:
    """Scan sibling files matching `entry.sequence_pattern` and return sorted UDIM tiles."""
    if not entry.sequence_pattern:
        return []
    parts = _parse_pattern_parts(entry.sequence_pattern)
    if parts is None:
        return []
    prefix, suffix, pad = parts
    rel_dir = entry.relative_path.rsplit("/", 1)[0] if "/" in entry.relative_path else ""
    folder = storage.resolve_safe(rel_dir) if rel_dir else storage.root
    if not folder.is_dir():
        return []

    num_re = re.compile(rf"^{re.escape(prefix)}(?P<num>\d{{{pad}}}){re.escape(suffix)}$")
    mari_re = re.compile(
        rf"^{re.escape(prefix)}u(?P<u>\d+)_v(?P<v>\d+){re.escape(suffix)}$",
        re.IGNORECASE,
    )

    tiles: list[UdimTileEntry] = []
    for cand in sorted(folder.iterdir()):
        if not cand.is_file():
            continue
        udim: int | None = None
        is_mari = False
        m_num = num_re.match(cand.name)
        if m_num:
            val = int(m_num.group("num"))
            if 1001 <= val <= 1999:
                udim = val
        else:
            m_mari = mari_re.match(cand.name)
            if m_mari:
                udim = mari_uv_to_udim(int(m_mari.group("u")), int(m_mari.group("v")))
                is_mari = True
        if udim is None:
            continue

        w: int | None = None
        h: int | None = None
        try:
            with Image.open(cand) as im:
                w, h = int(im.width), int(im.height)
        except Exception:
            w, h = None, None
        u_idx, v_idx = udim_to_uv(udim)
        rel_p = f"{rel_dir}/{cand.name}" if rel_dir else cand.name
        tiles.append(
            UdimTileEntry(
                udim=udim,
                u=u_idx,
                v=v_idx,
                filename=cand.name,
                relative_path=rel_p,
                disk_path=cand,
                width=w,
                height=h,
                size=cand.stat().st_size,
                mari_style=is_mari,
            )
        )
    tiles.sort(key=lambda t: t.udim)
    return tiles


def resolve_udim_tile_path(
    entry: FileEntry,
    storage: StorageBackend,
    udim: int,
) -> Path | None:
    for tile in resolve_udim_tiles(entry, storage):
        if tile.udim == udim:
            return tile.disk_path
    return None
