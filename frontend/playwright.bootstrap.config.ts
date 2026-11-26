import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { EMPTY_ROOT } from './e2e/bootstrapRoot';

/**
 * CR04 §1: runs the app against a brand-new, empty root (no data/, no projects).
 * The folder is wiped every time this config loads, before the servers start.
 */
// Workers load this file too (TEST_WORKER_INDEX set); only the runner wipes, before servers start.
if (process.env.TEST_WORKER_INDEX === undefined) {
  rmSync(EMPTY_ROOT, { recursive: true, force: true });
}

const data = path.join(EMPTY_ROOT, 'data').split(path.sep).join('/');
const API_PORT = 18010;
const WEB_PORT = 14183;

export default defineConfig({
  testDir: './e2e',
  testMatch: /cr04_bootstrap\.spec\.ts/,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: `uv run uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      reuseExistingServer: false,
      env: {
        ORGANUM_APP_DB_URL: `sqlite+aiosqlite:///${data}/app.db`,
        ORGANUM_DEMO_PROJECT_PATH: `${data}/demo_project`,
        ORGANUM_ICONS_DIR: `${data}/icons`,
        ORGANUM_STORAGE_ROOT: `${data}/products`,
        ORGANUM_CACHE_ROOT: `${data}/cache`,
        ORGANUM_CORS_ORIGINS: JSON.stringify([`http://127.0.0.1:${WEB_PORT}`]),
      },
    },
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${WEB_PORT}`,
      port: WEB_PORT,
      env: { ORGANUM_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
