/** Persisted column widths (percent per pane id) for the three-column /me page. */
export const ME_LAYOUT_KEY = 'organum.me.layout.v1';
const PANES = ['me-profile', 'me-tasks', 'me-preview'] as const;

export type MeLayout = Record<(typeof PANES)[number], number>;

export function parseMeLayout(raw: string | null): MeLayout | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const rec = parsed as Record<string, unknown>;
    const out: Partial<MeLayout> = {};
    for (const id of PANES) {
      const v = rec[id];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= 100) return undefined;
      out[id] = v;
    }
    const total = PANES.reduce((acc, id) => acc + (out[id] ?? 0), 0);
    return Math.abs(total - 100) < 1 ? (out as MeLayout) : undefined;
  } catch {
    return undefined;
  }
}

export function loadMeLayout(): MeLayout | undefined {
  try {
    return parseMeLayout(localStorage.getItem(ME_LAYOUT_KEY));
  } catch {
    return undefined;
  }
}

export function saveMeLayout(layout: Record<string, number>): void {
  const clean = parseMeLayout(JSON.stringify(layout));
  if (!clean) return;
  try {
    localStorage.setItem(ME_LAYOUT_KEY, JSON.stringify(clean));
  } catch {
    // Storage unavailable (private mode): the layout simply is not remembered.
  }
}
