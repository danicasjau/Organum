import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, selectTask } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');
const DEMO_PROD_DIR = path.resolve(__dirname, '../../data/demo_project/01_Production');

test.describe('Phase 6B Entities Browser, Scenefiles, Publishing & Entity Tab', () => {
  test('navigates 3-column Entities dock, toggles Browse/Review & Ctrl+E, creates entity, manages entity data & publishes version', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/entities' });
    await expect(page.getByRole('option', { name: /hero_robot/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tree', { name: 'Entity departments and tasks' })).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Task product versions' })).toBeVisible();

    // Select Modeling/main to display rich scenefiles + 3D/model products
    await selectTask(page, 'main');
    await expect(page.getByText('robot_v001.hip')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-ui="scene-file-icon"][data-family="houdini"]').first()).toBeVisible();

    // Capture Dark & Light Browse 36/44/20 screenshots
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6b-entities-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6b-entities-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // Verify Entity tab in Inspector (edit typed entity_data & save)
    await page.getByRole('tab', { name: 'Entity' }).click();
    await expect(page.getByText('polycount (int)')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6b-entity-tab-dark.png') });

    await page.getByLabel('New data key').fill('lod_levels');
    await page.getByLabel('New data value').fill('3');
    await page.getByRole('button', { name: 'Add Row' }).click();
    await expect(page.getByText('lod_levels (str)')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Delete lod_levels' }).click();
    await expect(page.getByText('lod_levels (str)')).toHaveCount(0);

    // Toggle Ctrl+E maximize over workspace
    await page.locator('[data-ui="entities-dock"]').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('Control+e');
    await expect(page.locator('.org-viewer-layout')).toHaveAttribute('data-maximized', 'true');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase6b-entities-max-dark.png') });
    await page.keyboard.press('Control+e');
    await expect(page.locator('.org-viewer-layout')).not.toHaveAttribute('data-maximized', 'true');

    // Toggle Review preset (collapses cols 2-3) and back to Browse
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByRole('tree', { name: 'Entity departments and tasks' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(page.getByRole('tree', { name: 'Entity departments and tasks' })).toBeVisible();

    // Create a brand new entity via UI, verify disk .entity.json & dirs, then trash it
    await page.getByRole('button', { name: 'Entity', exact: true }).click();
    await page.getByLabel('Entity name').fill('Test Mech');
    await expect(page.getByText('Test_Mech')).toBeVisible();
    await page.getByLabel('Entity type').fill('Vehicle');
    await page.getByLabel('Add entity tag').fill('test');
    await page.getByLabel('Add entity tag').press('Enter');
    await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('option', { name: /Test_Mech/ })).toBeVisible({ timeout: 10000 });
    const createdDir = path.join(DEMO_PROD_DIR, 'Test_Mech');
    expect(fs.existsSync(path.join(createdDir, '.entity.json'))).toBe(true);

    // Right-click Test_Mech -> Delete to trash
    await page.getByRole('option', { name: /Test_Mech/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete Entity...' }).click();
    await page.getByRole('button', { name: 'Move to Trash' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByRole('option', { name: /Test_Mech/ })).toHaveCount(0, { timeout: 5000 });
    await expect.poll(() => fs.existsSync(createdDir)).toBe(false);

    // Publish scenefile concept_ref.png on hero_robot/Modeling/main -> verify v0002, star as MASTER, check master.json, then restore & trash
    await selectTask(page, 'main');
    await page.getByText('concept_ref.png').click();
    await page.getByRole('button', { name: /Publish \(1\)/ }).click();
    await page.getByLabel('Publish comment').fill('Concept publish test');
    await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('v0002', { exact: true })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Star v0002 as MASTER' }).click();
    const masterPath = path.join(DEMO_PROD_DIR, 'hero_robot', 'Modeling', 'main', 'products', 'master.json');
    await expect
      .poll(() => JSON.parse(fs.readFileSync(masterPath, 'utf-8')).version as string)
      .toBe('v0002');

    // Restore v0001 as MASTER and delete temporary v0002
    await page.getByRole('button', { name: 'Star v0001 as MASTER' }).click();
    await expect
      .poll(() => JSON.parse(fs.readFileSync(masterPath, 'utf-8')).version as string)
      .toBe('v0001');
    await page.getByText('v0002', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete Version...' }).click();
    await page.getByRole('button', { name: 'Move to Trash' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('v0002', { exact: true })).toHaveCount(0, { timeout: 5000 });

    expect(errors).toEqual([]);
  });
});

