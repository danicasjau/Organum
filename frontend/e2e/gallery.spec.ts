import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

test.describe('Phase 1 Widget Gallery', () => {
  test('renders dark, light, and redline modes with zero errors and interactive numeric ops', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/gallery');
    await expect(page.getByText('ORGANUM', { exact: true })).toBeVisible();
    await expect(page.getByText('1. Design Tokens — 60-30-10 Palette & Surfaces')).toBeVisible();
    await expect(page.getByText('2. Complete Component State Matrix (7 States)')).toBeVisible();

    // Verify dark theme default
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'phase1-gallery-dark.png'),
    });

    // Test interactive NumberField math expression in PropertyEditor
    const samplesInput = page.getByRole('spinbutton', { name: 'Samples' });
    await samplesInput.dblclick();
    await samplesInput.fill('8 * 8');
    await samplesInput.press('Enter');
    await expect(samplesInput).toHaveValue('64');

    // Switch to light theme and capture screenshot
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'phase1-gallery-light.png'),
    });

    // Switch back to dark and toggle Redline overlay
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.getByRole('button', { name: 'Redline' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-redline', 'true');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'phase1-gallery-redline.png'),
    });

    expect(errors).toEqual([]);
  });
});

