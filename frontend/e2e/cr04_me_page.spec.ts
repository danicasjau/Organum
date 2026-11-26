import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

const SCREENSHOTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots',
);

test.describe('CR04 §13 /me three-column page', () => {
  test('profile, my tasks and preview in one window; selection, persistence, stacking', async ({
    page,
  }) => {
    await loginAs(page, 'art_sam', 'DemoPass123!', { targetPath: '/me' });
    const root = page.locator('[data-ui="my-user-page"]');
    await expect(root).toHaveAttribute('data-layout', 'columns');
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveCount(0);
    for (const col of ['profile', 'tasks', 'preview']) {
      await expect(page.locator(`[data-ui="me-col-${col}"]`)).toBeVisible();
    }
    await expect(page.getByText('User Identity & Profile')).toBeVisible();
    await expect(page.locator('[data-ui="me-working-hours"]')).toBeVisible();
    await expect(page.locator('[data-ui="my-tasks-inbox"]')).toBeVisible();

    // Selecting a task card shows its detail in the preview column and marks the card.
    const card = page.locator('[data-ui="my-task-card"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('.org-inbox__card-sub').click();
    await expect(card).toHaveAttribute('data-selected', 'true');
    const preview = page.locator('[data-ui="me-col-preview"]');
    await expect(preview.locator('[data-ui="task-detail"]')).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/[?&]task=/);
    const code = (await card.locator('.org-inbox__code').textContent())?.trim() ?? '';
    await expect(preview).toContainText(code, { timeout: 10000 });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-me-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-me-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // Resize the first column with the keyboard; the layout is persisted across reloads.
    const handle = page.locator('[data-ui="split-handle"]').first();
    await handle.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('organum.me.layout.v1')))
      .not.toBeNull();
    const saved = await page.evaluate(() => localStorage.getItem('organum.me.layout.v1'));
    const widthBefore = (await page.locator('[data-ui="me-col-profile"]').boundingBox())!.width;
    await page.reload();
    await expect(page.locator('[data-ui="me-col-profile"]')).toBeVisible();
    const widthAfter = (await page.locator('[data-ui="me-col-profile"]').boundingBox())!.width;
    expect(Math.abs(widthAfter - widthBefore)).toBeLessThan(4);
    expect(await page.evaluate(() => localStorage.getItem('organum.me.layout.v1'))).toBe(saved);

    // Narrow window: the columns collapse into stacked sections.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(root).toHaveAttribute('data-layout', 'stacked');
    for (const col of ['profile', 'tasks', 'preview']) {
      await expect(page.locator(`[data-ui="me-col-${col}"]`)).toBeAttached();
    }
    await page.evaluate(() => localStorage.removeItem('organum.me.layout.v1'));
  });
});
