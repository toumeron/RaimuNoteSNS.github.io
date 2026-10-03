import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'bookmarks.spec.ts', timeout: 45000, workers: 2,
  use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  projects: [
    { name: 'desktop', use: { channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'small-mobile', use: { channel: 'chrome', viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'mobile', use: { channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'iOS-PWA-WebKit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true },
});
