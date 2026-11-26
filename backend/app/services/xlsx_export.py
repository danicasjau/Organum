"""CR04 §10: styled XLSX exports (XlsxWriter, BSD-2-Clause, constant-memory streaming).

The browser sends exactly the rows and columns it shows (already filtered), so every export
matches the screen. Styling: coloured header bands per column group, banded rows, status /
priority colours as cell fills (the code text is kept), frozen header, auto-filter, sensible
widths, date/number formats and a legend sheet.
"""

from __future__ import annotations

import re
import tempfile
from collections.abc import Sequence
from datetime import date, datetime
from typing import IO, Any

import xlsxwriter

# Status / priority fills (Excel can't read CSS tokens; these mirror the app palette).
STATUS_FILLS: dict[str, tuple[str, str]] = {
    "WTG": ("#CBD5E1", "Waiting"),
    "RDY": ("#BFDBFE", "Ready to start"),
    "IP": ("#FDE68A", "In progress"),
    "RTK": ("#FECACA", "Retake"),
    "P_LEAD": ("#DDD6FE", "Pending lead review"),
    "P_SUP": ("#E9D5FF", "Pending supervisor review"),
    "P_CLIENT": ("#FBCFE8", "Pending client review"),
    "APP": ("#BBF7D0", "Approved"),
    "HLD": ("#E5E7EB", "On hold"),
}
PRIORITY_FILLS: dict[str, tuple[str, str]] = {
    "normal": ("#F1F5F9", "Normal"),
    "high": ("#FED7AA", "High"),
    "stopper": ("#FCA5A5", "Stopper"),
}
GROUP_FILLS = ("#1E3A8A", "#065F46", "#7C2D12", "#4C1D95", "#831843", "#134E4A")
BAND_FILL = "#F1F5F9"
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_SHEET_NAME = 31


def _sheet_name(name: str, used: set[str]) -> str:
    clean = re.sub(r"[\[\]:*?/\\]", "_", name).strip() or "Sheet"
    clean = clean[:MAX_SHEET_NAME]
    base, n = clean, 2
    while clean.lower() in used:
        suffix = f" ({n})"
        clean = base[: MAX_SHEET_NAME - len(suffix)] + suffix
        n += 1
    used.add(clean.lower())
    return clean


