import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: '**/group-funds.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: '**/group-funds.spec.ts',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'funds-desktop',
      testMatch: '**/group-funds.spec.ts',
      dependencies: ['desktop', 'mobile'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'funds-mobile',
      testMatch: '**/group-funds.spec.ts',
      dependencies: ['funds-desktop'],
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: [
    {
      command:
        'node node_modules/wrangler/bin/wrangler.js dev --config wrangler.local.jsonc --ip 127.0.0.1 --port 8787',
      url: 'http://127.0.0.1:8787/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: 'MONADBOX_LOCAL_FUNDS_TEST=1 node scripts/cloud-test-server.mjs',
      url: 'http://127.0.0.1:8790/api/v1/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'node scripts/cloud-test-server.mjs',
      url: 'http://127.0.0.1:8789/api/v1/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
