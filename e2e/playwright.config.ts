// Demo smoke test configuration. Runs against the stack started by ./scripts/up.sh.
//   pnpm smoke                      (base URL http://localhost:3000)
//   SMOKE_BASE_URL=... pnpm smoke   (another address)
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'results/smoke-report.json' }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: 'results/artifacts',
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
