import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { EMPTY_ROOT } from './bootstrapRoot';

// Runs only through playwright.bootstrap.config.ts (fresh, empty data root).
const SCREENSHOTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/screenshots',
);
const NEW_PASSWORD = 'FreshPass1234!';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('[data-ui="app-shell"]')).toBeVisible({ timeout: 15000 });
}

test('fresh empty root: create project before sign-in, then sign in as admin', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  const form = page.locator('[data-ui="bootstrap-create-project"]');
  await expect(form).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-bootstrap-dark.png') });

  await form.getByPlaceholder('My Show').fill('Fresh Show');
  await form.getByPlaceholder(/MyShow/).fill(path.join(EMPTY_ROOT, 'FreshShow'));
  await form.getByRole('button', { name: 'Create Project' }).click();

  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Project' })).toContainText('Fresh Show');
  await expect(page.getByLabel('Username')).toHaveValue('admin');
  await page.getByLabel('Password').fill('magicadmin**');
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Seeded admin must change the initial password first.
  await expect(page.getByText('Password Change Required')).toBeVisible();
  await page.getByLabel('Current Password').fill('magicadmin**');
  await page.getByLabel('New Password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm New Password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Set Password' }).click();
  await expect(page.getByText('Password Change Required')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('[data-ui="app-shell"]')).toBeVisible();
});

test('settings > departments: inline add, rename, code, drag reorder, delete + restore', async ({
  page,
}) => {
  await signIn(page, NEW_PASSWORD);
  await page.goto('/settings?section=departments');
  const editor = page.locator('[data-ui="departments-settings"]');
  await expect(editor).toBeVisible();
  // No Up/Dn buttons any more.
  await expect(editor.getByRole('button', { name: /^(Up|Dn)$/ })).toHaveCount(0);

  const list = editor.getByRole('list', { name: 'Departments' });
  const names = () =>
    list.locator('.org-depts__name').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  await expect(list.getByRole('listitem')).toHaveCount(7);

  // Inline add (Enter).
  await editor.getByLabel('New department name').fill('Grooming');
  await editor.getByLabel('New department name').press('Enter');
  await expect(list.getByRole('listitem')).toHaveCount(8);

  // Inline rename.
  await list.getByRole('button', { name: /^Grooming name:/ }).click();
  await list.getByLabel('Grooming name').fill('Groom FX');
  await list.getByLabel('Grooming name').press('Enter');
  await expect(list.getByRole('button', { name: /^Groom FX name:/ })).toBeVisible();

  // Short code validation: duplicate is refused inline, valid one saves.
  await list.getByRole('button', { name: /^Groom FX short code:/ }).click();
  const code = list.getByLabel('Groom FX short code');
  await code.fill('MOD');
  await code.press('Enter');
  await expect(list.getByRole('alert')).toContainText('already used');
  await code.fill('GRM');
  await code.press('Enter');
  await expect(list.getByRole('button', { name: /^Groom FX short code: GRM/ })).toBeVisible();

  // Drag the last department onto the top of the first one.
  const rows = list.getByRole('listitem');
  await rows
    .last()
    .getByRole('button', { name: /^Reorder / })
    .dragTo(rows.first(), { targetPosition: { x: 40, y: 2 } });
  await expect.poll(names).toEqual(expect.arrayContaining(['Groom FX']));
  await expect.poll(async () => (await names())[0]).toBe('Groom FX');
  // Persisted server-side.
  await page.reload();
  await expect.poll(async () => (await names())[0]).toBe('Groom FX');

  // Keyboard reorder on the grip.
  await list.getByRole('button', { name: /^Reorder Groom FX/ }).press('ArrowDown');
  await expect.poll(async () => (await names())[1]).toBe('Groom FX');

  // Default tasks: add, then reorder by keyboard.
  await list
    .locator('[data-sortable-id]', { hasText: 'Groom FX' })
    .getByText(/\d+ tasks?/)
    .click();
  const taskInput = editor.getByLabel('New default task name');
  await taskInput.fill('blocking');
  await taskInput.press('Enter');
  await taskInput.fill('final');
  await taskInput.press('Enter');
  const taskList = editor.getByRole('list', { name: 'Default tasks of Groom FX' });
  // New departments start with the seeded "main" task.
  await expect(taskList.getByRole('listitem')).toHaveCount(3);
  await taskList.getByRole('button', { name: /^Reorder final/ }).press('ArrowUp');
  await expect(taskList.getByRole('listitem').nth(1)).toContainText('final');
  await expect(taskList.getByRole('listitem').nth(2)).toContainText('blocking');

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-settings-departments-dark.png') });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'cr04-settings-departments-light.png'),
  });
  await page.getByRole('button', { name: 'Toggle theme' }).click();

  // Delete asks for confirmation, archives, and can be restored.
  await list.getByRole('button', { name: 'Delete Groom FX' }).click();
  const confirm = page.getByRole('dialog', { name: /Delete department "Groom FX"/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  const row = list.locator('[data-sortable-id]', { hasText: 'Groom FX' });
  await expect(row).toContainText('Archived');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(row).not.toContainText('Archived');

  // Search filters and disables reordering.
  await editor.getByLabel('Search departments').fill('light');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('button', { name: /^Reorder Lighting/ })).toBeDisabled();
});

