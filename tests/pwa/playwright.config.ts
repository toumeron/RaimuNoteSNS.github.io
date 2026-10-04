import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'startup.spec.ts', workers: 1, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4173/RaimuNoteSNS.github.io/', headless: true },
  projects: [
    { name: 'Chrome-PWA', use: { channel: 'chrome', viewport: { width: 390, height: 844 } } },
    { name: 'WebKit-iPhone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
