import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { ensureHeroRobotSelected, loginAs, logoutViaMenu } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/phase7a');

function readPngRgba(filePath: string): { width: number; height: number; pixels: Uint8Array } {
  const buf = fs.readFileSync(filePath);
  const idatParts: Buffer[] = [];
  let width = 0;
  let height = 0;
  let colorType = 6;
  let pos = 8; // skip 8-byte PNG signature
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const chunkType = buf.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (chunkType === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      colorType = buf[dataStart + 9] ?? 6;
    } else if (chunkType === 'IDAT') {
      idatParts.push(buf.subarray(dataStart, dataStart + len));
    } else if (chunkType === 'IEND') {
      break;
    }
    pos = dataStart + len + 4;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const curr = raw[rowIn + x] ?? 0;
      const a = x >= bpp ? (out[rowOut + x - bpp] ?? 0) : 0;
      const b = y > 0 ? (out[rowOut - stride + x] ?? 0) : 0;
      const c = y > 0 && x >= bpp ? (out[rowOut - stride + x - bpp] ?? 0) : 0;
      let val = curr;
      if (filter === 1) val = (curr + a) & 0xff;
      else if (filter === 2) val = (curr + b) & 0xff;
      else if (filter === 3) val = (curr + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (curr + paeth(a, b, c)) & 0xff;
      out[rowOut + x] = val;
    }
  }
  if (bpp === 4) return { width, height, pixels: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i] ?? 0;
    rgba[j + 1] = out[i + 1] ?? 0;
    rgba[j + 2] = out[i + 2] ?? 0;
    rgba[j + 3] = 255;
  }
  return { width, height, pixels: rgba };
}

function measureAccentPixelRatio(filePath: string): number {
  const { width, height, pixels } = readPngRgba(filePath);
  const total = width * height;
  let accentCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = (pixels[i] ?? 0) / 255;
    const g = (pixels[i + 1] ?? 0) / 255;
    const b = (pixels[i + 2] ?? 0) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const sat = max === 0 ? 0 : delta / max;
    // Flag saturated violet/purple accent pixels (the primary brand accent)
    if (sat > 0.38 && b > r * 0.9 && b > g * 1.15 && max > 0.35) {
      accentCount++;
    }
  }
  return accentCount / Math.max(1, total);
}

