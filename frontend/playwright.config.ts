import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:14173',
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --host 127.0.0.1 --port 18000',
      cwd: '../backend',
      url: 'http://127.0.0.1:18000/healthz',
      reuseExistingServer: false,
    },
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 14173',
      port: 14173,
      env: {
        ORGANUM_API_TARGET: 'http://127.0.0.1:18000',
      },
      reuseExistingServer: false,
    },
  ],
});
