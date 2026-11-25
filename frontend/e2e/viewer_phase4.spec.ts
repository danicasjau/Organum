import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAs, selectDemoFile } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

test.describe('Phase 4 Time-Based Media (Video, Sequences, Audio, EDL)', () => {
  test('plays/steps video & audio strip, scopes frame-range annotations, renders waveform/spectrogram, sequences, and EDL', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await loginAs(page, 'qa_admin', 'DemoPass123!', { targetPath: '/viewer' });

    // 1. Open turntable.mp4 -> verify proxy decode, AudioWaveformStrip, Timebar, TransportControls
    await selectDemoFile(page, 'turntable', /turntable\.mp4/);
    await expect(page.locator('[data-ui="video-viewer"]')).toBeVisible();
    await expect(page.locator('[data-ui="audio-waveform-strip"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-ui="timebar"]')).toBeVisible();
    await expect(page.locator('[data-ui="transport-controls"]')).toBeVisible();
    await expect(page.locator('.org-videoview__overlay')).toHaveCount(0, { timeout: 10000 });

    // Clean any leftover video annotations
    const annTab = page.getByRole('tab', { name: /Annotations \(\d+\)/ });
    const tabTxt = await annTab.textContent();
    if (tabTxt && !tabTxt.includes('(0)')) {
      await annTab.click();
      while ((await page.getByRole('button', { name: 'Delete annotation' }).count()) > 0) {
        await page.getByRole('button', { name: 'Delete annotation' }).first().click();
        await page.waitForTimeout(150);
      }
      await expect(page.getByRole('tab', { name: 'Annotations (0)' })).toBeVisible({ timeout: 5000 });
      await page.getByRole('tab', { name: 'Structure & Info' }).click();
    }

    // Step forward/back frame check
    const frameField = page.getByRole('spinbutton', { name: 'Current frame' });
    await expect(frameField).toHaveValue('0');
    await page.getByRole('button', { name: 'Step forward' }).click();
    await expect(frameField).toHaveValue('1');
    await page.getByRole('button', { name: 'Step forward' }).click();
    await expect(frameField).toHaveValue('2');
    await page.getByRole('button', { name: 'Step back' }).click();
    await expect(frameField).toHaveValue('1');

    // Configure Range scope (frames 1..4) and draw a scoped 2D stroke on video frame 1
    await page.getByRole('button', { name: 'Annotation frame scope' }).click();
    await page.getByRole('radio', { name: 'Range' }).click();
    const inField = page.getByRole('spinbutton', { name: 'Annotation frame in' });
    const outField = page.getByRole('spinbutton', { name: 'Annotation frame out' });
    await inField.dblclick();
    await inField.fill('1');
    await inField.press('Enter');
    await outField.dblclick();
    await outField.fill('4');
    await outField.press('Enter');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Free Draw' }).click();
    const svg = page.locator('[data-ui="annotation-layer-2d"]');
    const box = await svg.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 140, box!.y + 120);
    await page.mouse.down();
    await page.mouse.move(box!.x + 220, box!.y + 160, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('tab', { name: 'Annotations (1)' })).toBeVisible();

    // Capture Dark & Light Video screenshots
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase4-video-dark.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase4-video-light.png') });
    await page.getByRole('button', { name: 'Toggle theme' }).click();

    // Verify Timebar marker jump and cleanup
    await page.getByRole('tab', { name: 'Annotations (1)' }).click();
    await expect(page.getByText('F1–4')).toBeVisible();
    await page.getByRole('button', { name: 'Delete annotation' }).click();
    await expect(page.getByRole('tab', { name: 'Annotations (0)' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('tab', { name: 'Structure & Info' }).click();

    // 2. Open turntable.####.png image sequence and step F1 -> F2
    await selectDemoFile(page, 'beauty', /turntable\.####\.png/);
    await expect(page.locator('[data-ui="video-viewer"]')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Current frame' })).toHaveValue('1');
    await page.getByRole('button', { name: 'Step forward' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Current frame' })).toHaveValue('2');

    // 3. Open sfx.wav audio viewer -> waveform + spectrogram + annotation
    await selectDemoFile(page, 'audio', /sfx\.wav/);
    await expect(page.locator('[data-ui="audio-viewer"]')).toBeVisible();
    await expect(page.getByText(/48000 Hz · 2ch/)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Spectrogram' }).click();
    await expect(page.getByRole('button', { name: 'Spectrogram' })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase4-audio-dark.png') });
    await page.getByRole('button', { name: 'Spectrogram' }).click();

    // 4. Open edit.edl timeline viewer -> verify tracks, clips, and seek
    await selectDemoFile(page, 'edit', /edit\.edl/);
    await expect(page.locator('[data-ui="timeline-viewer"]')).toBeVisible();
    await expect(page.locator('.org-timelineview__clip', { hasText: 'turntable.mp4' })).toBeVisible();
    await expect(page.locator('.org-timelineview__clip', { hasText: 'beauty.png' })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'phase4-timeline-dark.png') });

    expect(errors).toEqual([]);
  });
});

