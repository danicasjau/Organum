import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, logoutViaMenu } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/phase7d');

test.describe('Phase 7D — Gantt, Workload Heatmap & Dual-Mode Dependency/Entity Graph', () => {
  test('verifies Producer Gantt/Workload/Graph workflows, Director read-only, and Client exclusion', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const errors: string[] = [];
    const forbiddenUrls: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('response', (resp) => {
      if (resp.status() === 403) forbiddenUrls.push(`${resp.status()} ${resp.url()}`);
    });

    // 1. Producer (prod_maya) -> /tasks
    await loginAs(page, 'prod_maya', 'DemoPass123!', { targetPath: '/tasks' });
    await expect(page.getByRole('tab', { name: 'Gantt' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Workload' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Graph' })).toBeVisible();

    // --- Gantt View ---
    await page.getByRole('tab', { name: 'Gantt' }).click();
    const gantt = page.locator('[data-ui="gantt-view"]');
    await expect(gantt).toBeVisible();
    await expect(gantt.getByRole('button', { name: 'Links' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(gantt.locator('[data-gantt-bar]').first()).toBeVisible({ timeout: 10000 });

    // Switch grouping modes: Department -> User -> Entity path
    await gantt.getByRole('combobox', { name: 'Gantt group by' }).click();
    await page.getByRole('option', { name: 'Department' }).click();
    await expect(gantt.locator('[data-group-key^="dept:"]').first()).toBeVisible();

    await gantt.getByRole('combobox', { name: 'Gantt group by' }).click();
    await page.getByRole('option', { name: 'User' }).click();
    await expect(gantt.locator('[data-group-key^="user:"]').first()).toBeVisible();

    await gantt.getByRole('combobox', { name: 'Gantt group by' }).click();
    await page.getByRole('option', { name: 'Entity path' }).click();
    await expect(gantt.locator('[data-group-key^="entity:"]').first()).toBeVisible();

    // Zoom Day / Week / Month
    await gantt.getByRole('button', { name: 'Week', exact: true }).click();
    await gantt.getByRole('button', { name: 'Day', exact: true }).click();

    // Drag first editable task bar right by +56px (2 days) and verify Undo reverts
    const firstBar = gantt.locator('.org-gantt__bar.is-editable').first();
    await expect(firstBar).toBeVisible();
    const origTitle = await firstBar.getAttribute('title');
    const box = await firstBar.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 56, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
    }
    await expect(gantt.getByRole('button', { name: 'Undo (1)' })).toBeEnabled({ timeout: 10000 });
    await gantt.getByRole('button', { name: 'Undo (1)' }).click();
    await expect(gantt.getByRole('button', { name: 'Redo (1)' })).toBeEnabled({ timeout: 10000 });
    await expect(firstBar).toHaveAttribute('title', origTitle ?? /.*/);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'gantt_dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'gantt_light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // --- Workload View ---
    await page.getByRole('tab', { name: 'Workload' }).click();
    const workload = page.locator('[data-ui="workload-view"]');
    await expect(workload).toBeVisible();
    await expect(workload.getByLabel('Utilization legend')).toBeVisible();
    await expect(workload.locator('.org-workload__cell-btn').first()).toBeVisible({
      timeout: 10000,
    });

    // Click first populated % cell -> Contributing tasks drawer opens
    const populatedCell = workload.locator('.org-workload__cell-btn', { hasText: /%$/ }).first();
    if ((await populatedCell.count()) > 0) {
      await populatedCell.click();
      await expect(
        workload.getByRole('complementary', { name: 'Contributing tasks' }),
      ).toBeVisible();
      await workload.getByRole('button', { name: 'Close contributing tasks' }).click();
    }

    // Expand Unscheduled tasks row
    await workload.getByRole('button', { name: /Unscheduled tasks/i }).click();

    // Toggle Weeks vs Days
    await workload.getByRole('button', { name: 'Weeks', exact: true }).click();
    await expect(workload.locator('th.org-workload__th-day.is-week').first()).toBeVisible();
    await workload.getByRole('button', { name: 'Days', exact: true }).click();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workload_dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workload_light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // --- Dual-Mode Graph View ---
    await page.getByRole('tab', { name: 'Graph' }).click();
    const graph = page.locator('[data-ui="graph-view"]');
    await expect(graph).toBeVisible();
    await expect(graph.locator('[data-graph-node]').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'graph_task_dark.png') });

    // Switch to Entity Mode -> glasses -> hero_robot -> sh010 + indirect path
    await graph.getByRole('button', { name: 'Entity Mode' }).click();
    await expect(graph.locator('[data-graph-node]', { hasText: 'hero_robot' })).toBeVisible({
      timeout: 10000,
    });
    await expect(graph.locator('[data-graph-node]', { hasText: 'glasses' })).toBeVisible();
    await expect(graph.locator('[data-graph-node]', { hasText: 'sh010' })).toBeVisible();
    await expect(graph.getByText('via hero_robot')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'graph_entity_dark.png') });

    // Double-click hero_robot entity node -> jumps to Task Mode scoped to hero_robot
    await graph.locator('[data-graph-node]', { hasText: 'hero_robot' }).dblclick();
    await expect(graph.getByRole('combobox', { name: 'Task graph scope' })).toBeVisible();
    await expect(graph.locator('[data-graph-node]', { hasText: /hero_robot_/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // 2. Director (dir_alex): all planning views visible, zero 403s, task bars without supervisor cap are read-only
    await logoutViaMenu(page);
    await loginAs(page, 'dir_alex', 'DemoPass123!', { targetPath: '/tasks' });
    await page.getByRole('tab', { name: 'Gantt' }).click();
    await expect(page.locator('[data-ui="gantt-view"]')).toBeVisible();
    const dirModBar = page
      .locator('[data-gantt-bar]')
      .filter({ hasText: 'hero_robot_MOD_main' })
      .first();
    await expect(dirModBar).toBeVisible({ timeout: 10000 });
    await expect(dirModBar).not.toHaveClass(/is-editable/);

    await page.getByRole('tab', { name: 'Workload' }).click();
    await expect(page.locator('[data-ui="workload-view"]')).toBeVisible();
    await page.getByRole('tab', { name: 'Graph' }).click();
    await expect(page.locator('[data-ui="graph-view"]')).toBeVisible();

    // 3. Client (cli_jordan): Gantt, Workload, Graph excluded completely, zero 403s
    await logoutViaMenu(page);
    await loginAs(page, 'cli_jordan', 'DemoPass123!', { targetPath: '/tasks' });
    await expect(page.getByRole('tab', { name: 'Grid' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Gantt' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Workload' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Graph' })).toHaveCount(0);

    expect(forbiddenUrls).toEqual([]);
    expect(errors).toEqual([]);
  });
});