/** Page-context API call (session cookie + CSRF), used only for test setup. */
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

function isoPlus(base: Date, days: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days));
  return d.toISOString().slice(0, 10);
}

test('gantt: draft edits, collision push, selection, milestones, versions', async ({ page }) => {
  await signIn(page, NEW_PASSWORD);
  const depts = (await api(page, 'GET', '/departments')).body as { id: string; name: string }[];
  const mod = depts.find((d) => d.name === 'Modeling')!;
  for (const name of ['gA', 'gB', 'gC', 'gD']) {
    const r = await api(page, 'POST', '/entities', { name, department_ids: [mod.id] });
    expect(r.status).toBe(201);
  }
  const tree = (await api(page, 'GET', '/entities')).body as {
    entities: { name: string; departments: { tasks: { id: string }[] }[] }[];
  };
  const ids = ['gA', 'gB', 'gC', 'gD'].map(
    (name) => tree.entities.find((e) => e.name === name)!.departments[0]!.tasks[0]!.id,
  );
  const [a, b, c, d] = ids as [string, string, string, string];
  // Next-next Monday: A Mon-Tue, B Wed-Thu, C Fri; D unrelated Mon-Wed.
  const now = new Date();
  const monday = isoPlus(now, ((8 - now.getUTCDay()) % 7) + 7);
  const m = new Date(`${monday}T00:00:00Z`);
  const plan: [string, number, number][] = [
    [a, 0, 1],
    [b, 2, 3],
    [c, 4, 4],
    [d, 0, 2],
  ];
  for (const [id, s, f] of plan) {
    await api(page, 'PATCH', `/tasks/${id}`, {
      ideal_start_date: isoPlus(m, s),
      ideal_finish_date: isoPlus(m, f),
    });
  }
  await api(page, 'PUT', `/tasks/${b}/dependencies`, { dependencies: [{ upstream_task_id: a }] });
  await api(page, 'PUT', `/tasks/${c}/dependencies`, { dependencies: [{ upstream_task_id: b }] });

  await page.goto('/tasks');
  await page.getByRole('tab', { name: 'Gantt' }).click();
  const gantt = page.locator('[data-ui="gantt-view"]');
  const bar = (id: string) => gantt.locator(`[data-gantt-bar="${id}"]`);
  await expect(bar(a)).toBeVisible({ timeout: 10000 });
  const draftBar = gantt.locator('[data-ui="draft-bar-gantt"]');
  await expect(draftBar).toContainText('No draft changes');

  // Selection: A solid yellow, chain B and C linked (dashed); D untouched; status colours kept.
  await bar(a).click();
  await expect(bar(a)).toHaveAttribute('data-selected', 'true');
  await expect(bar(b)).toHaveAttribute('data-linked', 'true');
  await expect(bar(c)).toHaveAttribute('data-linked', 'true');
  await expect(bar(d)).not.toHaveAttribute('data-linked', 'true');
  for (const id of ids) await expect(bar(id)).toHaveClass(/org-gantt__bar--rdy/);
  await expect(gantt.locator('.is-dimmed')).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-gantt-selection-dark.png') });
  await page.keyboard.press('Escape');
  await expect(bar(a)).not.toHaveAttribute('data-selected', 'true');
  await expect(bar(b)).not.toHaveAttribute('data-linked', 'true');
  // Clicking empty space in a row also unselects.
  await bar(a).click();
  await gantt.locator(`[data-task-row-id="${d}"]`).click({ position: { x: 3, y: 3 } });
  await expect(bar(a)).not.toHaveAttribute('data-selected', 'true');

  // Collision push: drag A two days right; B is pushed live, C not (starts when B ends).
  await gantt.getByRole('button', { name: 'Push dependents' }).click();
  const dayPx = Number(
    ((await gantt.locator('.org-gantt__zoom-val').textContent()) ?? '28').replace(/\D/g, ''),
  );
  const boxA = (await bar(a).boundingBox())!;
  await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxA.x + boxA.width / 2 + dayPx * 2, boxA.y + boxA.height / 2, {
    steps: 8,
  });
  await expect(bar(b)).toHaveAttribute('data-pushed', 'true');
  await expect(bar(c)).not.toHaveAttribute('data-pushed', 'true');
  await page.mouse.up();
  await expect(draftBar).toContainText('DRAFT: 2 changes');
  await expect(bar(a)).toHaveAttribute('data-draft', 'true');
  await expect(bar(b)).toHaveAttribute('data-draft', 'true');
  // Live data untouched.
  const liveA = (await api(page, 'GET', `/tasks/${a}`)).body as { ideal_start_date: string };
  expect(liveA.ideal_start_date).toBe(isoPlus(m, 0));

  // Unresolvable: C cannot move before B finishes -> refused, draft unchanged.
  const boxC = (await bar(c).boundingBox())!;
  await page.mouse.move(boxC.x + boxC.width / 2, boxC.y + boxC.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxC.x + boxC.width / 2 - dayPx * 3, boxC.y + boxC.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.getByText(/Move refused: .*cannot start before upstream/)).toBeVisible();
  await expect(draftBar).toContainText('DRAFT: 2 changes');

  // Deliver date (yellow rhombus) into the draft.
  await gantt.getByRole('button', { name: '+ Milestone' }).click();
  const form = page.locator('[data-ui="milestone-form"]');
  await form.getByLabel('Milestone name').fill('Edit lock');
  await form.getByRole('combobox', { name: 'Milestone kind' }).click();
  await page.getByRole('option', { name: 'Deliver date (final)' }).click();
  await form.getByRole('button', { name: 'Add to draft' }).click();
  const diamond = gantt.locator('[data-ui="milestone-marker"]').filter({ hasText: 'Edit lock' });
  await expect(diamond).toHaveAttribute('data-draft', 'true');
  await expect(diamond).toHaveAttribute('data-kind', 'deliver');
  await expect(draftBar).toContainText('DRAFT: 3 changes');

  // The draft list shows every change with a revert button.
  await draftBar.getByRole('button', { name: 'Review changes' }).click();
  const list = page.getByRole('list', { name: 'Draft changes' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.keyboard.press('Escape');

  // Save as S0001 (comment required, differences listed).
  await draftBar.getByRole('button', { name: 'Save as new version…' }).click();
  const saveDlg = page.locator('[data-ui="schedule-save-dialog"]');
  await expect(saveDlg.getByRole('table', { name: 'Schedule differences' })).toBeVisible();
  await expect(saveDlg.getByRole('button', { name: 'Apply & save version' })).toBeDisabled();
  await saveDlg.getByLabel('Version comment').fill('Shift A, add edit lock');
  await saveDlg.getByRole('button', { name: 'Apply & save version' }).click();
  await expect(page.getByText('Saved schedule version S0001')).toBeVisible();
  await expect(draftBar).toContainText('No draft changes');
  const liveA2 = (await api(page, 'GET', `/tasks/${a}`)).body as { ideal_start_date: string };
  expect(liveA2.ideal_start_date).toBe(isoPlus(m, 2));

  // Second version, then jump back to S0001 and save it as S0003.
  const boxD = (await bar(d).boundingBox())!;
  await page.mouse.move(boxD.x + boxD.width / 2, boxD.y + boxD.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxD.x + boxD.width / 2 + dayPx, boxD.y + boxD.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(draftBar).toContainText('DRAFT: 1 change');
  await draftBar.getByRole('button', { name: 'Save as new version…' }).click();
  await saveDlg.getByLabel('Version comment').fill('Nudge D');
  await saveDlg.getByRole('button', { name: 'Apply & save version' }).click();
  await expect(page.getByText('Saved schedule version S0002')).toBeVisible();

  await gantt.getByRole('button', { name: 'Versions' }).click();
  const panel = gantt.locator('[data-ui="versions-panel-gantt"]');
  const s1 = panel.getByRole('listitem').filter({ hasText: 'S0001' });
  await expect(panel.getByRole('listitem').filter({ hasText: 'S0002' })).toContainText('current');
  await s1.getByRole('button', { name: 'Star S0001 as baseline' }).click();
  await expect(s1).toContainText('baseline');
  await s1.getByRole('button', { name: 'Jump to this version' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load as draft' }).click();
  await expect(draftBar).toContainText('DRAFT: 1 change');
  await expect(bar(d)).toHaveAttribute('data-draft', 'true');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-gantt-versions-dark.png') });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'cr04-gantt-versions-light.png') });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await draftBar.getByRole('button', { name: 'Save as new version…' }).click();
  await saveDlg.getByLabel('Version comment').fill('Back to S0001');
  await saveDlg.getByRole('button', { name: 'Apply & save version' }).click();
  await expect(page.getByText('Saved schedule version S0003')).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: 'S0003' })).toContainText('current');
  const liveD = (await api(page, 'GET', `/tasks/${d}`)).body as { ideal_start_date: string };
  expect(liveD.ideal_start_date).toBe(isoPlus(m, 0));
});
