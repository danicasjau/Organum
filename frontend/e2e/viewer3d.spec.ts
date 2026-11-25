import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, selectDemoFile, selectTask } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

test.describe('Phase 3 3D Viewer & Annotation Plane', () => {
  test('renders glTF/OBJ/USD, frames bbox, draws 3D plane strokes, orbits, freezes 2D, and inspects textures', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/viewer' });
    await selectTask(page, 'main');
    const prodTree = page.getByRole('tree', { name: 'Task product versions' });
    await expect(prodTree.getByRole('treeitem', { name: /robot\.gltf/ }).first()).toBeVisible();
    await expect(prodTree.getByRole('treeitem', { name: /robot\.usda/ }).first()).toBeVisible();

    // 1. Open robot.usda and verify non-zero mesh + USD prim graph & variant metadata
    await selectDemoFile(page, 'main', /robot\.usda/);
    await expect(page.locator('.org-vp3d__hud')).toContainText(/Tris: [1-9]\d*/);
    await expect(page.locator('[data-ui="viewport-3d"] .org-vp3d__status')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Structure & Info' }).click();
    await expect(page.getByRole('tree', { name: 'Scene hierarchy' })).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Scene hierarchy' }).getByText('Robot')).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Scene hierarchy' }).getByText('Body')).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Scene hierarchy' }).getByText('Head')).toBeVisible();
    await expect(page.getByText('USD Variant Sets')).toBeVisible();
    await expect(page.getByText('/Robot [look]')).toBeVisible();
    await expect(page.getByText('File Info')).toBeVisible();

    // 1b. Open robot.obj and verify non-zero mesh
    await page.getByRole('treeitem', { name: /robot\.obj/ }).first().click();
    await expect(page.locator('.org-vp3d__hud')).toContainText(/Tris: [1-9]\d*/);
    await expect(page.locator('[data-ui="viewport-3d"] .org-vp3d__status')).toHaveCount(0);

    // 2. Open robot.gltf (textured multi-part robot)
    await page.getByRole('treeitem', { name: /robot\.gltf/ }).click();
    await expect(page.locator('.org-vp3d__hud')).toContainText(/Tris: [1-9]\d*/);
    await expect(page.locator('.org-vp3d__hud')).toContainText(/Verts: [1-9]\d*/);
    await expect(page.locator('[data-ui="viewport-3d"] .org-vp3d__status')).toHaveCount(0);
    await page.waitForTimeout(300);

    // Clean any leftover annotations from prior aborted runs
    const annTab = page.getByRole('tab', { name: /Annotations \(\d+\)/ });
    const tabTxt = await annTab.textContent();
    if (tabTxt && !tabTxt.includes('(0)')) {
      await annTab.click();
      while ((await page.getByRole('button', { name: 'Delete annotation' }).count()) > 0) {
        await page.getByRole('button', { name: 'Delete annotation' }).first().click();
        await page.waitForTimeout(150);
      }
      await expect(page.getByRole('tab', { name: 'Annotations (0)' })).toBeVisible({ timeout: 5000 });
      await page.getByRole('tab', { name: 'Structure & Info' }).click();
    }

    // 3. Draw on 3D annotation plane
    await page.getByRole('button', { name: 'Free Draw' }).click();
    const vp = page.locator('[data-ui="viewport-3d"] .org-vp3d__canvas-wrap');
    const box = await vp.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.38, box!.y + box!.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.54, box!.y + box!.height * 0.36, { steps: 6 });
    await page.mouse.move(box!.x + box!.width * 0.60, box!.y + box!.height * 0.50, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('tab', { name: 'Annotations (1)' })).toBeVisible();

    // 4. Orbit viewport to inspect 3D ribbon stroke from an angle
    await page.getByRole('button', { name: 'Pan / Navigate' }).click();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5 + 32, box!.y + box!.height * 0.5 - 10, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase3-3d-dark.png') });

    // Light theme 3D screenshot
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase3-3d-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // 5. Instant Freeze Frame <-> Live 3D toggle
    await page.getByRole('button', { name: 'Freeze' }).click();
    await expect(page.getByText('FROZEN 2D')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Exposure stops' })).toBeEnabled();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase3-3d-frozen.png') });
    await page.getByRole('button', { name: 'Freeze' }).click();
    await expect(page.getByText('FROZEN 2D')).toHaveCount(0);

    // 6. Texture viewer + Back to 3D Scene
    await page.getByRole('tab', { name: 'Structure & Info' }).click();
    await page.getByRole('button', { name: /2D View/ }).first().click();
    await expect(page.getByRole('button', { name: 'Back to 3D Scene' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to 3D Scene' }).click();
    await expect(page.locator('.org-vp3d__hud')).toBeVisible();

    // 6b. Redrawing after perspective change automatically creates a new 2nd annotation
    await page.getByRole('button', { name: 'Free Draw' }).click();
    await page.mouse.move(box!.x + box!.width * 0.40, box!.y + box!.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.52, box!.y + box!.height * 0.55, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole('tab', { name: 'Annotations (2)' })).toBeVisible({ timeout: 5000 });

    // 7. Reload persistence & Jump Camera, then cleanup both annotations
    await page.reload();
    await selectDemoFile(page, 'main', /robot\.gltf/);
    await expect(page.getByRole('tab', { name: 'Annotations (2)' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('tab', { name: 'Annotations (2)' }).click();
    await expect(page.getByRole('button', { name: 'Jump' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Jump' }).first().click();

    while ((await page.getByRole('button', { name: 'Delete annotation' }).count()) > 0) {
      await page.getByRole('button', { name: 'Delete annotation' }).first().click();
      await page.waitForTimeout(150);
    }
    await expect(page.getByRole('tab', { name: 'Annotations (0)' })).toBeVisible({ timeout: 5000 });

    expect(errors).toEqual([]);
  });
});

