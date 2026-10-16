import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io',port=8208;
const post={id:'x:2110000000000000001',source:'x',userId:'x-user:123',content:'プロフィールの親投稿',imageUrls:[],createdAt:'2026-10-18T00:00:00Z',likesCount:12,commentsCount:0,repostsCount:2,repostedByMe:false,author:{id:'x-user:123',username:'artist@twitter.com',displayName:'作者',avatarUrl:''}};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {PostCard} from '/src/components/feed/PostCard';import {ProfileReplyThreadCard} from '/src/pages/Profile';import {externalProfileReplyThread} from '/src/lib/profileReplyThreads';import {PostSourceLabelVisibility} from '/src/components/post/PostSourceLabel';import {useBlueskySession} from '/src/hooks/useBlueskySession';import {useTimelinePortalTheme} from '/src/hooks/useViewportWidth';import {useMinuteTick} from '/src/hooks/useViewportWidth';const post=${JSON.stringify(post)};function Probe(){useBlueskySession('bsky:probe');useTimelinePortalTheme(true);useMinuteTick();return null;}window.unmountFixture?.();const root=createRoot(document.getElementById('root'));function App(){return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{Array.from({length:200},(_,i)=><Probe key={i}/>)}<section data-profile><PostSourceLabelVisibility.Provider value={false}><PostCard post={post}/>{['x','bluesky','misskey'].map((source,i)=>{const parent={...post,id:['x:1','bsky:2','misskey:3'][i],source,content:'親投稿 '+source};const reply={...post,id:'x:reply'+i,content:'返信の本文',externalReplyToId:parent.id,externalReplyParent:parent};return <ProfileReplyThreadCard key={source} thread={externalProfileReplyThread(reply)} onImageClick={()=>{}} onImageError={()=>{}}/>;})}</PostSourceLabelVisibility.Provider></section><section data-feed>{Array.from({length:80},(_,i)=><PostCard key={i} timelineGlass post={{...post,id:'x:'+i,content:'タイムラインの投稿 '+i}}/>)}</section></MemoryRouter></QueryClientProvider>;}root.render(<App/>);window.unmountFixture=()=>root.unmount();`;
const server=await createServer({cacheDir:'/private/tmp/lime-mobile-pwa-performance-cache',server:{host:'127.0.0.1',port,strictPort:true},plugins:[{name:'mobile-pwa-performance-fixture',resolveId(id){if(id.endsWith('/__pwa_perf.tsx'))return '\0/__pwa_perf.tsx';},load(id){if(id==='\0/__pwa_perf.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUserId(){return null;}';},configureServer(s){s.middlewares.use(base+'/__pwa_perf',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__pwa_perf',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script type="module" src="${base}/__pwa_perf.tsx"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'standalone',{value:true});
  const tracked=['lime-bluesky-session-changed','timeline-visual-theme-changed'];
  const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window),counts=Object.fromEntries(tracked.map(name=>[name,0]));
  window.addEventListener=(name,...args)=>{if(name in counts)counts[name]++;return add(name,...args);};
  window.removeEventListener=(name,...args)=>{if(name in counts)counts[name]--;return remove(name,...args);};
  const Native=window.BroadcastChannel;let channels=0;
  window.BroadcastChannel=class extends Native{constructor(name){super(name);if(name==='timeline-visual-theme')channels++;this.counted=name==='timeline-visual-theme';}close(){if(this.counted){channels--;this.counted=false;}super.close();}};
  window.pwaPerf=()=>({...counts,themeChannels:channels});
 });
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.route('**/rest/v1/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 await page.route('**/functions/v1/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
 await page.goto(`http://127.0.0.1:${port}${base}/__pwa_perf`);
 await expect(page.locator('[data-feed] [data-lime-post-card]')).toHaveCount(80);
 await expect(page.locator('[data-profile] .profile-reply-thread')).toHaveCount(3);
 await expect(page.locator('[data-profile] [data-lime-post-provider]')).toHaveCount(0);
 await expect(page.locator('[data-profile]').getByText(/^(twitter|Bluesky|Misskey)$/)).toHaveCount(0);
 await expect(page.locator('[data-feed] [data-lime-post-provider]')).toHaveCount(80);
 const subscriptions=await page.evaluate(()=>window.pwaPerf());
 assert.equal(subscriptions['lime-bluesky-session-changed'],1);assert.equal(subscriptions['timeline-visual-theme-changed'],1);assert.equal(subscriptions.themeChannels,1);
 const timing=await page.evaluate(async()=>{
  const frames=[];let previous=performance.now();
  for(let i=0;i<80;i++){window.scrollBy(0,160);await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;}
  frames.sort((a,b)=>a-b);return {medianFrameMs:Math.round(frames[40]*10)/10,p95FrameMs:Math.round(frames[76]*10)/10,scrollY,documentHeight:document.documentElement.scrollHeight};
 });
 assert.ok(timing.scrollY>1000);assert.deepEqual(errors,[]);
 await page.evaluate(()=>window.unmountFixture());await page.waitForFunction(()=>Object.values(window.pwaPerf()).every(value=>value===0));const released=await page.evaluate(()=>window.pwaPerf());assert.deepEqual(Object.values(released),[0,0,0]);
 console.log(JSON.stringify({mobilePwa:true,cpuThrottle:4,posts:80,probeConsumers:200,profileReplyProviders:3,profileLabels:0,feedLabels:80,subscriptions,released,...timing}));
}finally{await browser?.close();await server.close();}
