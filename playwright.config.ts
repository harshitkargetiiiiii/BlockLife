import { defineConfig, devices } from '@playwright/test'

const PORT = 5199

export default defineConfig({
  testDir: 'tests',
  /**
   * Playwright owns `*.spec.ts`; Vitest owns `*.test.ts` (issue #46 §5 put the pure half of the
   * visual helpers — the framing solver — under the unit gate, where arithmetic belongs).
   * Playwright's DEFAULT testMatch collects both suffixes, so without this it tries to load a
   * file that imports `vitest` and the whole run dies with "Vitest failed to access its internal
   * state" and `Total: 0 tests`.
   */
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  // WebGL scenes are heavy in headless browsers; run serially for stability.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Small tolerance for GPU/driver rasterization differences.
      maxDiffPixelRatio: 0.03,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
