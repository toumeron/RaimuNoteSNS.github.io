import {defineConfig, devices, type PlaywrightTestConfig} from '@playwright/test';

// Select a suite without duplicating configuration entry points.
const browserSuites: Record<string, PlaywrightTestConfig> = {};
Object.assign(browserSuites, {
avatar: {
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
},
"account-switching": {
  testDir: "./tests/account-switching", testMatch: 'accounts.spec.ts', timeout: 45000, workers: 2,
  use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  projects: [
    {name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}}},
    {name:'compact-desktop',use:{channel:'chrome',viewport:{width:768,height:900}}},
    {name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
    {name:'iOS-PWA-WebKit',use:{...devices['iPhone 13'],browserName:'webkit'}},
  ],
  webServer: { command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true },
},
"bookmarks:offline-pwa": {testDir:"./tests/bookmarks",outputDir:"./test-results/bookmarks-pwa-cold",testMatch:'offline-pwa.spec.ts',timeout:60000,workers:2,use:{baseURL:'http://127.0.0.1:4173/RaimuNoteSNS.github.io/',serviceWorkers:'allow',headless:true},projects:[{name:'Chrome-PWA',use:{channel:'chrome',viewport:{width:1440,height:900}}},{name:'iOS-PWA-WebKit',use:{...devices['iPhone 13'],browserName:'webkit'}}],webServer:{command:'npm run preview -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173/RaimuNoteSNS.github.io/',reuseExistingServer:true}},
"bookmarks": {
  testDir: "./tests/bookmarks", testMatch: 'bookmarks.spec.ts', timeout: 45000, workers: 2,
  use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  projects: [
    { name:'desktop-PWA',use:{channel:'chrome',viewport:{width:1440,height:900}} },
    { name: 'desktop', use: { channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'small-mobile', use: { channel: 'chrome', viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'mobile', use: { channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'iOS-PWA-WebKit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true },
},
"desktop-layout": {
  testDir: "./tests/desktop-layout", testMatch: 'layout.spec.ts', timeout: 60000,
  use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  projects: [{name:'desktop',use:{channel:'chrome'}}, {name:'iPad-WebKit',grep:/iPad keeps|iPad sidebar|iPad DM/,use:{...devices['iPad Pro 11'],browserName:'webkit'}}],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true },
},
"link-preview": {testDir:"./tests/link-preview",testMatch:'link-preview.spec.ts',timeout:45000,workers:2,use:{baseURL:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',serviceWorkers:'block'},projects:[{name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}}},{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'iOS-WebKit',use:{...devices['iPhone 13'],browserName:'webkit'}}],webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true}},
"maps": {
  testDir: "./tests/maps", testMatch: 'maps.spec.ts', timeout: 45000, workers: 2,
  use: {headless: true, serviceWorkers: 'block', reducedMotion: 'reduce', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/'},
  projects: [
    {name: 'desktop', use: {channel: 'chrome', viewport: {width: 1440, height: 900}}},
    {name: 'mobile', use: {channel: 'chrome', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}},
    {name: 'iPhone-WebKit', use: {...devices['iPhone 13'], browserName: 'webkit'}},
    {name: 'iPad-WebKit', use: {...devices['iPad Pro 11'], browserName: 'webkit'}},
  ],
  webServer: {command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true},
},
"media-lightbox": {
 testDir: "./tests/media-lightbox", testMatch: 'media-lightbox.spec.ts', timeout: 45000, workers: 2,
 use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
 projects: [{name:'small-mobile',use:{channel:'chrome',viewport:{width:320,height:740},isMobile:true,hasTouch:true}},{ name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}} },{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true},
},
"mobile-chat": {
  testDir: "./tests/mobile-chat", testMatch: 'mobile.spec.ts', timeout: 30000,
  use: { channel: 'chrome', headless: true, baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/tests/mobile-chat/index.html', reuseExistingServer: true },
},
"profile-fixes": {
 testDir: "./tests/profile-fixes", testMatch: 'profile.spec.ts', timeout: 45000, workers: 2,
 use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
 projects: [{ name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}} },{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true},
},
"profile-highlights": {
 testDir: "./tests/profile-highlights", testMatch: 'profile-highlights.spec.ts', timeout: 45000, workers: 2,
 use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
 projects: [{name:'small-mobile',use:{channel:'chrome',viewport:{width:320,height:740},isMobile:true,hasTouch:true}},{ name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}} },{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true},
},
"profile-highlights:reviews": {
 testDir: "./tests/profile-highlights", testMatch: 'account-reviews.spec.ts', timeout: 45000, workers: 2,
 use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
 projects: [{name:'small-mobile',use:{channel:'chrome',viewport:{width:320,height:740},isMobile:true,hasTouch:true}},{ name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}} },{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true},
},
"profile-pins": {
 testDir: "./tests/profile-pins", testMatch: 'profile-pins.spec.ts', timeout: 45000, workers: 2,
 use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
 projects: [{name:'small-mobile',use:{channel:'chrome',viewport:{width:320,height:740},isMobile:true,hasTouch:true}},{ name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}} },{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true},
},
"pwa": {
  testDir: "./tests/pwa", testMatch: 'startup.spec.ts', workers: 1, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4173/RaimuNoteSNS.github.io/', headless: true },
  projects: [
    { name: 'Chrome-PWA', use: { channel: 'chrome', viewport: { width: 390, height: 844 } } },
    { name: 'WebKit-iPhone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
},
"quotes": {
 testDir: "./tests/quotes", testMatch: 'quotes.spec.ts', timeout: 45000, workers: 2,
 use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
 projects: [{ name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}} },{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true},
},
"recommendation-vision:visual": {testDir:"./tests/recommendation-vision",testMatch:'visual.spec.ts',timeout:180000,workers:1,
 use:{headless:true,serviceWorkers:'block',baseURL:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/'},
 projects:[{name:'Chrome',use:{channel:'chrome'}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true}},
"search-explore": {
  testDir: "./tests/search-explore", testMatch: 'explore.spec.ts', timeout: 45000, workers: 2,
  use: {headless: true, serviceWorkers: 'block', reducedMotion: 'reduce', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/'},
  projects: [
    {name: 'desktop', use: {channel: 'chrome', viewport: {width: 1440, height: 900}}},
    {name: 'mobile', use: {channel: 'chrome', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}},
    {name: 'iPad-WebKit', use: {...devices['iPad Pro 11'], browserName: 'webkit'}},
  ],
  webServer: {command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true},
},
"spaces": {
  testDir: "./tests/spaces", testMatch: 'spaces.spec.ts', timeout: 45000, workers: 2,
  use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
  projects: [
    { name: 'desktop', use: { channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'iPad', use: { ...devices['iPad Pro 11'], browserName: 'webkit' } },
    { name: 'mobile', use: { channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'iOS-PWA-WebKit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/', reuseExistingServer: true },
},
"stickers": {
 testDir: "./tests/stickers", testMatch: 'stickers.spec.ts', timeout: 45000, workers: 2,
 use: { headless: true, reducedMotion: 'reduce', serviceWorkers: 'block', baseURL: 'http://127.0.0.1:8080/RaimuNoteSNS.github.io/' },
 projects: [{ name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}} },{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true},
},
"tablet-layout": {
  testDir: "./tests/desktop-layout",
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
},
"topics:topics": {testDir:"./tests/topics",testMatch:'topics.spec.ts',timeout:45000,workers:1,
 use:{headless:true,serviceWorkers:'block',baseURL:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/'},
 projects:[{name:'desktop',use:{channel:'chrome',viewport:{width:1440,height:900}}},{name:'small-mobile',use:{channel:'chrome',viewport:{width:320,height:740},isMobile:true,hasTouch:true}},{name:'mobile',use:{channel:'chrome',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'WebKit-iPhone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',reuseExistingServer:true}}
});
Object.assign(browserSuites, {
"settings:settings": {
  ...browserSuites["topics:topics"],
  testDir: "./tests/topics",
  grep: /settings groups|profile editor opens/,
  projects: [...browserSuites["topics:topics"].projects!, { name: 'iPad', use: { ...devices['iPad Mini'], browserName: 'webkit' } }],
}
});
const suite = process.env.LIME_BROWSER_SUITE ?? 'avatar';
if (!browserSuites[suite]) throw new Error('Unknown browser suite: '+suite);
export default defineConfig(browserSuites[suite]);
