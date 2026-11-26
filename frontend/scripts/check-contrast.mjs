import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.resolve(__dirname, '../src/components/ui/styles/tokens.css');
const css = fs.readFileSync(tokensPath, 'utf8');

function extractVars(selectorRegex) {
  const match = css.match(selectorRegex);
  if (!match) return {};
  const body = match[1];
  const vars = {};
  for (const m of body.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

// Accept either quote style in the theme selectors (prettier normalises to single quotes).
const rootVars = extractVars(/:root,\s*\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\n\s*\}/);
const lightOverrides = extractVars(/\[data-theme=["']light["']\]\s*\{([\s\S]*?)\n\s*\}/);

function resolveVar(name, map, depth = 0) {
  if (depth > 8) return name;
  const val = map[name];
  if (!val) return null;
  const varMatch = val.match(/^var\((--[a-zA-Z0-9_-]+)\)$/);
  if (varMatch) return resolveVar(varMatch[1], map, depth + 1);
  return val;
}

function parseHex(hex) {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const l1 = luminance(hexA);
  const l2 = luminance(hexB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const checks = [
  ['--text', '--surface-panel', 4.5, 'text on panel'],
  ['--text', '--surface-window', 4.5, 'text on window'],
  ['--text', '--surface-field', 4.5, 'text on field'],
  ['--text', '--surface-raised', 4.5, 'text on raised'],
  ['--text', '--surface-hover', 4.5, 'text on hover'],
  ['--text', '--surface-pressed', 4.5, 'text on pressed'],
  ['--text-muted', '--surface-panel', 4.5, 'muted text on panel'],
  ['--text-muted', '--surface-field', 4.5, 'muted text on field'],
  ['--text-muted', '--surface-window', 4.5, 'muted text on window'],
  ['--accent-text', '--surface-panel', 4.5, 'accent text on panel'],
  ['--accent-text', '--surface-field', 4.5, 'accent text on field'],
  ['--danger-text', '--surface-panel', 4.5, 'danger text on panel'],
  ['--success-text', '--surface-panel', 4.5, 'success text on panel'],
  ['--btn-primary-fg', '--btn-primary-bg', 4.5, 'primary button'],
  ['--btn-success-fg', '--btn-success-bg', 4.5, 'success button'],
  ['--btn-danger-fg', '--btn-danger-bg', 4.5, 'danger button'],
  ['--focus-ring', '--surface-panel', 3.0, 'focus ring on panel'],
  ['--focus-ring', '--surface-field', 3.0, 'focus ring on field'],
  ['--highlight', '--surface-panel', 3.0, 'highlight border on panel'],
  ['--highlight', '--surface-field', 3.0, 'highlight border on field'],
  ['--highlight', '--surface-window', 3.0, 'highlight border on window'],
  ['--milestone-text', '--milestone', 4.5, 'milestone label'],
  ['--milestone', '--surface-field', 3.0, 'milestone diamond on field'],
  ['--border-control', '--surface-panel', 3.0, 'control border on panel'],
  ['--border-control', '--surface-field', 3.0, 'control border on field'],
  ['--capacity-do-text', '--capacity-do-bg', 4.5, 'capacity DO chip'],
  ['--capacity-lead-text', '--capacity-lead-bg', 4.5, 'capacity LEAD chip'],
  ['--capacity-sup-text', '--capacity-sup-bg', 4.5, 'capacity SUP chip'],
  ['--status-wtg', '--surface-panel', 4.5, 'status WTG on panel'],
  ['--status-rdy', '--surface-panel', 4.5, 'status RDY on panel'],
  ['--status-ip', '--surface-panel', 4.5, 'status IP on panel'],
  ['--status-rtk', '--surface-panel', 4.5, 'status RTK on panel'],
  ['--status-p-lead', '--surface-panel', 4.5, 'status P_LEAD on panel'],
  ['--status-p-sup', '--surface-panel', 4.5, 'status P_SUP on panel'],
  ['--status-p-client', '--surface-panel', 4.5, 'status P_CLIENT on panel'],
  ['--status-app', '--surface-panel', 4.5, 'status APP on panel'],
  ['--status-hld', '--surface-panel', 4.5, 'status HLD on panel'],
  ['--avatar-fg', '--avatar-hue-0', 4.5, 'avatar hue 0'],
  ['--avatar-fg', '--avatar-hue-1', 4.5, 'avatar hue 1'],
  ['--avatar-fg', '--avatar-hue-2', 4.5, 'avatar hue 2'],
  ['--avatar-fg', '--avatar-hue-3', 4.5, 'avatar hue 3'],
  ['--avatar-fg', '--avatar-hue-4', 4.5, 'avatar hue 4'],
];

let failed = false;
for (const [themeName, themeMap] of [
  ['dark', rootVars],
  ['light', { ...rootVars, ...lightOverrides }],
]) {
  console.log(`\n=== Contrast Check (${themeName}) ===`);
  for (const [fgVar, bgVar, minRatio, label] of checks) {
    const fg = resolveVar(fgVar, themeMap);
    const bg = resolveVar(bgVar, themeMap);
    if (!fg || !bg || !fg.startsWith('#') || !bg.startsWith('#')) {
      console.error(`MISSING: ${label} (${fgVar}=${fg}, ${bgVar}=${bg})`);
      failed = true;
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const ok = ratio >= minRatio;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${label.padEnd(26)} ${ratio.toFixed(2)}:1 (min ${minRatio}:1) [${fg} on ${bg}]`,
    );
  }
}

if (failed) {
  console.error('\nWCAG 2.2 AA contrast check FAILED.');
  process.exit(1);
}
console.log('\nAll contrast checks PASSED.');

