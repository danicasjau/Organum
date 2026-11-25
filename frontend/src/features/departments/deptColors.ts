import { create } from 'zustand';
import type { DepartmentOut } from '../../lib/api/client';

/**
 * Department colors are stored on the backend either as a palette token name
 * (e.g. "--series-3") or as a hex value chosen in Settings (e.g. "#E06C75").
 */
export const DEPT_PALETTE: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Purple', value: '#8B5CF6' },
  { label: 'Green', value: '#10B981' },
  { label: 'Sky', value: '#38BDF8' },
  { label: 'Amber', value: '#F59E0B' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Lavender', value: '#A78BFA' },
  { label: 'Mint', value: '#34D399' },
  { label: 'Pink', value: '#F472B6' },
  { label: 'Teal', value: '#2DD4BF' },
  { label: 'Orange', value: '#FB923C' },
  { label: 'Indigo', value: '#818CF8' },
  { label: 'Lime', value: '#A3E635' },
];

const SERIES_HEX: Record<string, string> = {
  '--series-1': '#8B5CF6',
  '--series-2': '#10B981',
  '--series-3': '#38BDF8',
  '--series-4': '#F59E0B',
  '--series-5': '#EF4444',
  '--series-6': '#A78BFA',
  '--series-7': '#34D399',
  '--series-8': '#E2E8F0',
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
