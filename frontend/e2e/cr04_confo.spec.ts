import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { loginAs, logoutViaMenu } from './helpers';

const SCREENSHOTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots',
);

/** Call the API from the page (session cookie + CSRF header), for setup and cleanup only. */
async function api(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ([m, u, b]) => {
      const proj = localStorage.getItem('organum.activeProjectUuid');
      const csrf = document.cookie
        .split('; ')
        .find((c) => c.startsWith('organum_csrf='))
        ?.split('=')[1];
      const r = await fetch(`/api/v1/projects/${proj}${u}`, {
        method: m as string,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}),
        },
        body: b ? JSON.stringify(b) : undefined,
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
    },
    [method, url, body] as const,
  );
}

/** Remove every e2e_ column (active or deleted) and e2e saved views. */
async function cleanup(page: Page) {
  const grid = await api(page, 'GET', '/confo');
  const trash = await api(page, 'GET', '/confo/columns/trash');
  const cols = [
    ...((grid.body?.columns ?? []) as { id: string; key: string }[]),
    ...((trash.body ?? []) as { id: string; key: string }[]),
  ];
  for (const c of cols.filter((x) => x.key.startsWith('e2e_'))) {
    await api(page, 'DELETE', `/confo/columns/${c.id}`);
    await api(page, 'DELETE', `/confo/columns/${c.id}/purge`);
  }
  const views = await api(page, 'GET', '/saved-views?view_kind=confo');
  for (const v of (views.body ?? []) as { id: string; name: string }[]) {
    if (v.name.startsWith('E2E')) await api(page, 'DELETE', `/saved-views/${v.id}`);
  }
}

const cell = (page: Page, entity: string, colKey: string) =>
  page
    .locator('[data-ui="confo-view"] [role="row"]', { hasText: entity })
    .first()
    .locator(`[data-col="${colKey}"]`);

