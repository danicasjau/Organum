import { expect, type Page } from '@playwright/test';

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

