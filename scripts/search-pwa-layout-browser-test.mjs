import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io',port=8205;
const post={id:'x:2110000000000000001',source:'x',userId:'x-user:123',content:'検索結果の投稿本文です。モバイルでも左右に余白を確保します。',imageUrls:[],createdAt:'2026-10-18',likesCount:12,commentsCount:3,repostsCount:2,repostedByMe:false,author:{id:'x-user:123',username:'artist@twitter.com',displayName:'作者',avatarUrl:''}};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import '/src/components/layout/desktop-layout.css';import {DesktopLayoutContext} from '/src/components/layout/DesktopLayoutContext';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {PostCard} from '/src/components/feed/PostCard';import {PostSourceLabelVisibility} from '/src/components/post/PostSourceLabel';import {SearchPostRow} from '/src/components/search/SearchExploreContent';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><DesktopLayoutContext.Provider value={innerWidth>=640}><div className={innerWidth>=640?'lime-app-shell':''} data-lime-page="/search" style={{display:'block'}}><section data-results><SearchPostRow><PostCard post={${JSON.stringify(post)}}/></SearchPostRow><SearchPostRow><PostCard post={${JSON.stringify({...post,id:'x:2110000000000000002'})}}/></SearchPostRow></section><section data-profile><PostSourceLabelVisibility.Provider value={false}><PostCard post={${JSON.stringify(post)}}/></PostSourceLabelVisibility.Provider></section></div></DesktopLayoutContext.Provider></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({cacheDir:'/private/tmp/lime-search-pwa-cache',server:{host:'127.0.0.1',port,strictPort:true},plugins:[{name:'search-pwa-fixture',resolveId(id){if(id.endsWith('/__search_pwa.tsx'))return '\0/__search_pwa.tsx';},load(id){if(id==='\0/__search_pwa.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUserId(){return null;}';},configureServer(s){s.middlewares.use(base+'/__search_pwa',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__search_pwa',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:700px;margin:auto"></main><script type="module" src="${base}/__search_pwa.tsx"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.route('**/rest/v1/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
  await page.route('**/functions/v1/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await page.goto(`http://127.0.0.1:${port}${base}/__search_pwa`);
  const rows=page.locator('[data-lime-search-result-row]');await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-profile] [data-lime-post-provider]')).toHaveCount(0);
  await expect(page.locator('[data-results] [data-lime-post-provider]')).toHaveCount(2);
  const result=await rows.first().evaluate(row=>{
   const card=row.querySelector('[data-lime-post-card]'),outer=row.getBoundingClientRect(),inner=card.getBoundingClientRect(),style=getComputedStyle(row);
   return {rowWidth:outer.width,cardWidth:inner.width,leftInset:inner.left-outer.left,rightInset:outer.right-inner.right,border:parseFloat(style.borderBottomWidth),cardBottomBorder:parseFloat(getComputedStyle(card).borderBottomWidth),overflow:style.overflowX,visibleInnerDividers:[...row.querySelectorAll('[data-lime-post-divider]')].filter(node=>getComputedStyle(node).display!=='none').length};
  });
  assert.equal(result.border,1);assert.notEqual(result.overflow,'hidden');assert.equal(result.visibleInnerDividers,0);
  if(width>=640)assert.equal(result.cardBottomBorder,0);
  if(width<640){assert.equal(result.leftInset,16);assert.equal(result.rightInset,16);assert.equal(result.rowWidth,width);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);await page.screenshot({path:`/private/tmp/lime-search-pwa-${width}.png`});
  console.log(JSON.stringify({width,cpuThrottle:4,...result,profileSourceLabels:0,searchSourceLabels:2}));await page.close();
 }
}finally{await browser?.close();await server.close();}
