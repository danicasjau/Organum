import { create } from 'zustand';
import type { DepartmentOut } from '../../lib/api/client';

/**
 * Department colors are stored on the backend either as a palette token name
 * (e.g. "--series-3") or as a hex value chosen in Settings (e.g. "#E06C75").
 */
export const DEPT_PALETTE: ReadonlyArray<{ label: string; value: string }> = [
  // v1 department palette: desaturated, similar luminance.
  { label: 'Modeling', value: '#7A9CC6' },
  { label: 'Rigging', value: '#9B86C4' },
  { label: 'Animation', value: '#6FB3A0' },
  { label: 'Lookdev', value: '#C79B6A' },
  { label: 'Lighting', value: '#C4C06A' },
  { label: 'FX', value: '#C77A7A' },
  { label: 'Comp', value: '#8FB86A' },
  { label: 'Steel', value: '#8A9AAE' },
  { label: 'Teal', value: '#6AA8B3' },
  { label: 'Clay', value: '#B58A7A' },
  { label: 'Mauve', value: '#B07FA6' },
  { label: 'Sand', value: '#B8A882' },
];

/** Dark-theme hex of each --series-N token (kept in sync with tokens.css). */
const SERIES_HEX: Record<string, string> = {
  '--series-1': '#7A9CC6',
  '--series-2': '#6FB3A0',
  '--series-3': '#C79B6A',
  '--series-4': '#9B86C4',
  '--series-5': '#C77A7A',
  '--series-6': '#C4C06A',
  '--series-7': '#8FB86A',
  '--series-8': '#A8A8A8',
};

export const DEFAULT_DEPT_COLOR = '--series-1';

/** CSS value usable in a custom property (token -> var(), hex passthrough). */
export function deptColorCss(color: string | null | undefined): string {
  const c = (color ?? '').trim();
  if (!c) return `var(${DEFAULT_DEPT_COLOR})`;
  if (c.startsWith('--')) return `var(${c})`;
  return c;
}

/** Hex value for pickers (tokens resolved to their dark-theme hex). */
export function deptColorHex(color: string | null | undefined): string {
  const c = (color ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase();
  return SERIES_HEX[c] ?? SERIES_HEX[DEFAULT_DEPT_COLOR]!;
}

interface DeptColorState {
  byId: Record<string, string>;
  byName: Record<string, string>;
  setDepartments: (depts: ReadonlyArray<Pick<DepartmentOut, 'id' | 'name' | 'color'>>) => void;
}

export const useDeptColorStore = create<DeptColorState>((set) => ({
  byId: {},
  byName: {},
  setDepartments: (depts) => {
    const byId: Record<string, string> = {};
    const byName: Record<string, string> = {};
    for (const d of depts) {
      byId[d.id] = d.color;
      byName[d.name.toLowerCase()] = d.color;
    }
    set({ byId, byName });
  },
}));

/**
 * Resolve the CSS color for a department by id, then by name; an explicit color
 * (e.g. TaskListItemOut.department_color) is used as fallback when the catalog
 * is not loaded yet. Catalog values win so Settings edits show up everywhere.
 */
export function useDeptColor(ref: {
  id?: string | null;
  name?: string | null;
  color?: string | null;
}): string {
  const fromId = useDeptColorStore((s) => (ref.id ? s.byId[ref.id] : undefined));
  const fromName = useDeptColorStore((s) =>
    ref.name ? s.byName[ref.name.toLowerCase()] : undefined,
  );
  return deptColorCss(fromId ?? fromName ?? ref.color);
}
