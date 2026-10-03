import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../desktop-layout',
  testMatch: 'layout.spec.ts',
  grep: /iPad keeps trends/,
  timeout: 60000,
  workers: 1,
  use: { browserName: 'webkit', headless: true, viewport: {width: 1024, height: 1366}, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  projects: [
    {name: 'iPad-desktop-Safari'},
    {name: 'iPad-Safari', use: {userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'}},
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true },
});
