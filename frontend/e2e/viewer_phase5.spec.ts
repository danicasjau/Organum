import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, selectDemoFile } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

test.describe('Phase 5 Formats, Scopes, PDF, DataGrid & Charts', () => {
  test('inspects HDR/DPX/TX via WebGL2 float + Scopes, PDF viewer, DataGrid CSV, YAML/JSON, and Gallery', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/viewer' });

    // 1. Open env_light.hdr -> verify float decode + Inspector RGB/Luma Histogram Scope
    await selectDemoFile(page, 'textures', /env_light\.hdr/);
    await expect(page.locator('[data-ui="image-viewer-2d"]')).toBeVisible();
    await expect(page.locator('.org-viewer2d__overlay')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByRole('img', { name: 'Histogram scope' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase5-hdr-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase5-hdr-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // 2. Open plate.dpx & albedo.tx -> check Mip switcher
    await page.getByRole('treeitem', { name: /plate\.dpx/ }).click();
    await expect(page.locator('.org-viewer2d__overlay')).toHaveCount(0, { timeout: 10000 });
    await page.getByRole('treeitem', { name: /albedo\.tx/ }).click();
    await expect(page.locator('.org-viewer2d__overlay')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByText(/TX Mipmap Levels/)).toBeVisible();
    await page.getByRole('button', { name: /Mip 1/ }).click();

    // 3. Open review_brief.pdf -> verify canvas page render, Next Page, search, screenshot
    await selectDemoFile(page, 'brief', /review_brief\.pdf/);
    await expect(page.getByRole('img', { name: /PDF document page/ }).or(page.locator('canvas.org-pdf__canvas'))).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('spinbutton', { name: 'PDF page number' })).toHaveValue('1');
    await expect(page.locator('.org-pdf__overlay')).toHaveCount(0, { timeout: 10000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase5-pdf-dark.png') });
    await page.getByRole('button', { name: 'Next Page' }).click();
    await expect(page.getByRole('spinbutton', { name: 'PDF page number' })).toHaveValue('2');
    await page.getByRole('searchbox', { name: 'Search PDF text' }).fill('Lookdev');
    await expect(page.getByText(/1 page match/)).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'PDF page number' })).toHaveValue('1');

    // 4. Open metrics.csv -> verify DataGrid sort, filter, range select stats footer, screenshot
    await selectDemoFile(page, 'data', /metrics\.csv/);
    const grid = page.getByRole('grid', { name: /metrics\.csv CSV Grid/ });
    await expect(grid).toBeVisible({ timeout: 10000 });
    await grid.getByText('render_time_ms').click();
    await grid.getByText('139.8').click();
    await grid.getByText('151.1').click({ modifiers: ['Shift'] });
    await expect(grid.getByText(/Sum:/)).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase5-csv-dark.png') });
    await grid.getByRole('searchbox', { name: 'Search grid rows' }).fill('warn');
    await expect(grid.getByText('139.8')).toHaveCount(0);

    // 5. Open pipeline_config.yaml -> verify Tree & Raw toggle
    await page.getByRole('treeitem', { name: /pipeline_config\.yaml/ }).click();
    await expect(page.getByRole('tree', { name: 'Structured data tree' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await expect(page.locator('pre.org-dataviewer__raw')).toContainText('engine: cycles');

    // 6. Gallery showcase screenshots (DataGrid + Charts + Telemetry)
    await page.goto('/gallery');
    await page.getByText('6. DataGrid (Virtualized Sort / Filter / Range Stats)').scrollIntoViewIfNeeded();
    await expect(page.getByRole('grid', { name: 'Gallery DataGrid' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Frame Render Time (ms)' })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase5-gallery-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase5-gallery-light.png') });

    expect(errors).toEqual([]);
  });
});
