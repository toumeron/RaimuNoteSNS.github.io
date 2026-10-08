import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'layout.spec.ts', timeout: 60000,
  use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  projects: [{name:'desktop',use:{channel:'chrome'}}, {name:'iPad-WebKit',grep:/iPad keeps|iPad sidebar/,use:{...devices['iPad Pro 11'],browserName:'webkit'}}],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true },
});
