import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

test.describe('Phase 6A Foundation — Projects, Settings, Departments & PanelSwitcher', () => {
  test('opens /entities default workspace, creates project via Settings, manages departments & launchers', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organum-e2e-proj-'));

    try {
      await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/entities' });
      await expect(page).toHaveURL(/\/entities/);
      await expect(page.getByText('ORGANUM', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'ENTITIES', exact: true })).toBeVisible();

      // Demo project entity loaded by default on startup + default viewer loaded
      await expect(page.getByRole('option', { name: /hero_robot/ })).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('[data-ui="image-viewer-2d"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.org-viewer2d__overlay')).toHaveCount(0, { timeout: 10000 });
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'phase6a-workspace-dark.png'),
      });

      // Open Settings dialog from gear icon
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByText('Settings — ORGANUM Preferences')).toBeVisible();

      // Create a brand new project from scratch
      await page.getByLabel('New project folder path').fill(tempProjectDir);
      await page.getByLabel('New project name').fill('E2E Alpha Show');
      await expect(page.getByText('E2E_Alpha_Show')).toBeVisible();

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'phase6a-settings-project-dark.png'),
      });

      await page.getByRole('button', { name: 'Create Project' }).click();
      await expect(page.getByText(/Created project 'E2E Alpha Show'/)).toBeVisible({
        timeout: 15000,
      });

      // Verify project files written on disk
      expect(fs.existsSync(path.join(tempProjectDir, '00_Pipeline', 'project.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempProjectDir, '00_Pipeline', 'project.db'))).toBe(true);
      expect(fs.existsSync(path.join(tempProjectDir, '01_Production'))).toBe(true);

      // Light mode screenshot of Project settings
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('radio', { name: /Light/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.getByRole('button', { name: 'Project', exact: true }).click();
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'phase6a-settings-project-light.png'),
      });
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('radio', { name: /Dark/ }).click();

      // Switch to E2E Alpha Show -> triggers login for newly created project & forced password change
      await page.getByRole('button', { name: 'Project', exact: true }).click();
      await page
        .locator('.org-settings__list-row', { hasText: 'E2E Alpha Show' })
        .first()
        .getByRole('button', { name: 'Switch' })
        .click();
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
      await page.getByLabel('Username').fill('admin');
      await page.getByLabel('Password').fill('magicadmin**');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByText('Password Change Required')).toBeVisible({ timeout: 10000 });
      await page.getByLabel('New Password', { exact: true }).fill('AlphaPass1234!');
      await page.getByLabel('Confirm New Password', { exact: true }).fill('AlphaPass1234!');
      await page.getByRole('button', { name: 'Set Password' }).click();
      await expect(page.getByText('Password Change Required')).toHaveCount(0, { timeout: 10000 });

      // Check starter departments + add custom department & default task inside E2E Alpha Show
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Departments' }).click();
      await expect(page.getByText('Modeling', { exact: true })).toBeVisible();
      await expect(page.getByText('Compositing', { exact: true })).toBeVisible();
      await page.getByLabel('New department name').fill('CFX Cloth');
      await page.getByRole('button', { name: 'Add' }).first().click();
      await expect(page.getByText('CFX Cloth', { exact: true })).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'phase6a-settings-departments-dark.png'),
      });

      // Check Applications page (Autodetect + add + save)
      await page.getByRole('button', { name: 'Applications' }).click();
      await page.getByRole('button', { name: 'Autodetect Installed DCCs' }).click();
      await page.getByRole('button', { name: 'Add Launcher' }).click();
      await page.getByRole('button', { name: 'Save Launchers' }).click();
      await expect(page.getByText('Saved application launchers')).toBeVisible();

      // Switch back to demo project, sign in cleanly as qa_admin
      await page.getByRole('button', { name: 'Project', exact: true }).click();
      await page
        .locator('.org-settings__list-row', { hasText: 'ORGANUM Demo' })
        .getByRole('button', { name: 'Switch' })
        .click();
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
      await page.getByLabel('Username').fill('qa_admin');
      await page.getByLabel('Password').fill('DemoPass123!');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page).toHaveURL(/\/entities/, { timeout: 10000 });
      await expect(page.getByRole('option', { name: /hero_robot/ })).toBeVisible({
        timeout: 10000,
      });

      expect(errors).toEqual([]);
    } finally {
      // Remove created project reference via Forget before cleaning up temp dir
      await page.evaluate(async () => {
        const csrfMatch = document.cookie.match(/(?:^|; )organum_csrf=([^;]+)/);
        const csrf = csrfMatch?.[1] ? decodeURIComponent(csrfMatch[1]) : '';
        const res = await fetch('/api/v1/projects', { credentials: 'include' });
        if (!res.ok) return;
        const list = (await res.json()) as Array<{ uuid: string; name: string }>;
        for (const target of list.filter((p) => p.name === 'E2E Alpha Show')) {
          await fetch(`/api/v1/projects/${target.uuid}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: csrf ? { 'X-CSRF-Token': csrf } : {},
          });
        }
      });
      try {
        fs.rmSync(tempProjectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Ignore transient Windows file lock if server cleanup lags
      }
    }
  });
});

