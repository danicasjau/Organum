import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs } from './helpers';

/**
 * CR04 §2: every floating UI type opened from inside a dialog and inside the right dock
 * must render above its container and accept a click (Playwright's click fails when the
 * target is covered by another element, so a successful click proves the stacking).
 */

async function assertOnTop(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const hit = await target.evaluate(
    (el, pt) => {
      const top = document.elementFromPoint(pt.x, pt.y);
      return top !== null && (el === top || el.contains(top));
    },
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
  expect(hit, 'floating element must be the topmost element at its centre').toBe(true);
}

for (const scope of ['dialog', 'dock'] as const) {
  test.describe(`floating UI inside ${scope}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/gallery/layering');
      await expect(page.locator('[data-ui="layering-fixture"]')).toBeVisible();
      if (scope === 'dialog') {
        await page.getByRole('button', { name: 'Open layering dialog' }).click();
        await expect(page.getByRole('dialog', { name: 'Layering dialog' })).toBeVisible();
      }
    });

    const state = (page: Page) => page.locator(`[data-ui="layering-state-${scope}"]`);

    test('select / combobox', async ({ page }) => {
      await page.getByRole('combobox', { name: `${scope} department` }).click();
      const opt = page.getByRole('option', { name: 'FX' });
      await assertOnTop(opt);
      await opt.click();
      await expect(state(page)).toContainText('dept=fx;');
    });

    test('date picker', async ({ page }) => {
      await page.getByRole('button', { name: `${scope} date` }).click();
      const day = page.getByRole('gridcell').filter({ hasText: /^15$/ }).first();
      await assertOnTop(day);
      await day.click();
      await expect(state(page)).toContainText(/date=\d{4}-\d{2}-15;/);
    });

    test('color picker popover', async ({ page }) => {
      await page.getByRole('button', { name: `${scope} color` }).click();
      const swatch = page
        .getByRole('group', { name: 'Token color palette' })
        .getByRole('button')
        .nth(1);
      await assertOnTop(swatch);
      await swatch.click();
      await expect(state(page)).not.toContainText('color=#808080;');
    });

    test('user picker', async ({ page }) => {
      await page.getByRole('button', { name: `${scope} users` }).click();
      const row = page.getByRole('option', { name: /Leo Lead/ });
      await assertOnTop(row);
      await row.click();
      await expect(state(page)).toContainText('users=u2;');
    });

    test('dropdown menu', async ({ page }) => {
      await page.getByRole('button', { name: `${scope} Menu` }).click();
      const item = page.getByRole('menuitem', { name: `${scope} menu item` });
      await assertOnTop(item);
      await item.click();
      await expect(state(page)).toContainText('menu=menu;');
    });

    test('context menu', async ({ page }) => {
      await page.locator(`[data-ui="layering-ctx-${scope}"]`).click({ button: 'right' });
      const item = page.getByRole('menuitem', { name: `${scope} context item` });
      await assertOnTop(item);
      await item.click();
      await expect(state(page)).toContainText('menu=ctx;');
    });

    test('generic popover', async ({ page }) => {
      await page.getByRole('button', { name: `${scope} popover`, exact: true }).click();
      const action = page.getByRole('button', { name: `${scope} popover action` });
      await assertOnTop(action);
      await action.click();
      await expect(state(page)).toContainText('popover=picked');
    });

    test('tooltip', async ({ page }) => {
      await page.getByRole('button', { name: `${scope} hover me` }).hover();
      const tip = page.getByRole('tooltip').filter({ hasText: `${scope} tooltip text` });
      await expect(tip).toBeVisible({ timeout: 5000 });
      // Radix renders a visible bubble plus an a11y copy: check the visible bubble.
      await assertOnTop(page.locator('.org-tooltip').filter({ hasText: `${scope} tooltip text` }));
    });
  });
}

test('real app: entity "Add Department" dialog list sits above the dialog', async ({ page }) => {
  await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/entities' });
  const entity = page.getByRole('option', { name: /hero_robot/ });
  await expect(entity).toBeVisible({ timeout: 10000 });
  await entity.click({ button: 'right' });
  const addItem = page.getByRole('menuitem', { name: 'Add Department...' });
  await assertOnTop(addItem);
  await addItem.click();
  const dialog = page.getByRole('dialog', { name: /Add Department to/ });
  await expect(dialog).toBeVisible();
  const combo = dialog.getByRole('combobox', { name: 'Department from catalog' });
  test.skip((await combo.count()) === 0, 'demo entity already has every department');
  await combo.click();
  const last = page.getByRole('listbox').getByRole('option').last();
  await assertOnTop(last);
  const label = (await last.textContent())?.trim() ?? '';
  await last.click();
  await expect(combo).toContainText(label);
  await dialog.getByRole('button', { name: 'Cancel' }).click(); // leave demo data untouched
});
