/** CR04 §3 Confo: pure helpers shared by the grid, import and export (unit-tested). */

export type ConfoColType =
  | 'text'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'url'
  | 'user'
  | 'color'
  | 'entity';

export const CONFO_TYPES: ReadonlyArray<{ value: ConfoColType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Decimal' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'select', label: 'Single select' },
  { value: 'multiselect', label: 'Multi select' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
  { value: 'user', label: 'User' },
  { value: 'color', label: 'Colour' },
  { value: 'entity', label: 'Entity reference' },
];

export interface ConfoColumnLike {
  key: string;
  label: string;
  col_type: string;
}

export interface RefLookup {
  users: ReadonlyMap<string, string>;
  entities: ReadonlyMap<string, string>;
}

export const EMPTY_LOOKUP: RefLookup = { users: new Map(), entities: new Map() };

/** Human-readable text for a typed value (used in cells, search, copy and CSV export). */
export function formatConfoValue(
  colType: string,
  value: unknown,
  lookup: RefLookup = EMPTY_LOOKUP,
): string {
  if (value === null || value === undefined) return '';
  switch (colType) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'user':
      return lookup.users.get(String(value)) ?? String(value);
    case 'entity':
      return lookup.entities.get(String(value)) ?? String(value);
    default:
      return String(value);
  }
}

/** RFC 4180 CSV. Cells starting with = + - @ are prefixed so spreadsheets don't run them. */
export function toCsv(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const esc = (raw: string) => {
    const v = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  // BOM so Excel opens UTF-8 CSV (accents, ñ) correctly.
  const blob = new Blob(['﻿', text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function dateStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// ---------------------------------------------------------------- grouping (same as Matrix)

export type ConfoGroupBy = 'none' | 'path' | 'type';

export function confoGroupFor(
  mode: ConfoGroupBy,
  row: { rel_path?: unknown; entity_type?: unknown },
): { id: string; label: string } | null {
  if (mode === 'none') return null;
  if (mode === 'type') {
    const t = String(row.entity_type ?? '').trim() || 'Untyped';
    return { id: `type:${t}`, label: t };
  }
  const parts = String(row.rel_path ?? '')
    .split('/')
    .filter(Boolean);
  const label = parts.length > 1 ? parts.slice(0, -1).join(' ▸ ') : 'Root';
  return { id: `path:${label}`, label };
}

// ---------------------------------------------------------------- undo / redo

export interface AppliedChange {
  entity_id: string;
  column_key: string;
  before: unknown;
  after: unknown;
}

export interface HistoryState {
  undo: AppliedChange[][];
  redo: AppliedChange[][];
}

export const EMPTY_HISTORY: HistoryState = { undo: [], redo: [] };
const HISTORY_LIMIT = 100;

export function pushHistory(h: HistoryState, batch: AppliedChange[]): HistoryState {
  if (batch.length === 0) return h;
  return { undo: [...h.undo, batch].slice(-HISTORY_LIMIT), redo: [] };
}

/** Changes to send to undo the latest batch (values restored to `before`). */
export function undoPayload(batch: AppliedChange[]) {
  return [...batch]
    .reverse()
    .map((c) => ({ entity_id: c.entity_id, column_key: c.column_key, value: c.before }));
}

export function redoPayload(batch: AppliedChange[]) {
  return batch.map((c) => ({ entity_id: c.entity_id, column_key: c.column_key, value: c.after }));
}

export function afterUndo(h: HistoryState): HistoryState {
  const last = h.undo[h.undo.length - 1];
  if (!last) return h;
  return { undo: h.undo.slice(0, -1), redo: [...h.redo, last] };
}

export function afterRedo(h: HistoryState): HistoryState {
  const last = h.redo[h.redo.length - 1];
  if (!last) return h;
  return { undo: [...h.undo, last], redo: h.redo.slice(0, -1) };
}

// ---------------------------------------------------------------- server errors

export interface CellIssue {
  entity_id: string;
  column_key: string;
  message: string;
  line?: number;
}

export function isCellIssueList(details: unknown): details is CellIssue[] {
  return (
    Array.isArray(details) &&
    details.every((d) => d && typeof d === 'object' && 'column_key' in d && 'message' in d)
  );
}

export function errorReportCsv(issues: ReadonlyArray<CellIssue>): string {
  return toCsv(
    ['line', 'entity', 'column', 'message'],
    issues.map((i) => [i.line ? String(i.line) : '', i.entity_id, i.column_key, i.message]),
  );
}

/** Suggest a column key from a label: "2D VFX" -> "vfx_2d" style is not guessed; "2d_vfx". */
export function keyFromLabel(label: string): string {
  const k = label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!k) return '';
  return /^[a-z]/.test(k) ? k.slice(0, 64) : `c_${k}`.slice(0, 64);
}
