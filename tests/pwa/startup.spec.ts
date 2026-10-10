import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

test('production startup, repeated launches and cached shell survive a server outage', async ({ page, context, browserName }) => {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    const relative = pathname.replace(/^\/RaimuNoteSNS\.github\.io\//, '');
    const filename = relative && /\.[a-z0-9]+$/i.test(relative) ? relative : 'index.html';
    const target = resolve('dist', filename);
    if (!target.startsWith(resolve('dist') + '/')) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      response.end(readFileSync(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  let stopped = false;
  const stopServer = async () => {
    if (stopped) return;
    stopped = true;
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  };
  try {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => requests.push(request.url()));
  // Isolated, signed-out session. No requests reach the user's Supabase account.
  await context.route('https://*.supabase.co/**', route => route.fulfill({
    contentType: 'application/json', body: '[]',
  }));
  await page.goto(`http://127.0.0.1:${address.port}/RaimuNoteSNS.github.io/`);
  await expect(page.getByRole('button', { name: 'ログインする', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) throw new Error('Service worker was not activated');
  });
  const cached = await page.evaluate(async () => (await Promise.all(
    (await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url))
  )).flat());
  const optionalEngine = /\/(?:AgoraRTC|pdfjs|three\.|three-vrm|ChatPage|Settings|MediaViewer|spaceMusicScore|draco|.*Loader-|space-waiting\.mp3)/;
  expect(cached.filter(url => optionalEngine.test(url))).toEqual([]);
  expect(requests.filter(url => optionalEngine.test(url))).toEqual([]);
  for (let launch = 0; launch < 3; launch++) {
    await page.reload();
    await expect(page.getByRole('button', { name: 'ログインする', exact: true })).toBeVisible();
  }
  // Optional assets remain usable offline after they have actually been requested.
  const settingsAsset = readdirSync('dist/assets').find(name => /^Settings-.*\.js$/.test(name))!;
  const settingsUrl = `/RaimuNoteSNS.github.io/assets/${settingsAsset}`;
  expect(await page.evaluate(async url => (await fetch(url)).status, settingsUrl)).toBe(200);
  await expect.poll(() => page.evaluate(async url => !!(await caches.match(url)), settingsUrl)).toBe(true);
  // Playwright 1.63 WebKit rejects even locally fulfilled SW requests with setOffline.
  // https://github.com/microsoft/playwright/issues/42775
  // Stop the origin for both engines; also emulate network loss in Chrome.
  await stopServer();
  if (browserName === 'chromium') await context.setOffline(true);
  expect(await page.evaluate(async url => (await fetch(url)).status, settingsUrl)).toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: 'ログインする', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  } finally { await stopServer(); }
});

for(const legacy of [false,true])test(`worker update automatically reloads ${legacy?'legacy':'current'} clients exactly once`,async({page,context})=>{
 let version=0;
 const server=createServer((request,response)=>{
  const relative=new URL(request.url!,'http://localhost').pathname.replace(/^\/RaimuNoteSNS\.github\.io\//,'');
  const filename=relative&&/\.[a-z0-9]+$/i.test(relative)?relative:'index.html';
  const file=resolve('dist',filename);if(!file.startsWith(resolve('dist')+'/')){response.writeHead(403).end();return;}
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.html')?'text/html':'application/octet-stream');
  if(legacy&&version===0&&filename==='sw.js'){response.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));");return;}
  if(legacy&&version===0&&filename==='index.html'){response.end('<meta charset="utf-8"><h1>旧バージョン</h1><script>navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});</script>');return;}
  try{const content=readFileSync(file);response.end(filename==='sw.js'?`${content}\n/* revision ${version} */`:content);}catch{response.writeHead(404).end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await context.route('https://*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  const port=(server.address() as {port:number}).port;
  await page.goto(`http://127.0.0.1:${port}/RaimuNoteSNS.github.io/`);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  if(legacy)await expect(page.getByRole('heading',{name:'旧バージョン'})).toBeVisible();else await expect(page.getByRole('button',{name:'ログインする',exact:true})).toBeVisible();
  let reloads=0;page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())reloads++;});
  version=1;
  await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration())!.update();});
  await expect.poll(()=>reloads,{timeout:30000}).toBe(1);
  await expect(page.getByRole('button',{name:'ログインする',exact:true})).toBeVisible();
  await page.waitForTimeout(2500);expect(reloads).toBe(1);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
