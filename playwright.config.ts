import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173/event-horizon/',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome'
      }
    }
  ],
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://127.0.0.1:5173/event-horizon/',
    reuseExistingServer: true,
    timeout: 120000
  }
});
