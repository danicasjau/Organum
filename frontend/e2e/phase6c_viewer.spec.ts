import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, selectDemoFile } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

test.describe('Phase 6C Viewer — Two-Row Topbar, Tool Wells, LayerStrip & UDIM Mosaic', () => {
  test('verifies two-row topbar, grouped toolstrip, LayerStrip EXR/PSD/UDIM & UV annotations', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/entities' });

    // 1. Inspect two-row topbar + 8 tool wells, select beauty_aovs.exr in Browse mode first
    const topbar = page.getByRole('toolbar', { name: 'Viewer controls' });
    await expect(topbar.locator('[data-row="a"]')).toBeVisible();
    await expect(topbar.locator('[data-row="b"]')).toBeVisible();

    const wells = page.locator('[data-ui="tool-strip"] .org-toolwell');
    await expect(wells).toHaveCount(8);

    await selectDemoFile(page, 'beauty', /beauty_aovs\.exr/);

    // Switch to Review preset (60% center) so all wide Row B Ev/G/Sat/Hue controls & LayerStrip fit cleanly
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(topbar.getByRole('spinbutton', { name: 'Exposure stops' })).toBeVisible();
    await expect(topbar.getByRole('spinbutton', { name: 'Hue rotation' })).toBeVisible();

    const layerStrip = page.locator('[data-ui="layer-strip"]');
    await expect(layerStrip).toBeVisible({ timeout: 10000 });
    await expect(layerStrip.getByText(/AOVs \(4\)/).first()).toBeVisible({ timeout: 10000 });
    await expect(layerStrip.getByRole('button', { name: /depth\.Z/ })).toBeVisible({ timeout: 10000 });

    // False color toggle works in Row A
    await topbar.getByRole('button', { name: 'False color' }).click();
    await expect(topbar.getByRole('button', { name: 'False color' })).toHaveAttribute('aria-pressed', 'true');
    await topbar.getByRole('button', { name: 'False color' }).click();

    // Right inspector shows "See layer strip" link cleanly
    await page.getByRole('tab', { name: 'Structure & Info' }).click();
    await expect(page.getByRole('button', { name: /See layer strip/ })).toBeVisible();

    // Keyboard ']' steps to next AOV
    await page.keyboard.press(']');

    // Capture EXR LayerStrip Dark & Light screenshots
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6c-layerstrip-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6c-layerstrip-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // 2. Switch back to Browse to pick PSD & verify eye-toggle visibility in LayerStrip
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await selectDemoFile(page, 'beauty', /concept_layers\.psd/);
    await expect(layerStrip.getByText(/PSD Layers \(3\)/).first()).toBeVisible({ timeout: 10000 });
    await expect(layerStrip.getByRole('button', { name: 'Toggle visibility for RimAccent' })).toBeVisible({
      timeout: 10000,
    });
    await layerStrip.getByRole('button', { name: 'Toggle visibility for RimAccent' }).click();

    // 3. Open UDIM texture set under Lookdev/textures, then switch to Review for wide mosaic & controls
    await selectDemoFile(page, 'textures', /robot_albedo\.####\.png/);
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    const udimView = page.locator('[data-ui="udim-mosaic-viewer"]');
    await expect(udimView).toBeVisible({ timeout: 10000 });
    await expect(layerStrip.getByText(/UDIM Tiles \(3\)/).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-ui="udim-override-control"]')).toContainText(/UDIM \((auto|override)\)/);

    // Clean any existing annotations on the UDIM file before drawing
    const annTab = page.getByRole('tab', { name: /Annotations \(\d+\)/ });
    const tabTxt = await annTab.textContent();
    if (tabTxt && !tabTxt.includes('(0)')) {
      await annTab.click();
      while ((await page.getByRole('button', { name: 'Delete annotation' }).count()) > 0) {
        await page.getByRole('button', { name: 'Delete annotation' }).first().click();
        await page.waitForTimeout(150);
      }
      await page.getByRole('tab', { name: 'Structure & Info' }).click();
    }

    // Draw UV annotation across UDIM tiles and verify coord_space="uv"
    await page.getByRole('button', { name: 'Free Draw' }).click();
    const uvLayer = page.locator('[data-ui="annotation-layer-2d"]');
    await expect(uvLayer).toHaveAttribute('data-coord-space', 'uv');
    await page.waitForTimeout(200);
    const box = await uvLayer.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.42, box!.y + box!.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.56, box!.y + box!.height * 0.58, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByRole('tab', { name: 'Annotations (1)' })).toBeVisible({ timeout: 5000 });

    // Capture UDIM Mosaic Dark & Light screenshots
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6c-udim-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6c-udim-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // Test Treat as frames override & restore Treat as UDIM + reset auto flag cleanly
    await page.getByRole('button', { name: 'Treat as frames' }).click();
    await expect(page.locator('[data-ui="video-viewer"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-ui="udim-override-control"]')).toContainText(/Frames \(override\)/);
    await page.getByRole('button', { name: 'Treat as UDIM' }).click();
    await expect(udimView).toBeVisible({ timeout: 10000 });
    await page.evaluate(async () => {
      const fid = new URL(window.location.href).searchParams.get('file');
      const pid = localStorage.getItem('organum.activeProjectUuid');
      const csrfMatch = document.cookie.match(/(?:^|; )organum_csrf=([^;]+)/);
      const csrf = csrfMatch?.[1] ? decodeURIComponent(csrfMatch[1]) : '';
      if (fid && pid) {
        await fetch(`/api/v1/projects/${pid}/files/${fid}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify({ sequence_kind: 'udim', sequence_kind_user_override: false }),
        });
      }
    });

    // Clean up test annotation
    await page.getByRole('tab', { name: 'Annotations (1)' }).click();
    await page.getByRole('button', { name: 'Delete annotation' }).first().click();
    await expect(page.getByRole('tab', { name: 'Annotations (0)' })).toBeVisible({ timeout: 5000 });

    // Return to default Browse preset for clean persistence
    await page.getByRole('button', { name: 'Browse', exact: true }).click();

    expect(errors).toEqual([]);
  });
});
