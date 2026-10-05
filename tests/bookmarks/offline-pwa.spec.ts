import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const env=readFileSync('.env.local','utf8');
const project=new URL(env.match(/^VITE_SUPABASE_URL\s*=\s*(.+)$/m)![1].trim().replace(/^['"]|['"]$/g,'')).hostname.split('.')[0];
const id='11111111-1111-1111-1111-111111111111';
test('installed app opens saved posts and image after an offline cold launch, isolated by account',async({page,context},info)=>{
 await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true}));
 await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
 await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
 await page.goto('./bookmarks');await expect(page.getByRole('button',{name:'ログインする',exact:true})).toBeVisible();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 const authKey=`sb-${project}-auth-token`;
 await page.evaluate(async({id,authKey})=>{
  const user={id,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',created_at:'2026-10-01T00:00:00Z',app_metadata:{},user_metadata:{username:'offline',display_name:'Offline User'}};
  localStorage.setItem(authKey,JSON.stringify({access_token:'offline-fixture',refresh_token:'offline-fixture',expires_in:3600,expires_at:1,token_type:'bearer',user}));
  const url=new URL('/RaimuNoteSNS.github.io/pwa-192x192.png',location.origin).href;
  const bytes=await (await fetch(url)).arrayBuffer();
  const snapshot={userId:id,savedAt:new Date().toISOString(),emojis:[],assets:[{url,bytes,type:'image/png'}],posts:[{id:'saved-post',userId:id,createdAt:'2026-10-01T00:00:00Z',content:'コールド起動でも読める保存投稿',imageUrls:[url],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:'offline',displayName:'Offline User',avatarUrl:url,bio:'',coverUrl:'',createdAt:'2026-10-01T00:00:00Z'}}]};
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('lime-offline-bookmarks-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('accounts',{keyPath:'userId'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(snapshot);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 },{id,authKey});
 // WebKit's automation driver routes requests before its service worker and
 // also blocks local Blob loads with setOffline. Serve only verified precache
 // entries through that driver; every uncached HTTP request is still aborted.
 const precache=info.project.name.includes('WebKit')?await page.evaluate(async()=>{
  const entries:Record<string,{type:string;bytes:number[]}>={};
  for(const name of await caches.keys())if(name.includes('precache')){
   const cache=await caches.open(name);
   for(const request of await cache.keys()){
    const response=(await cache.match(request))!;
    entries[request.url.split('?')[0]]={type:response.headers.get('content-type')??'application/octet-stream',bytes:[...new Uint8Array(await response.arrayBuffer())]};
   }
  }
  return entries;
 }):null;
 await page.close();
 if(precache){
  await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
  await context.route('**/*',route=>{
   const url=route.request().url();if(!/^https?:/.test(url))return route.continue();
   const cached=precache[url.split('?')[0]]??(route.request().isNavigationRequest()?precache[new URL('/RaimuNoteSNS.github.io/index.html',url).href]:undefined);
   return cached?route.fulfill({contentType:cached.type,body:Buffer.from(cached.bytes)}):route.abort();
  });
 }else await context.setOffline(true);
 const fresh=await context.newPage();await fresh.goto('./bookmarks');
 await expect(fresh.getByText('コールド起動でも読める保存投稿',{exact:true})).toBeVisible();
 const photo=fresh.locator('[data-lime-post-card] img[src^="blob:"]').first();await expect.poll(()=>photo.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
 await fresh.screenshot({path:info.outputPath('offline-cold-launch.png')});
 await fresh.evaluate(({authKey})=>{const stored=JSON.parse(localStorage.getItem(authKey)!);stored.user.id='22222222-2222-2222-2222-222222222222';localStorage.setItem(authKey,JSON.stringify(stored));},{authKey});
 await fresh.reload();await expect(fresh.getByText('オフライン保存したポストがありません。')).toBeVisible();await expect(fresh.getByText('コールド起動でも読める保存投稿',{exact:true})).toHaveCount(0);
 await fresh.evaluate(({authKey,id})=>{const stored=JSON.parse(localStorage.getItem(authKey)!);stored.user.id=id;localStorage.setItem(authKey,JSON.stringify(stored));},{authKey,id});
 await fresh.reload();await expect(fresh.getByText('コールド起動でも読める保存投稿',{exact:true})).toBeVisible();
 await fresh.getByRole('button',{name:'オフライン保存データを削除'}).click();await expect(fresh.getByText('オフライン保存したポストがありません。')).toBeVisible();
 await fresh.reload();await expect(fresh.getByText('オフライン保存したポストがありません。')).toBeVisible();
});

test('installed startup works without idle API and does not reload on worker takeover',async({page,context})=>{
 const errors:string[]=[],requests:string[]=[];let crashed=false;
 page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>{crashed=true;});page.on('request',request=>requests.push(request.url()));
 await context.addInitScript(()=>{
  Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true});
  Object.defineProperty(window,'requestIdleCallback',{configurable:true,value:undefined});
  sessionStorage.setItem('lime-test-start-count',String(Number(sessionStorage.getItem('lime-test-start-count')??0)+1));
 });
 await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
 await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
 await page.goto('./');
 await expect(page.getByRole('button',{name:'ログインする',exact:true}).first()).toBeVisible();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
 // Allow the old auto-update handler's reload window to pass.
 await page.waitForTimeout(1500);
 expect(await page.evaluate(()=>sessionStorage.getItem('lime-test-start-count'))).toBe('1');
 expect(crashed).toBe(false);expect(errors).toEqual([]);
 expect(requests.some(url=>/\/assets\/(Settings|ChatPage|Profile|MediaViewer|AgoraRTC)-/.test(url))).toBe(false);
});