test.describe('Phase 7A — Auth, RBAC, Capacities, Client Isolation & Admin Console', () => {
  test('verifies login, forced password change, /users, /me, /admin, capacities, and client boundary', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      // Allow intentional 404 network probe error on client boundary test
      const text = msg.text();
      if (msg.type() === 'error' && !text.includes('404')) {
        errors.push(text);
      }
    });

    // 1. Unauthenticated route redirects to /login; capture dark & light login
    await page.goto('/entities');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.getByText('Sign In — ORGANUM')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const loginDark = path.join(SCREENSHOTS_DIR, 'phase7a-login-dark.png');
    await page.screenshot({ path: loginDark });
    expect(measureAccentPixelRatio(loginDark)).toBeLessThan(0.1);

    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const loginLight = path.join(SCREENSHOTS_DIR, 'phase7a-login-light.png');
    await page.screenshot({ path: loginLight });
    expect(measureAccentPixelRatio(loginLight)).toBeLessThan(0.1);
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // 2. Sign in as qa_admin and check Users directory, Companies, Departments + create temp user
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/users' });
    await expect(page.getByRole('button', { name: 'USERS', exact: true })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Users directory' })).toBeVisible();
    await expect(page.getByText('prod_maya')).toBeVisible();
    await expect(page.getByText('cli_jordan')).toBeVisible();

    const usersDark = path.join(SCREENSHOTS_DIR, 'phase7a-users-dark.png');
    await page.screenshot({ path: usersDark });
    expect(measureAccentPixelRatio(usersDark)).toBeLessThan(0.1);

    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const usersLight = path.join(SCREENSHOTS_DIR, 'phase7a-users-light.png');
    await page.screenshot({ path: usersLight });
    expect(measureAccentPixelRatio(usersLight)).toBeLessThan(0.1);
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    await page.getByRole('tab', { name: /Companies/ }).click();
    await expect(page.getByRole('button', { name: /Studio Internal/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Client Studio/ })).toBeVisible();
    await page.getByRole('tab', { name: /Departments/ }).click();
    await expect(page.getByRole('cell', { name: 'Lighting', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /Users \(/ }).click();

    // Create a temporary artist user with forced initial password change
    await page.getByRole('button', { name: '+ New User' }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Username').fill('tmp_artist');
    await createDialog.getByLabel('Full Name').fill('Temp Artist');
    await createDialog.getByLabel('Temporary Password (min 10 chars)').fill('TempPass999!');
    await createDialog.getByRole('button', { name: 'Create User' }).click();
    await expect(page.getByText('Created user @tmp_artist.')).toBeVisible({ timeout: 5000 });

    // Log out and sign in as tmp_artist -> verify forced password change modal
    await logoutViaMenu(page);
    await page.getByLabel('Username').fill('tmp_artist');
    await page.getByLabel('Password').fill('TempPass999!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Password Change Required')).toBeVisible({ timeout: 10000 });
    await page.getByLabel('New Password', { exact: true }).fill('UpdatedPass999!');
    await page.getByLabel('Confirm New Password', { exact: true }).fill('UpdatedPass999!');
    await page.getByRole('button', { name: 'Set Password' }).click();
    await expect(page.getByText('Password Change Required')).toHaveCount(0, { timeout: 10000 });
    await expect(page).toHaveURL(/\/entities/);

    // 3. Log in as qa_admin -> test /me and /admin (Roles + Capacities + Audit Log)
    await logoutViaMenu(page);
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/me' });
    await expect(page.getByText('User Identity & Profile')).toBeVisible();
    await expect(page.getByText('8h / day')).toBeVisible();
    const meDark = path.join(SCREENSHOTS_DIR, 'phase7a-me-dark.png');
    await page.screenshot({ path: meDark });
    expect(measureAccentPixelRatio(meDark)).toBeLessThan(0.1);

    await page.goto('/admin');
    await expect(page.getByRole('table', { name: 'Role permissions matrix' })).toBeVisible();
    const adminDark = path.join(SCREENSHOTS_DIR, 'phase7a-admin-dark.png');
    await page.screenshot({ path: adminDark });
    expect(measureAccentPixelRatio(adminDark)).toBeLessThan(0.1);

    await page.getByRole('button', { name: 'Toggle theme' }).click();
    const adminLight = path.join(SCREENSHOTS_DIR, 'phase7a-admin-light.png');
    await page.screenshot({ path: adminLight });
    expect(measureAccentPixelRatio(adminLight)).toBeLessThan(0.1);
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    await page.getByRole('tab', { name: 'Capacities Matrix' }).click();
    await expect(page.getByRole('table', { name: 'Capacity permissions matrix' })).toBeVisible();
    await page.getByRole('button', { name: 'Audit Log' }).click();
    await expect(page.getByText('Security & Production Audit Log')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'auth.login' }).first()).toBeVisible();

    // 4. Sign in as dir_alex -> read-only /users, no Admin Console, SUP badge on Lighting/beauty
    await logoutViaMenu(page);
    await loginAs(page, 'dir_alex', 'DemoPass123!', { targetPath: '/entities' });
    await expect(page.getByRole('button', { name: 'USERS', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Admin Console' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await ensureHeroRobotSelected(page);
    const deptTree = page.getByRole('tree', { name: 'Entity departments and tasks' });
    const beautyRow = deptTree.getByRole('treeitem', { name: /^beauty\b/ });
    await expect(beautyRow).toContainText('SUP');

    // 5. Sign in as art_sam -> no USERS tab, DO badge on Modeling/main
    await logoutViaMenu(page);
    await loginAs(page, 'art_sam', 'DemoPass123!', { targetPath: '/entities' });
    await expect(page.getByRole('button', { name: 'USERS', exact: true })).toHaveCount(0);
    await ensureHeroRobotSelected(page);
    const mainRow = page
      .getByRole('tree', { name: 'Entity departments and tasks' })
      .getByRole('treeitem', { name: /^main\b/ });
    await expect(mainRow).toContainText('DO');

    // 6. Sign in as cli_jordan -> only shared Lighting/beauty visible, no Scenefiles, no USERS
    await logoutViaMenu(page);
    await loginAs(page, 'cli_jordan', 'DemoPass123!', { targetPath: '/entities' });
    await expect(page.getByRole('button', { name: 'USERS', exact: true })).toHaveCount(0);
    await expect(page.getByText('Scenefiles', { exact: true })).toHaveCount(0);
    await ensureHeroRobotSelected(page);
    const clientTree = page.getByRole('tree', { name: 'Entity departments and tasks' });
    await expect(clientTree.getByRole('treeitem', { name: /^beauty\b/ })).toBeVisible();
    await expect(clientTree.getByRole('treeitem', { name: /^main\b/ })).toHaveCount(0);
    await clientTree.getByRole('treeitem', { name: /^beauty\b/ }).click();

    // Unshared file probe returns 404 for client
    const clientProbeStatus = await page.evaluate(async () => {
      const meRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
      const me = (await meRes.json()) as { project_uuid: string };
      const res = await fetch(
        `/api/v1/projects/${me.project_uuid}/files/00000000-0000-0000-0000-000000000001/inspect`,
        { credentials: 'include' },
      );
      return res.status;
    });
    expect(clientProbeStatus).toBe(404);

    const clientDark = path.join(SCREENSHOTS_DIR, 'phase7a-client-dark.png');
    await page.screenshot({ path: clientDark });
    expect(measureAccentPixelRatio(clientDark)).toBeLessThan(0.1);

    expect(errors).toEqual([]);
  });
});