test.describe('CR04 §3 Confo', () => {
  test('columns, typed editing, errors, undo, paste, import, export, saved view', async ({
    page,
  }) => {
    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/tasks' });
    await cleanup(page);
    try {
      await page.getByRole('tab', { name: 'Confo' }).click();
      const view = page.locator('[data-ui="confo-view"]');
      await expect(view).toBeVisible();
      await expect(view.getByRole('rowheader', { name: /props \(2\)/ })).toBeVisible();

      // Create a select and an integer column from the UI.
      await view.getByRole('button', { name: 'New column' }).click();
      let form = page.locator('[data-ui="confo-column-form"]');
      await form.getByLabel('Column label').fill('E2E Camera');
      await expect(form.getByLabel('Column key')).toHaveValue('e2e_camera');
      await form.getByRole('combobox', { name: 'Column type' }).click();
      await page.getByRole('option', { name: 'Single select' }).click();
      await form.getByLabel('Column options').fill('static, pan, dolly');
      await form.getByRole('button', { name: 'Create column' }).click();
      await expect(form).toHaveCount(0);

      await view.getByRole('button', { name: 'New column' }).click();
      form = page.locator('[data-ui="confo-column-form"]');
      await form.getByLabel('Column label').fill('E2E Frames');
      await form.getByRole('combobox', { name: 'Column type' }).click();
      await page.getByRole('option', { name: 'Integer' }).click();
      await form.getByLabel('Minimum').fill('1');
      await form.getByRole('button', { name: 'Create column' }).click();
      await expect(view.getByRole('columnheader', { name: 'E2E Frames' })).toBeVisible();

      // Typed edit: integer.
      await cell(page, 'hero_robot', 'e2e_frames').dblclick();
      await page.getByLabel('Edit E2E Frames').fill('120');
      await page.getByLabel('Edit E2E Frames').press('Enter');
      await expect(cell(page, 'hero_robot', 'e2e_frames')).toHaveText('120');

      // Select editor.
      await cell(page, 'hero_robot', 'e2e_camera').dblclick();
      await page.getByLabel('Choose value').selectOption('pan');
      await expect(cell(page, 'hero_robot', 'e2e_camera')).toHaveText('pan');

      // Invalid value: per-cell error, nothing saved.
      await cell(page, 'glasses', 'e2e_frames').dblclick();
      await page.getByLabel('Edit E2E Frames').fill('abc');
      await page.getByLabel('Edit E2E Frames').press('Enter');
      const bad = cell(page, 'glasses', 'e2e_frames');
      await expect(bad).toHaveAttribute('aria-invalid', 'true');
      await expect(bad).toHaveAttribute('title', /whole number/);
      await expect(view.getByText(/1 invalid/)).toBeVisible();

      // Undo the camera edit.
      await view.getByRole('button', { name: 'Undo' }).click();
      await expect(cell(page, 'hero_robot', 'e2e_camera')).toHaveText('');
      await view.getByRole('button', { name: 'Redo' }).click();
      await expect(cell(page, 'hero_robot', 'e2e_camera')).toHaveText('pan');

      // Paste a column block (Excel style) from glasses: groups sort by label (props first),
      // so the next row is hover_drone. Fixing the invalid cell clears its error.
      await cell(page, 'glasses', 'e2e_frames').click();
      await page.locator('[aria-label="Confo entity data"]').evaluate((el) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', '10\n20\n');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      });
      await expect(cell(page, 'glasses', 'e2e_frames')).toHaveText('10');
      await expect(cell(page, 'hover_drone', 'e2e_frames')).toHaveText('20');
      await expect(bad).not.toHaveAttribute('aria-invalid', 'true');

      // CSV import with automatic path matching, preview, error report, then a clean commit.
      await view.getByRole('button', { name: 'Import CSV' }).click();
      const imp = page.locator('[data-ui="confo-import"]');
      await imp.getByLabel('CSV file').setInputFiles({
        name: 'confo.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'path;E2E Camera;E2E Frames\nshots/sh010;dolly;48\nprops/glasses;crane;5\nnowhere;pan;1\n',
        ),
      });
      const summary = imp.locator('[data-ui="confo-import-summary"]');
      await expect(summary).toContainText('Matched: 2');
      await expect(summary).toContainText('Unmatched: 1');
      await expect(summary).toContainText('Errors: 2');
      await expect(imp.getByRole('button', { name: 'Import' })).toBeDisabled();
      const [report] = await Promise.all([
        page.waitForEvent('download'),
        imp.getByRole('button', { name: 'Download error report' }).click(),
      ]);
      const reportText = readFileSync(await report.path(), 'utf8');
      expect(reportText).toContain('is not an option');
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-confo-import-dark.png') });

      await imp.getByLabel('CSV file').setInputFiles({
        name: 'confo-fixed.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'path,E2E Camera,E2E Frames\nshots/sh010,dolly,48\nprops/glasses,static,5\n',
        ),
      });
      await expect(summary).toContainText('Errors: 0');
      await imp.getByRole('button', { name: 'Import' }).click();
      await expect(imp).toHaveCount(0);
      await expect(cell(page, 'sh010', 'e2e_camera')).toHaveText('dolly');
      await expect(cell(page, 'glasses', 'e2e_frames')).toHaveText('5');

      // Filter then export: only the filtered rows go into the CSV.
      await view.getByLabel('Search grid rows').fill('dolly');
      const [csv] = await Promise.all([
        page.waitForEvent('download'),
        view.getByRole('button', { name: 'Export CSV' }).click(),
      ]);
      const csvText = readFileSync(await csv.path(), 'utf8');
      expect(csvText).toContain('Entity,Path,Type,E2E Camera,E2E Frames');
      expect(csvText).toContain('sh010');
      expect(csvText).not.toContain('hero_robot');
      await view.getByLabel('Search grid rows').fill('');

      // Freeze + saved view.
      await view.getByRole('button', { name: /Frozen|Freeze/ }).click();
      await page.getByRole('button', { name: 'First 2' }).click();
      await view.getByRole('button', { name: 'Save view' }).click();
      await page.getByLabel('View name').fill('E2E frozen');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await view.getByRole('combobox', { name: 'Saved Confo views' }).click();
      await expect(page.getByRole('option', { name: 'E2E frozen' })).toBeVisible();
      await page.keyboard.press('Escape');

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-confo-dark.png') });
      await page.getByRole('button', { name: 'Toggle theme' }).click();
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-confo-light.png') });
      await page.getByRole('button', { name: 'Toggle theme' }).click();

      // Delete (soft) and restore a column from Manage columns.
      await view.getByRole('button', { name: 'Manage columns' }).click();
      const manage = page.locator('[data-ui="confo-manage"]');
      await manage.getByRole('button', { name: 'Delete column E2E Camera' }).click();
      await page
        .getByRole('dialog', { name: /Delete column "E2E Camera"/ })
        .getByRole('button', { name: 'Delete' })
        .click();
      const trash = manage.getByRole('list', { name: 'Deleted columns' });
      await expect(trash).toContainText('E2E Camera');
      await trash.getByRole('button', { name: 'Restore' }).click();
      await page.keyboard.press('Escape');
      await expect(cell(page, 'sh010', 'e2e_camera')).toHaveText('dolly');
    } finally {
      await cleanup(page);
    }
  });

  test('artist sees a read-only Confo, client has no Confo', async ({ page }) => {
    await loginAs(page, 'art_sam', 'DemoPass123!', { targetPath: '/tasks' });
    await page.getByRole('tab', { name: 'Confo' }).click();
    const view = page.locator('[data-ui="confo-view"]');
    await expect(view.getByText('Read-only')).toBeVisible();
    await expect(view.getByRole('button', { name: 'Import CSV' })).toHaveCount(0);
    await expect(view.getByRole('button', { name: 'Manage columns' })).toHaveCount(0);
    await logoutViaMenu(page);

    await loginAs(page, 'cli_jordan', 'DemoPass123!', { targetPath: '/tasks' });
    await expect(page.getByRole('tab', { name: 'Grid' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Confo' })).toHaveCount(0);
    const res = await api(page, 'GET', '/confo');
    expect(res.status).toBe(403);
  });
});