def _as_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}", value):
        try:
            return datetime.strptime(value[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list | tuple):
        return ", ".join(_text(v) for v in value)
    return str(value)


def build_xlsx(
    *,
    title: str,
    sheets: Sequence[dict[str, Any]],
    styled: bool,
) -> IO[bytes]:
    """Write the workbook to a spooled temp file (constant memory) and return it rewound."""
    out: IO[bytes] = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)  # noqa: SIM115
    wb = xlsxwriter.Workbook(
        out, {"constant_memory": True, "in_memory": False, "strings_to_formulas": False}
    )
    wb.set_properties({"title": title, "comments": "Exported from ORGANUM"})
    f_head = wb.add_format({"bold": True, "border": 1, "valign": "vcenter"})
    f_date = wb.add_format({"num_format": "yyyy-mm-dd"})
    f_int = wb.add_format({"num_format": "0"})
    f_num = wb.add_format({"num_format": "0.00"})
    styled_cache: dict[tuple[str, bool, str], Any] = {}

    def fmt(fill: str | None, band: bool, num: str = "") -> Any:
        key = (fill or "", band, num)
        if key not in styled_cache:
            props: dict[str, Any] = {"border": 1, "border_color": "#CBD5E1"}
            if fill:
                props["bg_color"] = fill
            elif band:
                props["bg_color"] = BAND_FILL
            if num:
                props["num_format"] = num
            styled_cache[key] = wb.add_format(props)
        return styled_cache[key]

    used: set[str] = set()
    for sheet in sheets:
        cols: list[dict[str, Any]] = list(sheet.get("columns", []))
        rows: list[dict[str, Any]] = list(sheet.get("rows", []))
        ws = wb.add_worksheet(_sheet_name(str(sheet.get("name", "Sheet")), used))
        has_groups = styled and any(c.get("group") for c in cols)
        header_row = 1 if has_groups else 0

        # Widths from the header and a sample of the data (set before writing rows).
        for ci, col in enumerate(cols):
            header_len = len(str(col.get("header", ""))) + 2
            longest = max((len(_text(r.get(col["key"]))) + 2 for r in rows[:300]), default=0)
            ws.set_column(ci, ci, col.get("width") or min(60, max(8, header_len, longest)))

        # Group index per column (consecutive columns with the same group share a band).
        group_idx: list[int] = []
        for ci, col in enumerate(cols):
            same = ci > 0 and col.get("group") == cols[ci - 1].get("group")
            group_idx.append(group_idx[-1] if same else (group_idx[-1] + 1 if group_idx else 0))

        if has_groups:
            groups: list[tuple[str, int, int]] = []
            for ci, col in enumerate(cols):
                g = str(col.get("group") or "")
                if groups and groups[-1][0] == g:
                    groups[-1] = (g, groups[-1][1], ci)
                else:
                    groups.append((g, ci, ci))
            for gi, (g, c0, c1) in enumerate(groups):
                gf = wb.add_format(
                    {
                        "bold": True,
                        "font_color": "#FFFFFF",
                        "bg_color": GROUP_FILLS[gi % len(GROUP_FILLS)],
                        "align": "center",
                        "border": 1,
                    }
                )
                if c1 > c0:
                    ws.merge_range(0, c0, 0, c1, g, gf)
                else:
                    ws.write(0, c0, g, gf)

        for ci, col in enumerate(cols):
            if styled:
                hf = wb.add_format(
                    {
                        "bold": True,
                        "border": 1,
                        "font_color": "#FFFFFF",
                        "bg_color": GROUP_FILLS[group_idx[ci] % len(GROUP_FILLS)],
                        "text_wrap": True,
                    }
                )
                ws.write(header_row, ci, str(col.get("header", col["key"])), hf)
            else:
                ws.write(header_row, ci, str(col.get("header", col["key"])), f_head)

        for ri, row in enumerate(rows):
            r = header_row + 1 + ri
            band = styled and ri % 2 == 1
            for ci, col in enumerate(cols):
                kind = col.get("kind", "text")
                value = row.get(col["key"])
                fill: str | None = None
                if styled and kind == "status":
                    fill = STATUS_FILLS.get(str(value), (None, ""))[0]
                elif styled and kind == "priority":
                    fill = PRIORITY_FILLS.get(str(value), (None, ""))[0]
                elif styled and kind == "color" and isinstance(value, str) and HEX_RE.match(value):
                    fill = value
                if value is None or value == "":
                    if styled:
                        ws.write_blank(r, ci, None, fmt(None, band))
                    continue
                if kind == "date" and (d := _as_date(value)) is not None:
                    ws.write_datetime(
                        r,
                        ci,
                        datetime(d.year, d.month, d.day),
                        fmt(fill, band, "yyyy-mm-dd") if styled else f_date,
                    )
                elif (
                    kind in ("number", "integer")
                    and isinstance(value, int | float)
                    and not isinstance(value, bool)
                ):
                    num = "0" if kind == "integer" else "0.00"
                    ws.write_number(
                        r,
                        ci,
                        value,
                        fmt(fill, band, num) if styled else (f_int if kind == "integer" else f_num),
                    )
                else:
                    text = _text(value)
                    # Never let exported text run as a formula.
                    if styled:
                        ws.write_string(r, ci, text, fmt(fill, band))
                    else:
                        ws.write_string(r, ci, text)

        last_row = header_row + len(rows)
        if cols:
            ws.freeze_panes(header_row + 1, 0)
            ws.autofilter(header_row, 0, max(last_row, header_row), len(cols) - 1)

    if styled:
        lg = wb.add_worksheet(_sheet_name("Legend", used))
        lg.set_column(0, 0, 14)
        lg.set_column(1, 1, 32)
        lg.write(0, 0, "Status", f_head)
        lg.write(0, 1, "Meaning", f_head)
        r = 1
        for code, (fill, label) in STATUS_FILLS.items():
            lg.write(r, 0, code, wb.add_format({"bg_color": fill, "border": 1}))
            lg.write(r, 1, label)
            r += 1
        r += 1
        lg.write(r, 0, "Priority", f_head)
        lg.write(r, 1, "Meaning", f_head)
        r += 1
        for code, (fill, label) in PRIORITY_FILLS.items():
            lg.write(r, 0, code, wb.add_format({"bg_color": fill, "border": 1}))
            lg.write(r, 1, label)
            r += 1
        r += 1
        lg.write(r, 0, "Note")
        lg.write(r, 1, "Cell colours repeat the code text, so nothing relies on colour alone.")
    wb.close()
    out.seek(0)
    return out
