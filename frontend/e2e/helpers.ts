import { expect, type Page } from '@playwright/test';

export async function loginAs(
  page: Page,
  username: string,
  password: string,
  opts?: { targetPath?: string; projectName?: string },
): Promise<void> {
  const dest = opts?.targetPath ?? '/entities';
  await page.goto(dest);
  await page.locator('[data-ui="login-page"], [data-ui="app-shell"]').waitFor({
    state: 'visible',
    timeout: 15000,
  });
  if (page.url().includes('/login')) {
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });
    if (opts?.projectName) {
      await page.getByRole('combobox', { name: 'Project' }).click();
      await page.getByRole('option', { name: opts.projectName }).click();
    }
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.locator('[data-ui="app-shell"]').waitFor({ state: 'visible', timeout: 15000 });
  }
  if (opts?.targetPath && !page.url().includes(opts.targetPath)) {
    await page.goto(opts.targetPath);
    await page.locator('[data-ui="app-shell"]').waitFor({ state: 'visible', timeout: 15000 });
  }
}

export async function logoutViaMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
}

export async function ensureHeroRobotSelected(page: Page): Promise<void> {
  const heroOpt = page.getByRole('option', { name: /hero_robot/ });
  await expect(heroOpt).toBeVisible({ timeout: 10000 });
  const isSel = await heroOpt.getAttribute('aria-selected');
  if (isSel !== 'true') {
    await heroOpt.click();
  }
}

export async function selectTask(page: Page, taskName: string): Promise<void> {
  await ensureHeroRobotSelected(page);
  const tree = page.getByRole('tree', { name: 'Entity departments and tasks' });
  await expect(tree).toBeVisible();
  const taskItem = tree.getByRole('treeitem', { name: new RegExp(`^${taskName}\\b`) });
  await expect(taskItem).toBeVisible();
  await taskItem.click();
}

export async function selectDemoFile(
  page: Page,
  taskName: string,
  filePattern: RegExp,
): Promise<void> {
  await selectTask(page, taskName);
  const products = page.getByRole('tree', { name: 'Task product versions' });
  const fileItem = products.getByRole('treeitem', { name: filePattern }).first();
  await expect(fileItem).toBeVisible({ timeout: 10000 });
  await fileItem.click();
}

