import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'visual.spec.ts',timeout:180000,workers:1,
 use:{headless:true,serviceWorkers:'block',baseURL:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/'},
 projects:[{name:'Chrome',use:{channel:'chrome'}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true}});
