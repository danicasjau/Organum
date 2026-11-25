import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, selectDemoFile, selectTask } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

test.describe('Phase 2 /viewer Vertical Slice', () => {
  test('loads products, switches EXR AOVs & PSD layers, saves annotations, ignores laser, captures dark/light screenshots', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/viewer' });
    await expect(page.getByText('ORGANUM', { exact: true })).toBeVisible();
    await selectTask(page, 'beauty');
    const prodTree = page.getByRole('tree', { name: 'Task product versions' });
    await expect(prodTree.getByRole('treeitem', { name: /beauty\.png/ }).first()).toBeVisible();
    await expect(prodTree.getByRole('treeitem', { name: /beauty_aovs\.exr/ }).first()).toBeVisible();
    await expect(prodTree.getByRole('treeitem', { name: /concept_layers\.psd/ }).first()).toBeVisible();

    // Verify no A/B or N control exists in viewer topbar
    const topbar = page.getByRole('toolbar', { name: 'Viewer controls' });
    await expect(topbar).toBeVisible();
    await expect(topbar.getByText('A/B')).toHaveCount(0);

    // 1. Open beauty_aovs.exr, verify Structure & Info merged tab (AOVs top + File Info bottom)
    await selectDemoFile(page, 'beauty', /beauty_aovs\.exr/);
    await page.getByRole('tab', { name: 'Structure & Info' }).click();
    await expect(page.getByText('depth.Z')).toBeVisible();
    await expect(page.getByText('File Info')).toBeVisible();
    await page.getByRole('button', { name: /depth\.Z/ }).click();

    // 2. Adjust exposure & zoom on EXR + check NumberField fill, switch to PSD & back -> state restored
    const evInput = page.getByRole('spinbutton', { name: 'Exposure stops' });
    await evInput.dblclick();
    await evInput.fill('1.5');
    await evInput.press('Enter');
    await expect(evInput).toHaveValue('1.50');
    const evFill = page.locator('.org-vtopbar__num .org-numfield__fill').first();
    await expect(evFill).toHaveJSProperty('style.length', 1);

    // 2b. Test View Background popover (Default -> Gradient -> Default)
    await page.getByRole('button', { name: 'View settings' }).click();
    await page.getByRole('combobox', { name: 'Viewport background' }).click();
    await page.getByRole('option', { name: 'Gradient' }).click();
    await expect(page.locator('[data-ui="image-viewer-2d"]')).toHaveAttribute('data-bg', 'gradient');
    await page.getByRole('combobox', { name: 'Viewport background' }).click();
    await page.getByRole('option', { name: 'Default' }).click();
    await page.keyboard.press('Escape');

    await page.getByRole('treeitem', { name: /concept_layers\.psd/ }).click();
    await expect(page.getByText('RimAccent')).toBeVisible();
    await page.getByText('RimAccent').click(); // isolate layer

    await page.getByRole('treeitem', { name: /beauty_aovs\.exr/ }).click();
    await expect(evInput).toHaveValue('1.50');

    // 3. Draw a 2D vector stroke on beauty.png, verify Saved, reload and assert persistence
    await page.getByRole('treeitem', { name: /beauty\.png/ }).click();
    // Ensure clean slate if a previous aborted run left an annotation
    const existingAnnTab = page.getByRole('tab', { name: /Annotations \(\d+\)/ });
    const tabLabel = await existingAnnTab.textContent();
    if (tabLabel && !tabLabel.includes('(0)')) {
      await existingAnnTab.click();
      while ((await page.getByRole('button', { name: 'Delete annotation' }).count()) > 0) {
        await page.getByRole('button', { name: 'Delete annotation' }).first().click();
        await page.waitForTimeout(150);
      }
      await expect(page.getByRole('tab', { name: 'Annotations (0)' })).toBeVisible({ timeout: 5000 });
      await page.getByRole('tab', { name: 'Structure & Info' }).click();
    }

    await page.getByRole('button', { name: 'Free Draw' }).click();
    const svg = page.locator('[data-ui="annotation-layer-2d"]');
    const box = await svg.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 120, box!.y + 120);
    await page.mouse.down();
    await page.mouse.move(box!.x + 180, box!.y + 160);
    await page.mouse.move(box!.x + 220, box!.y + 130);
    await page.mouse.up();

    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5000 });

    // 4. Draw Laser stroke and verify saved annotation count stays 1
    await page.getByRole('button', { name: 'Laser Pointer (ephemeral)' }).click();
    await page.mouse.move(box!.x + 100, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 160, box!.y + 220);
    await page.mouse.up();
    await expect(page.getByRole('tab', { name: 'Annotations (1)' })).toBeVisible();

    // Reload page and confirm annotation persisted
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Annotations (1)' })).toBeVisible({ timeout: 5000 });

    // Capture Dark screenshot
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase2-viewer-dark.png') });

    // Switch to Light theme and capture Light screenshot
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase2-viewer-light.png') });

    // Clean up test annotations & test Enter-to-submit annotation history
    await page.getByRole('tab', { name: 'Annotations (1)' }).click();
    const noteBox = page.getByRole('textbox', { name: 'Review annotation note' });
    await noteBox.fill('Second note submitted with Enter');
    await noteBox.press('Enter');
    await expect(page.getByRole('tab', { name: 'Annotations (2)' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Second note submitted with Enter')).toBeVisible();

    while ((await page.getByRole('button', { name: 'Delete annotation' }).count()) > 0) {
      await page.getByRole('button', { name: 'Delete annotation' }).first().click();
      await page.waitForTimeout(150);
    }
    await expect(page.getByRole('tab', { name: 'Annotations (0)' })).toBeVisible({ timeout: 5000 });

    expect(errors).toEqual([]);
  });
});

