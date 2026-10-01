import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/avatar',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/tests/avatar/index.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
