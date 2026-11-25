import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, logoutViaMenu } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/phase7e');

test.describe('Phase 7E — Admin Console Rules Engine, Raw DB Viewer, Templates & Security', () => {
  test('verifies Rules editor (preview + apply), Default Tasks, Dep Templates, DB viewer redaction, SQL console guard, Audit, and Producer/Client boundaries', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      const text = msg.text();
      // Expected 400 when probing forbidden SQL (DELETE FROM users)
      if (msg.type() === 'error' && !text.includes('status of 400')) {
        errors.push(text);
      }
    });

    // 1. Admin (qa_admin) opens /admin -> default Roles & Permissions stays active
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/admin' });
    await expect(page.getByRole('table', { name: 'Role permissions matrix' })).toBeVisible({
      timeout: 10000,
    });

    // 2. Default Tasks & Dependency Templates sections
    await page.getByRole('button', { name: 'Default Tasks', exact: true }).click();
    await expect(page.locator('[data-ui="admin-default-tasks"]')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Department default tasks' })).toBeVisible();

    await page.getByRole('button', { name: 'Dependency Templates', exact: true }).click();
    await expect(page.locator('[data-ui="admin-dep-templates"]')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Dependency templates' })).toBeVisible();

    // 3. Rules Editor: create rule, verify live sentence, Preview matches, Save, Apply
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const rulesView = page.locator('[data-ui="admin-rules"]');
    await expect(rulesView).toBeVisible();

    await rulesView.getByRole('button', { name: '+ New Rule' }).click();
    await rulesView.getByLabel('Rule Name').fill('High priority shots');
    await rulesView.getByLabel('Condition 1 value').fill('shot');
    await expect(rulesView.locator('[data-ui="rule-sentence"]')).toContainText(
      'entity.type = shot',
    );
    await rulesView.getByRole('button', { name: 'Preview matches' }).click();
    await expect(rulesView.getByRole('table', { name: 'Rule preview matches' })).toBeVisible({
      timeout: 10000,
    });

    await rulesView.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Saved rule "High priority shots".')).toBeVisible({
      timeout: 10000,
    });

    await rulesView.getByRole('button', { name: 'Apply to existing tasks' }).click();
    await expect(page.getByText(/Applied rule:/)).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'rules_dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'rules_light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // 4. Enable SQL Console in Project Settings (verify Working Days & Link Depth too)
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await expect(page.getByText('Working Days')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Link Dependency Depth' })).toBeVisible();
    const sqlCheckbox = page.getByLabel('Enable read-only admin SQL console');
    if (!(await sqlCheckbox.isChecked())) {
      await sqlCheckbox.click();
    }
    await page.getByRole('button', { name: 'Save Project Settings' }).click();
    await expect(page.getByText('Saved project settings.')).toBeVisible({ timeout: 10000 });

    // 5. Raw Read-Only Database Viewer & SQL Console
    await page.getByRole('button', { name: 'Database', exact: true }).click();
    const dbView = page.locator('[data-ui="admin-database"]');
    await expect(dbView).toBeVisible();
    await dbView.getByRole('button', { name: /^users\b/ }).click();
    const usersTable = dbView.getByRole('table', { name: 'Table users' });
    await expect(usersTable).toBeVisible({ timeout: 10000 });
    await expect(usersTable.getByText('[REDACTED]').first()).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'database_dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'database_light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // SQL Console: run safe SELECT and reject DELETE
    await dbView.getByRole('tab', { name: 'SQL Console' }).click();
    await dbView.getByLabel('Read-only SQL query').fill('SELECT username FROM users ORDER BY username ASC');
    await dbView.getByRole('button', { name: 'Run SELECT' }).click();
    await expect(dbView.getByRole('table', { name: 'SQL query results' })).toContainText('qa_admin', {
      timeout: 10000,
    });

    await dbView.getByLabel('Read-only SQL query').fill('DELETE FROM users');
    await dbView.getByRole('button', { name: 'Run SELECT' }).click();
    await expect(dbView.getByText(/Only read-only SELECT queries are permitted/i)).toBeVisible({
      timeout: 10000,
    });

    // 6. Audit Log shows rule & db inspection entries
    await page.getByRole('button', { name: 'Audit Log', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'admin.db.query' }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('cell', { name: 'rule.created' }).first()).toBeVisible();

    // Restore SQL console disabled by default
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByLabel('Enable read-only admin SQL console').click();
    await page.getByRole('button', { name: 'Save Project Settings' }).click();
    await expect(page.getByText('Saved project settings.')).toBeVisible({ timeout: 10000 });

    // 7. Producer (prod_maya): can open /admin -> Rules, CANNOT see Roles or Database
    await logoutViaMenu(page);
    await loginAs(page, 'prod_maya', 'DemoPass123!', { targetPath: '/admin' });
    await expect(page.locator('[data-ui="admin-rules"]')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Database', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Roles & Permissions', exact: true }),
    ).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
