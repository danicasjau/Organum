import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Empty data root used by playwright.bootstrap.config.ts (wiped on each run). */
export const EMPTY_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.e2e-bootstrap-root',
);
