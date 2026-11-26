/**
 * Read a design token (CSS custom property) as a concrete colour string for
 * canvas / WebGL code that cannot use var(). Resolves against the given
 * element (so zone / theme subtrees apply) or the document root.
 *
 * Returns `fallback` outside the browser or when the token is missing.
 */
export function readCssToken(name: string, fallback = '', el?: Element | null): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const target = el ?? document.documentElement;
  const raw = window.getComputedStyle(target).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (!raw.startsWith('var(') && !raw.includes('color-mix')) return raw;
  // Custom properties holding var()/color-mix() are returned unresolved by
  // getComputedStyle; resolve them through a probe element's `color`.
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  probe.style.display = 'none';
  (el instanceof HTMLElement ? el : document.body).appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

/** Same as readCssToken but applies an alpha (0–1) to the resolved colour. */
export function readCssTokenAlpha(name: string, alpha: number, fallback = '', el?: Element | null): string {
  const c = readCssToken(name, fallback, el);
  if (!c) return fallback;
  const rgb = toRgb(c);
  if (!rgb) return c;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Resolve a token to an [r, g, b] triple (for per-pixel alpha in canvas code). */
export function readCssTokenRgb(
  name: string,
  fallback: [number, number, number],
  el?: Element | null,
): [number, number, number] {
  return toRgb(readCssToken(name, '', el)) ?? fallback;
}

function toRgb(c: string): [number, number, number] | null {
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.split('').map((x) => x + x).join('') : hex[1]!;
    const n = Number.parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
