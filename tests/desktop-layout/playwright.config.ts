import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'layout.spec.ts', timeout: 60000,
  use: { channel: 'chrome', headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true },
});
