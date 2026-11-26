import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs } from './helpers';

const SCREENSHOTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots',
);

async function pickDay(page: Page, trigger: Locator, day: number) {
  await trigger.click();
  await page
    .getByRole('gridcell')
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first()
    .click();
}

test.describe('CR04 phase C — studios, working hours, activation periods', () => {
  test('companies master list + side panel: search, departments, comments, periods, links', async ({
    page,
  }) => {
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/users?section=companies' });
    const section = page.locator('[data-ui="companies-section"]');
    await expect(section).toBeVisible();
    const tree = section.getByRole('navigation', { name: 'Studios, clients and groups' });
    await expect(tree).toContainText('Studio Internal');

    // Search filters the hierarchy.
    await section.getByLabel('Search companies').fill('outsource');
    await expect(tree).toContainText('Outsource FX Co');
    await expect(tree).not.toContainText('Studio Internal');
    await section.getByLabel('Search companies').fill('');

    await tree.getByRole('button', { name: /^Studio Internal/ }).click();
    const panel = section.locator('[data-ui="company-panel"]');
    await expect(panel).toBeVisible();

    // Expand departments under a studio (dropdown-style hierarchy).
    const chev = tree.getByRole('button', { name: /Expand Studio Internal departments/ });
    if (await chev.isEnabled()) {
      await chev.click();
      await expect(tree.getByRole('button', { name: /Collapse Studio Internal/ })).toBeVisible();
    }

    // Dated comment with author, then delete it.
    await panel.getByLabel('New comment').fill('E2E: contract renewed until June');
    await panel.getByRole('button', { name: 'Add note' }).click();
    const comments = panel.getByRole('list', { name: 'Comments' });
    await expect(comments).toContainText('E2E: contract renewed until June');
    await expect(comments).toContainText('QA Administrator');

    // Activation period (date pickers), visible in the list, then removed.
    const periods = panel.locator('[data-ui="activation-periods-company"]');
    await pickDay(page, periods.getByRole('button', { name: 'New period start' }), 10);
    await pickDay(page, periods.getByRole('button', { name: 'New period end' }), 20);
    await periods.getByLabel('New period note').fill('E2E window');
    await periods.getByRole('button', { name: 'Add period' }).click();
    await expect(periods.getByRole('list', { name: 'Activation periods' })).toContainText(
      'E2E window',
    );

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-companies-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-companies-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    await periods.getByRole('button', { name: /^Delete period/ }).click();
    await expect(periods).toContainText('No periods: always active.');
    const row = comments.getByRole('listitem').filter({ hasText: 'E2E: contract renewed' });
    await row.getByRole('button', { name: 'Delete comment' }).click();
    await expect(comments).not.toContainText('E2E: contract renewed');
  });

  test('user editor: per-day working hours derive capacity; activation periods; /me edit', async ({
    page,
  }) => {
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/users' });
    await page.getByRole('listbox', { name: 'Users directory' }).getByText('art_sam').click();
    const hours = page.locator('[data-ui="work-hours-editor"]');
    await expect(hours).toBeVisible();
    // Start from the project default regardless of earlier runs.
    await hours.getByRole('button', { name: 'Reset to project default' }).click();
    await expect(page.getByText('Reset to project default hours').first()).toBeVisible();

    // Monday: split into two intervals, Friday a short day.
    await hours.getByLabel('Mon interval 1 end').fill('13:00');
    await hours.getByRole('button', { name: 'Add Mon interval' }).click();
    await hours.getByLabel('Mon interval 2 start').fill('14:00');
    await hours.getByLabel('Mon interval 2 end').fill('18:00');
    // Overlap is flagged inline and blocks saving.
    await hours.getByLabel('Tue interval 1 end').fill('08:00');
    await expect(hours.getByRole('alert').filter({ hasText: 'Start must be before end' })).toBeVisible();
    await expect(hours.getByRole('button', { name: 'Save working hours' })).toBeDisabled();
    await hours.getByLabel('Tue interval 1 end').fill('17:00');
    await hours.getByRole('button', { name: 'Remove Fri interval 1' }).click();
    await hours.getByRole('button', { name: 'Add exception' }).click();
    await hours.getByRole('button', { name: 'Save working hours' }).click();
    await expect(page.getByText('Working hours saved')).toBeVisible();
    // Mon 8 + Tue..Thu 8 = 32h/week over 4 days → 8h/day.
    await expect(hours).toContainText('32h / week');
    await expect(page.getByText('8h / day').first()).toBeVisible();

    const periods = page.locator('[data-ui="activation-periods-user"]');
    await pickDay(page, periods.getByRole('button', { name: 'New period start' }), 3);
    await pickDay(page, periods.getByRole('button', { name: 'New period end' }), 25);
    await periods.getByRole('button', { name: 'Add period' }).click();
    await expect(periods.getByRole('list', { name: 'Activation periods' })).toBeVisible();

    await page.locator('[data-ui="user-work-hours"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-user-hours-dark.png') });

    // Restore demo data.
    await periods.getByRole('button', { name: /^Delete period/ }).click();
    await hours.getByRole('button', { name: 'Reset to project default' }).click();
    await expect(hours).toContainText('project default');

    // /me: the signed-in user can edit their own hours.
    await page.goto('/me');
    const me = page.locator('[data-ui="me-col-profile"]');
    await expect(me.locator('[data-ui="work-hours-summary"]')).toContainText('Mon 09:00');
    await me.getByRole('button', { name: 'Edit my hours' }).click();
    await expect(me.locator('[data-ui="work-hours-editor"]')).toBeVisible();
  });
});
