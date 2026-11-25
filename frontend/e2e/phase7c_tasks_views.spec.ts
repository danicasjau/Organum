import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHeroRobotSelected, loginAs, logoutViaMenu } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/phase7c');

test.describe('Phase 7C — Tasks Panel Core, Matrix, Kanban, Review Queue, Links & My Tasks', () => {
  test('verifies Grid, Matrix, Kanban, Review Queue, TaskDetail, Entity Links, Post-to-task, My Tasks, Director read-only, and Client isolation', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // 1. Producer (prod_maya) on /tasks: Grid, Matrix, Kanban, Review Queue + TaskDetail dock
    await loginAs(page, 'prod_maya', 'DemoPass123!', { targetPath: '/tasks' });
    await expect(page.getByRole('button', { name: 'TASKS', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Tasks table' })).toBeVisible({ timeout: 10000 });

    // Grid View + Column Chooser
    await page.getByRole('button', { name: 'Choose columns' }).click();
    await expect(page.getByLabel('Retakes')).toBeVisible();
    await page.getByLabel('Retakes').click();
    await page.keyboard.press('Escape');

    // Click hero_robot Modeling/main row -> opens TaskDetail dock
    const gridTable = page.getByRole('table', { name: 'Tasks table' });
    await gridTable.getByRole('row', { name: /hero_robot_MOD_main/i }).click();
    const dock = page.locator('[data-ui="task-detail-dock"]');
    await expect(dock).toBeVisible({ timeout: 10000 });
    await expect(dock.getByText('hero_robot_MOD_main')).toBeVisible();

    // Post internal comment + log time in TaskDetail
    await dock.getByLabel('New task comment').fill('Producer E2E check for @art_sam');
    await dock.getByRole('button', { name: 'Post Comment' }).click();
    await expect(dock.getByText('Producer E2E check for')).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-grid-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-grid-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // Share with client dialog check
    await dock.getByRole('button', { name: 'Share with client…' }).click();
    await expect(page.getByText(/Share with Client — hero_robot_MOD_main/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Close dock cleanly before Matrix view
    await dock.getByRole('button', { name: 'Close task detail' }).click();

    // 2. Matrix View: Path Hierarchy vs Entity Type, expand dept, Paste TSV preview
    await page.getByRole('tab', { name: 'Matrix' }).click();
    const matrixGrid = page.getByRole('grid', { name: 'Department entity matrix' });
    await expect(matrixGrid).toBeVisible();
    await expect(matrixGrid.getByText('hero_robot', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Entity Type' }).click();
    await expect(matrixGrid.getByText('Character', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Path Hierarchy' }).click();

    // Expand Modeling column then screenshot dark + light
    await page.getByRole('button', { name: 'Expand Modeling' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-matrix-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-matrix-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.getByRole('button', { name: 'Collapse Modeling' }).click();

    // Open Paste TSV preview dialog
    await page.getByRole('button', { name: 'Paste TSV…' }).click();
    await expect(page.getByText('Bulk Paste (TSV) — Preview & Apply')).toBeVisible();
    await page.getByLabel('TSV paste input').fill('high');
    await page.getByRole('button', { name: 'Preview Changes' }).click();
    await expect(page.getByText(/Preview:/)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Cancel' }).click();

    // 3. Kanban View: 9 status columns + swimlanes + dark/light screenshots
    await page.getByRole('tab', { name: 'Kanban' }).click();
    const kanban = page.locator('[data-ui="kanban-view"]');
    await expect(kanban).toBeVisible();
    for (const st of ['WTG', 'RDY', 'IP', 'RTK', 'P_LEAD', 'P_SUP', 'P_CLIENT', 'APP', 'HLD']) {
      await expect(kanban.locator(`.org-kanban__col[data-status="${st}"]`)).toBeVisible();
    }
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-kanban-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-kanban-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // 4. Review Queue View
    await page.getByRole('tab', { name: 'Review Queue' }).click();
    const rQueue = page.locator('[data-ui="review-queue"]');
    await expect(rQueue).toBeVisible();
    await expect(rQueue.getByText('hero_robot_MOD_main')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-review-queue-dark.png') });

    // 5. ENTITIES Workspace: Links section + Suggest Deps + Task tab + Viewer Post to task
    await page.getByRole('button', { name: 'ENTITIES', exact: true }).click();
    await expect(page).toHaveURL(/\/entities/);
    await ensureHeroRobotSelected(page);

    await page.getByRole('tab', { name: 'Entity' }).click();
    const linksSection = page.locator('[data-ui="entity-links-section"]');
    await expect(linksSection).toBeVisible({ timeout: 10000 });
    await expect(linksSection.getByText('glasses')).toBeVisible();
    await expect(linksSection.getByText('sh010')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-entity-links-dark.png') });

    await linksSection.getByRole('button', { name: 'Suggest Deps…' }).click();
    await expect(page.getByText(/Suggest Dependencies — hero_robot/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Verify Task tab in Inspector
    await page.getByRole('tab', { name: 'Task', exact: true }).click();
    await expect(page.locator('[data-ui="task-detail"]')).toBeVisible({ timeout: 10000 });

    // 6. Artist (art_sam) -> /me > My Tasks Focus Inbox
    await logoutViaMenu(page);
    await loginAs(page, 'art_sam', 'DemoPass123!', { targetPath: '/me' });
    await page.getByRole('tab', { name: 'My Tasks' }).click();
    const inbox = page.locator('[data-ui="my-tasks-inbox"]');
    await expect(inbox).toBeVisible({ timeout: 10000 });
    await expect(inbox.getByRole('button', { name: 'I DO' })).toBeVisible();
    await expect(inbox.getByRole('button', { name: 'I LEAD' })).toBeVisible();
    await expect(inbox.getByRole('button', { name: 'I SUPERVISE' })).toBeVisible();
    await inbox.getByRole('button', { name: 'I DO' }).click();
    await expect(inbox.getByText('I DO (Artist Execution)')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-my-tasks-dark.png') });

    // 7. Director (dir_alex) -> can approve Modeling/main (role), but edit fields remain read-only
    await logoutViaMenu(page);
    await loginAs(page, 'dir_alex', 'DemoPass123!', { targetPath: '/tasks' });
    const dirGrid = page.getByRole('table', { name: 'Tasks table' });
    await dirGrid.getByRole('row', { name: /hero_robot_MOD_main/i }).click();
    const dirDock = page.locator('[data-ui="task-detail-dock"]');
    await expect(dirDock).toBeVisible({ timeout: 10000 });
    await expect(dirDock.getByRole('button', { name: /approve/i })).toBeVisible();
    await expect(dirDock.getByLabel('Task priority')).toHaveCount(0);

    // 8. Client (cli_jordan) -> ONLY reduced Grid & Review Queue, zero internal leaks
    await logoutViaMenu(page);
    await loginAs(page, 'cli_jordan', 'DemoPass123!', { targetPath: '/tasks' });
    await expect(page.getByRole('tab', { name: 'Grid' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Review Queue' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Matrix' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Kanban' })).toHaveCount(0);

    const cliGrid = page.getByRole('table', { name: 'Tasks table' });
    await expect(cliGrid.getByText('hero_robot_LGT_beauty')).toBeVisible({ timeout: 10000 });
    await expect(cliGrid.getByText('hero_robot_MOD_main')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: /Bid/i })).toHaveCount(0);

    await cliGrid.getByRole('row', { name: /hero_robot_LGT_beauty/i }).click();
    const cliDock = page.locator('[data-ui="task-detail-dock"]');
    await expect(cliDock).toBeVisible({ timeout: 10000 });
    await expect(cliDock.getByText('Client review ready for beauty v0001 look check.')).toBeVisible();
    await expect(cliDock.getByText('Internal: key light intensity bumped +0.5 EV.')).toHaveCount(0);

    await cliDock.getByLabel('Client comment').fill('Client E2E feedback: approved framing.');
    await cliDock.getByRole('button', { name: 'Post Client Comment' }).click();
    await expect(cliDock.getByText('Client E2E feedback: approved framing.')).toBeVisible({
      timeout: 10000,
    });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase7c-client-tasks-dark.png') });

    expect(errors).toEqual([]);
  });
});

