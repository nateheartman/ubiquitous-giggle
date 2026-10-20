// The interface tests: they run the app in Chromium against the in-browser
// stand-in for the Rust side (src/dev-mock.ts) and use it like a person would.
//
//   npm run e2e                      every test
//   npm run e2e -- tests/e2e/math    one area
//   npm run e2e -- --ui              watch them run, step by step
//   npx playwright test --project=mac   only the macOS-emulated specs (mac-*.spec.ts)
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const CHANNEL = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:1420',
    viewport: { width: 1280, height: 820 },
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // PW_CHANNEL=chrome runs against an installed Chrome instead of Playwright's
  // own download (handy where `playwright install` is unavailable).
  projects: [
    {
      name: 'chromium',
      testIgnore: /mac-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 }, channel: CHANNEL },
    },
    {
      // Platform emulated as macOS: ⌘ is Mod, Apple glyphs, no Windows window controls.
      name: 'mac',
      testMatch: /mac-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 }, channel: CHANNEL, platform: 'mac' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
