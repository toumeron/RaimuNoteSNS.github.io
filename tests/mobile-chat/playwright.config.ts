import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'mobile.spec.ts', timeout: 30000,
  use: { channel: 'chrome', headless: true, baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/tests/mobile-chat/index.html', reuseExistingServer: true },
});
