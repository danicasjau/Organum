import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loginAs } from './helpers';

const SCREENSHOTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots',
);

test.describe('CR04 phase A admin polish', () => {
  test('roles: search, group, role column, differences-only and clear', async ({ page }) => {
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/users?section=roles' });
    const matrix = page.getByRole('table', { name: 'Role permissions matrix' });
    await expect(matrix).toBeVisible({ timeout: 10000 });
    const rowCount = () => matrix.locator('tbody tr').count();
    const total = await rowCount();
    expect(total).toBeGreaterThan(10);

    const search = page.getByLabel('Search permissions');
    await search.fill('gantt');
    await expect(matrix.locator('tbody tr')).toHaveCount(1);
    await expect(matrix.locator('tbody tr').first()).toContainText('views.gantt');

    await search.fill('');
    await page.getByRole('combobox', { name: 'Permission group' }).click();
    await page.getByRole('option', { name: 'views', exact: true }).click();
    const viewRows = await matrix.locator('tbody td.org-admin-matrix__perm').allTextContents();
    expect(viewRows.length).toBeGreaterThan(1);
    expect(viewRows.every((k) => k.startsWith('views.'))).toBe(true);

    // Focus one role: only that column remains.
    await page.getByRole('combobox', { name: 'Role column' }).click();
    await page.getByRole('option', { name: 'Artist', exact: true }).click();
    await expect(matrix.locator('thead th')).toHaveCount(2);
    await expect(matrix.locator('thead th').nth(1)).toHaveText('Artist');

    await page.getByRole('checkbox', { name: 'Only differences from default' }).check();
    // Every remaining row carries the changed marker (text, not just colour).
    const marked = await matrix.locator('tbody td[data-changed="true"]').count();
    const rows = await matrix.locator('tbody tr').count();
    expect(marked === rows || (await matrix.getByText('No permissions match').count()) === 1).toBe(
      true,
    );

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(matrix.locator('tbody tr')).toHaveCount(total);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-roles-filter-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-roles-filter-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
  });

  test('rules: add, delete, reorder conditions and actions with inline validation', async ({
    page,
  }) => {
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/users?section=rules' });
    const rules = page.locator('[data-ui="admin-rules"]');
    await expect(rules).toBeVisible({ timeout: 10000 });
    await rules.getByRole('button', { name: '+ New Rule' }).click();
    await rules.getByLabel('Rule Name').fill('CR04 draft rule');
    const sentence = rules.locator('[data-ui="rule-sentence"]');

    // Add a second condition, fill both, then move the second one up by keyboard.
    await rules.getByLabel('Condition 1 value').fill('shot');
    await rules.getByRole('button', { name: '+ Condition' }).click();
    await rules.getByLabel('Condition 2 value').fill('hero_x');
    await rules.getByRole('button', { name: /^Reorder condition 2/ }).press('ArrowUp');
    await expect(rules.getByLabel('Condition 1 value')).toHaveValue('hero_x');
    await expect(rules.getByLabel('Condition 2 value')).toHaveValue('shot');

    // Inline validation: invalid regex shows a message.
    await rules.getByRole('combobox', { name: 'Condition 1 operator' }).click();
    await page.getByRole('option', { name: 'matches (regex)' }).click();
    await rules.getByLabel('Condition 1 value').fill('(');
    await expect(rules.getByText('Invalid regular expression')).toBeVisible();
    await rules.getByLabel('Condition 1 value').fill('^hero');
    await expect(rules.getByText('Invalid regular expression')).toHaveCount(0);

    // Subgroups can be added and deleted; deleting its last leaf removes the group.
    await rules.getByRole('button', { name: '+ Subgroup' }).click();
    await expect(
      rules.getByRole('button', { name: 'Remove subgroup 3', exact: true }),
    ).toBeVisible();
    await rules.getByRole('button', { name: 'Remove subgroup 3 condition 1' }).click();
    await expect(rules.getByRole('button', { name: 'Remove subgroup 3', exact: true })).toHaveCount(
      0,
    );

    // Every condition can be deleted: the rule then applies always.
    await rules.getByRole('button', { name: 'Remove condition 2' }).click();
    await rules.getByRole('button', { name: 'Remove condition 1' }).click();
    await expect(rules.locator('[data-ui="rule-no-conditions"]')).toBeVisible();
    await expect(sentence).toContainText(/always|every/i);

    // Actions: add a second, reorder by drag on the grip, delete all -> inline error.
    await rules.getByRole('button', { name: '+ Action' }).click();
    const actions = rules.getByRole('list', { name: 'Actions' });
    await expect(actions.getByRole('listitem')).toHaveCount(2);
    await rules.getByRole('combobox', { name: 'Action 2 type' }).click();
    await page.getByRole('option', { name: 'Add tag' }).click();
    await actions
      .getByRole('button', { name: /^Reorder action 2/ })
      .dragTo(actions.getByRole('listitem').first(), { targetPosition: { x: 40, y: 2 } });
    await expect(rules.getByRole('combobox', { name: 'Action 1 type' })).toContainText('Add tag');
    await expect(rules.getByText('Tag name is required')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-rules-editor-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-rules-editor-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    await rules.getByRole('button', { name: 'Remove action 2' }).click();
    await rules.getByRole('button', { name: 'Remove action 1' }).click();
    await expect(
      rules.getByRole('alert').filter({ hasText: 'Add at least one action' }),
    ).toBeVisible();
  });
});
