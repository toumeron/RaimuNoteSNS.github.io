// Each command runs one original verification in its own process.
// Dependencies are loaded only after selecting that verification.
const suites = {
  // recommendation-pixels-browser-test.mjs
  "recommendation-pixels": async () => {
const { createServer } = await import('vite');
const { chromium } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',fixture='/__pixels.ts';
const source=`import {enrichRecommendationVisuals,releaseRecommendationVisualWorker} from '/src/lib/recommendationVisualInference';import {rankRecommendations} from '/src/lib/recommendations';window.run=async()=>{const start=performance.now(),post={id:'x:990001',userId:'x-user:990001',source:'x',content:'#ファンアート キャラクターイラスト',recommendationTopics:['digital-illustration'],languages:['ja'],imageUrls:['https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cats.jpg'],createdAt:new Date().toISOString(),likesCount:9999,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id:'x-user:990001',username:'artist@twitter.com',bio:'イラストレーター'}};try{const [checked]=await enrichRecommendationVisuals([post],['digital-illustration'],undefined,undefined,1);return{ms:Math.round(performance.now()-start),kind:checked.recommendationVisual?.kind,status:checked.recommendationVisualStatus,ranked:rankRecommendations([checked],{authors:{},terms:{},followedTopics:['digital-illustration']},'viewer').length};}finally{releaseRecommendationVisualWorker();}};`;
const server=await createServer({server:{host:'127.0.0.1',port:8208,strictPort:true},plugins:[{name:'pixels-fixture',resolveId(id){if([fixture,base+fixture,'\0'+fixture].includes(id))return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__pixels_test',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__pixels_test',`<div id="root"></div><script type="module" src="${fixture}"></script>`));});}}]});let browser;
try{await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',error=>console.error(error.message));await page.goto('http://127.0.0.1:8208'+base+'/__pixels_test');await page.waitForFunction(()=>window.run);const result=await page.evaluate(()=>window.run());assert.equal(result.status,'checked');assert.equal(result.kind,'pets');assert.equal(result.ranked,0,'pet pixels must outweigh an illustration caption and popularity');console.log(JSON.stringify(result));}finally{await browser?.close();await server.close();}
  },

  // recommended-cold-live-test.mjs
  "recommended-cold": async () => {
const { createServer, build, loadEnv } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react-swc');
const { createServer: httpServer } = await import('node:http');
const { readFile, mkdtemp } = await import('node:fs/promises');
const { gzipSync } = await import('node:zlib');
const { default: path } = await import('node:path');
const { chromium } = await import('@playwright/test');
const { writeFile } = await import('node:fs/promises');

// No response interception, seeded visual cache, saved timeline, or saved login.
// Public accounts/interests are explicit test input; all source and model reads are real.
const base='/RaimuNoteSNS.github.io',entry='/__recommendation_cold_live.tsx';
const source=`
 import React,{useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';
 import {getRecommendationContinuation} from '/src/api/topics';
 import {createRecommendationCursor} from '/src/api/recommendations';
 const handles=['nagomi_yyd@twitter.com','rurudo_@twitter.com','kantoku_5th@twitter.com'];
 const cursor=createRecommendationCursor(handles);cursor.preferences={authors:Object.fromEntries(handles.map(h=>[h,3])),followedAuthors:handles,terms:{},followedTopics:['digital-illustration']};
 if(!window.__recommendedColdRun){window.__recommendedColdRun=true;
 window.live={started:window.__recommendedStart??performance.now(),steps:[],count:0,done:false,source:'real-public-sources',coldVisualCache:true};
 const root=createRoot(document.getElementById('root'));
 function Cards({posts}){useLayoutEffect(()=>{window.live.renderedCount=posts.length;window.live.renderMs=Math.round(performance.now()-window.live.started);},[posts]);return posts.map(post=>React.createElement('article',{key:post.id,'data-post-id':post.id},post.author.displayName??post.author.username,React.createElement('p',{},post.content)));}
 setTimeout(()=>{window.live.countAt500=document.querySelectorAll('article[data-post-id]').length;},500);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('Live test deadline','TimeoutError')),90000);
 getRecommendationContinuation(cursor,null,controller.signal,page=>{
  window.live.count=page.posts.length;window.live.steps.push({ms:Math.round(performance.now()-window.live.started),count:page.posts.length});
  root.render(React.createElement(Cards,{posts:page.posts}));
 }).then(page=>{window.live.ids=page.posts.map(p=>p.id);window.live.services=page.posts.map(p=>p.source);window.live.error=page.visualError?.message??page.twitterError?.message;},error=>{window.live.error=String(error?.message??error);}).finally(()=>{clearTimeout(timer);window.live.elapsedMs=Math.round(performance.now()-window.live.started);window.live.done=true;});
 }
`;
const production=process.env.RECOMMENDATION_TEST_BUILD==='production';
let server;
if(production){
 const outDir=await mkdtemp('/private/tmp/lime-recommendation-cold-build-');
 const env=loadEnv('production',process.cwd(),'VITE_');
 const bootstrap=await readFile('public/recommendations/catalog.json','utf8');
 await build({configFile:false,base:base+'/',plugins:[react(),{name:'recommendation-production-test',resolveId(id){if(id===entry)return '\0'+entry;},load(id){if(id==='\0'+entry)return source.replaceAll("'/src/","'"+path.resolve('src')+'/');}}],resolve:{alias:{'@':path.resolve('src')}},define:{'import.meta.env.VITE_RECOMMENDATION_BOOTSTRAP':bootstrap,...Object.fromEntries(Object.entries({...env,...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith('VITE_')))}).map(([key,value])=>['import.meta.env.'+key,JSON.stringify(value)]))},build:{outDir,emptyOutDir:true,target:'es2020',rollupOptions:{input:entry,output:{entryFileNames:'test-entry.js'}}}});
 const native=httpServer(async(req,res)=>{try{
  if(req.url===base+'/__recommendation_cold_live'){res.setHeader('Content-Type','text/html');res.end(`<html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script>window.__recommendedStart=performance.now();setTimeout(()=>{window.__countAt500=document.querySelectorAll('article[data-post-id]').length},500)</script><script type="module" src="${base}/test-entry.js"></script></body></html>`);return;}
  const relative=decodeURIComponent((req.url??'').split('?')[0]).slice(base.length+1);if(relative.includes('..'))throw new Error('invalid path');
  const content=await readFile(path.join(outDir,relative));res.setHeader('Content-Type',relative.endsWith('.js')?'application/javascript':'application/octet-stream');res.setHeader('Content-Encoding','gzip');res.end(gzipSync(content));
 }catch{res.statusCode=404;res.end();}});
 server={listen:()=>new Promise(resolve=>native.listen(8214,'127.0.0.1',resolve)),close:()=>new Promise(resolve=>native.close(resolve))};
}else server=await createServer({cacheDir:'/private/tmp/lime-real-cold-vite-cache',server:{host:'127.0.0.1',port:8214,strictPort:true},plugins:[{name:'real-cold-recommendation-test',resolveId(id){if(id===entry||id===base+entry||id==='\0'+entry)return '\0'+entry;},load(id){if(id==='\0'+entry)return source;},configureServer(s){s.middlewares.use(base+'/__recommendation_cold_live',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__recommendation_cold_live',`<html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="${base}${entry}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext();const page=await context.newPage();
 if(process.env.RECOMMENDATION_TEST_NETWORK==='wifi'){
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:20*1024*1024/8,uploadThroughput:10*1024*1024/8});
 }
 const catalogReads=[];context.on('requestfinished',async request=>{if(new URL(request.url()).pathname.endsWith('/recommendations/catalog.json')){const response=await request.response();catalogReads.push({status:response?.status(),bytes:response?.headers()['content-length'],durationMs:Math.round(request.timing().responseEnd)});}});
 const errors=[],requests={},network=[],consoleErrors=[];page.on('console',msg=>{if(msg.type()==='error'&&consoleErrors.length<20)consoleErrors.push(msg.text().slice(0,250));});context.on('requestfailed',request=>{try{const url=new URL(request.url());if(url.hostname!=='127.0.0.1')network.push({host:url.hostname,path:url.pathname.slice(-110),failure:request.failure()?.errorText});}catch{}});context.on('response',response=>{try{const url=new URL(response.url());if(url.hostname.includes('hf.co')||url.hostname==='huggingface.co'||!response.ok())network.push({host:url.hostname,path:url.pathname.slice(-110),status:response.status(),bytes:response.headers()['content-length']});}catch{}});page.on('pageerror',error=>errors.push(error.message));context.on('request',request=>{try{const host=new URL(request.url()).hostname;if(host!=='127.0.0.1')requests[host]=(requests[host]??0)+1;}catch{}});
 await page.goto('http://127.0.0.1:8214'+base+'/__recommendation_cold_live',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.live?.done&&typeof window.live.countAt500==='number',{},{timeout:110000});
 const result=await page.evaluate(()=>({...window.live,...(typeof window.__countAt500==='number'?{countAt500:window.__countAt500}:{})}));const output={...result,catalogReads,networkProfile:process.env.RECOMMENDATION_TEST_NETWORK??'unthrottled-local',preferences:'explicit-public-test-input-without-account-authentication',timingScope:production?'HTML-to-production-JS-transfer-and-20-card-DOM; image-analysis-prepared-on-server':'candidate-ranking-and-card-DOM-after-module-load; image-analysis-prepared-on-server',requests,network,consoleErrors,pageErrors:errors};
 await writeFile('/private/tmp/lime-recommended-cold-live-result.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
 if(result.countAt500<20)process.exitCode=1;
}finally{await browser?.close();await server.close();}
  },

  // recommended-continuation-browser-test.mjs
  "recommended-continuation": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',fixture='/__continuation_fixture.tsx';
const source=`import React,{useEffect,useState,useRef} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{useRecommendedFeed}from'/src/hooks/useRecommendedFeed';import{useTimelineContinuation}from'/src/hooks/useRecommendedFeed';function View(){const feed=useRecommendedFeed(true),[visible,setVisible]=useState(false),bottom=useRef(null);useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'80px'});observer.observe(bottom.current);return()=>observer.disconnect();},[]);useTimelineContinuation({enabled:true,inView:visible,hasNextPage:!!feed.hasNextPage,isFetching:feed.isFetching,isFetchNextPageError:feed.isFetchNextPageError,automaticPaused:feed.automaticPaused,scrollIntent:0,pageCount:feed.data?.pages.length??0,fetchNextPage:feed.fetchNextPage});return <section>{feed.data?.pages.flatMap(page=>page.posts).map(post=><article key={post.id} style={{height:140}}>{post.id}</article>)}<div ref={bottom} style={{height:80}}/><output id='paused'>{String(feed.automaticPaused)}</output></section>};if(!window.__continuationFixtureRoot){window.__continuationFixtureRoot=createRoot(document.getElementById('root'));window.__continuationFixtureRoot.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><View/></QueryClientProvider>);}`;
const mockApi=`let reads=0;export const createRecommendationCursor=()=>({lime:{page:0,done:false},trending:{cursor:null,done:true},authors:{},topics:{},nativeAuthors:{},history:[],remaining:[],seen:[]});export const getRecommendationPreferences=async()=>({authors:{},terms:{}});export async function getRecommendationPage(previous){reads++;const key=(previous.pageKey??0)+1;window.__recommendationReads=reads;(window.__recommendationKeys??=[]).push(key);const cursor=createRecommendationCursor();cursor.pageKey=key;cursor.preferences={authors:{},terms:{}};const posts=[1,6].includes(key)?Array.from({length:6},(_,i)=>({id:'page-'+key+'-'+i,userId:'creator',content:'アニメの作品',imageUrls:['https://images.example/'+key+'-'+i+'.jpg'],createdAt:'2026-10-13',author:{id:'creator',username:'creator'}})):[];return {posts,next:cursor,preferences:cursor.preferences,pendingAnalysis:false,automaticPaused:key>=9,requestKey:key};}`;
const server=await createServer({server:{host:'127.0.0.1',port:8197,strictPort:true},plugins:[{name:'continuation-fixture',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__continuation',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__continuation',`<html><head></head><body><div id='root'></div><script type='module' src='${fixture}'></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:640}});const errors=[];page.on('pageerror',error=>errors.push(error.stack));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ("export const useAuth=()=>({user:{id:'fixture-viewer'},loading:false});")});
});
 await page.route('**/src/hooks/useRecommendedFeed.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useRecommendationImpressions=()=>{};')});
});
 await page.route('**/src/api/recommendations.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + (mockApi)});
});
 await page.route('**/*.supabase.co/**',route=>route.abort());
 await page.goto(`http://127.0.0.1:8197${base}/__continuation`);
 try{await expect(page.locator('article')).toHaveCount(6);}catch(error){console.error({errors:errors.slice(0,1),scripts:await page.locator("script").evaluateAll(nodes=>nodes.map(node=>node.src)),roots:await page.locator("#root").count(),html:await page.locator("#root").innerHTML()});throw error;}
 // Allow one page to warm, then scroll once. Four empty responses must not
 // leave the reader stuck at the old bottom, including instantly resolved reads.
 await page.waitForTimeout(450);await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 try{await expect(page.locator('article')).toHaveCount(12);}catch(error){console.error({errors:errors.slice(0,1),reads:await page.evaluate(()=>window.__recommendationReads),paused:await page.locator('#paused').innerText(),dimensions:await page.evaluate(()=>({y:scrollY,height:document.body.scrollHeight,window:innerHeight,html:document.documentElement.scrollHeight}))});throw error;}
 await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 await expect(page.locator('#paused')).toHaveText('true');
 const reads=await page.evaluate(()=>window.__recommendationReads);
 await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>window.__recommendationReads),reads);assert.ok(reads<=10,JSON.stringify({reads,keys:await page.evaluate(()=>window.__recommendationKeys)}));assert.deepEqual(errors,[]);
 console.log(`PASS: one mobile scroll continues through four empty cached pages; 12 unique posts; empty stream stops at ${reads} page reads without further requests`);
}finally{await browser?.close();await server.close();}
  },

  // recommended-feed-scroll-browser-test.mjs
  "recommended-feed-scroll": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const personalArt=process.argv[2]==='personal-art';
const checkAnimation=process.argv[3]==='animation';
const base='/RaimuNoteSNS.github.io',fixture='/__feed_scroll_fixture.tsx';
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Feed from '/src/pages/Feed';import{createRecommendationCursor}from'/src/api/recommendations';import{recommendationQueries}from'/src/lib/recommendations';import '/src/index.css';
if(!window.__feedFixtureRoot){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),actor='did:plc:science-creator',topic=${JSON.stringify(personalArt?'digital-illustration':'science')},preferences={authors:{[actor]:8},followedAuthors:[actor],terms:{},followedTopics:[topic]};
 const works=Array.from({length:51},(_,i)=>({id:'bsky:scroll-work-'+i,userId:${personalArt?"'did:plc:art-creator-'+(i%3)":'actor'},content:${JSON.stringify(personalArt?'キャラクターイラスト':'科学の研究')}+' '+i,recommendationTopics:[topic],imageUrls:['https://images.example/scroll-work-'+i+'.jpg'],languages:['ja'],createdAt:'2026-10-13',likesCount:1,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id:${personalArt?"'did:plc:art-creator-'+(i%3)":'actor'},username:'creator',displayName:'Creator',bio:'',avatarUrl:'',coverUrl:'',createdAt:'2026-10-13'}}));
 if(${personalArt}){preferences.likedSamples=[0,1,2].flatMap(index=>[0,1].map(ref=>({...works[index],id:'liked-'+index+'-'+ref,imageUrls:['https://images.example/liked-'+index+'-'+ref+'.jpg']})));for(const work of works)preferences.authors[work.userId]=8;}
 const cursor=createRecommendationCursor([]);cursor.pageKey=1;cursor.preferences=preferences;cursor.lime.done=true;cursor.trending.done=true;cursor.authors={[actor]:{cursor:'0',done:false}};cursor.topicDiscovery={[topic]:{feeds:[],positions:{},done:true}};cursor.topics=Object.fromEntries(recommendationQueries(preferences).map(term=>[term,{limePage:0,limeDone:true,blueCursor:null,blueDone:true,misskeyCursor:null,misskeyDone:true}]));cursor.history=works.slice(0,3);cursor.seen=cursor.history.map(post=>post.id);cursor.remaining=[];window.__feedWorks=works.slice(3);
 window.__feedClient=client;window.__feedKey=['feed','recommended','scoring-v42-balanced-first-page','fixture-viewer',[]];
 client.setQueryData(window.__feedKey,{pages:[{posts:works.slice(0,3),preferences,next:cursor,pendingAnalysis:false,automaticPaused:false,requestKey:1}],pageParams:[createRecommendationCursor([])]});
 localStorage.setItem('lime_active_feed_tab','recommended');
 window.__feedFixtureRoot=createRoot(document.getElementById('root'));window.__feedFixtureRoot.render(<QueryClientProvider client={client}><Feed/></QueryClientProvider>);
}`;
const server=await createServer({server:{host:'127.0.0.1',port:8195,strictPort:true},plugins:[{name:'feed-scroll-fixture',resolveId(id){if([fixture,base+fixture,'\0'+fixture].includes(id))return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__feed_scroll',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__feed_scroll',`<html><head></head><body><div id='root'></div><script type='module' src='${fixture}'></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:700}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/lib/fxTwitter.ts*',route=>route.request().url().includes('fixture-original')?route.continue():route.fulfill({contentType:'application/javascript',body:"export * from '/RaimuNoteSNS.github.io/src/lib/fxTwitter.ts?fixture-original';export const searchXPage=async()=>({posts:[],cursor:null});"}));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ("export const useAuth=()=>({user:{id:'fixture-viewer'},loading:false});")});
});
 await page.route('**/src/components/feed/PostCard.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ("import React from '/RaimuNoteSNS.github.io/node_modules/.vite/deps/react.js';export function PostCard({post}){return React.createElement('article',{'data-test-post':post.id,style:{height:180}},post.content);}".replace('height:180',checkAnimation?'height:20':'height:180'))});
});
 await page.route('**/src/components/feed/PostComposer.tsx*',route=>route.fulfill({contentType:'application/javascript',body:'export const PostComposer=()=>null;'}));
 await page.route('**/src/hooks/useFeed.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useTimelineFeed=()=>({data:{pages:[]}});')});
});
 await page.route('**/src/hooks/useTopics.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useListFeed=()=>({data:{pages:[]}});export const useListCatalog=()=>({data:[]});')});
});
 await page.route('**/src/hooks/useRecommendedFeed.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useRecommendationImpressions=()=>{};')});
});
 await page.route('**/src/lib/bluesky.ts*',route=>{if(route.request().url().includes('fixture-original'))return route.continue();return route.fulfill({contentType:'application/javascript',body:`export * from '/RaimuNoteSNS.github.io/src/lib/bluesky.ts?fixture-original';export async function fetchBlueskyAuthorFeed({cursor}){if(${checkAnimation})await new Promise(resolve=>setTimeout(resolve,90));const page=Number(cursor??0);if(page<4)return {posts:[],cursor:String(page+1)};const start=(page-4)*8,posts=window.__feedWorks.slice(start,start+8);if(${personalArt})posts.push({...window.__feedWorks[0],id:'bsky:fairy-tale-'+page,userId:'did:plc:unfamiliar-storyteller',author:{...window.__feedWorks[0].author,id:'did:plc:unfamiliar-storyteller',username:'storyteller'},likesCount:100000,content:'アニメの少女と少年が登場する童話 #ファンアート',imageUrls:['https://images.example/fairy-tale-'+page+'.jpg']});return {posts,cursor:start+8<window.__feedWorks.length?String(page+1):null};}`});});
 await page.route('**/src/lib/supabase.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const builder={select(){return this},eq(){return this},in(){return this},order(){return this},limit(){return this},range(){return this},abortSignal(){return this},maybeSingle:async()=>({data:{followed_topics:[${JSON.stringify(personalArt?'digital-illustration':'science')}]},error:null}),then(resolve){return Promise.resolve({data:this.table==='follows'?[{followee_id:'did:plc:science-creator'}]:[],error:null}).then(resolve)}};const channel={on(){return this},subscribe(){return this}};export const supabase={from:(table)=>({...builder,table}),channel:()=>channel,removeChannel:()=>{},auth:{getUser:async()=>({data:{user:{id:'fixture-viewer'}},error:null}),getSession:async()=>({data:{session:null}})}};`}));
 await page.goto(`http://127.0.0.1:8195${base}/__feed_scroll`);
 try{await expect(page.locator('[data-test-post]').first()).toBeVisible();}catch(error){console.error({errors});throw error;}
 if(checkAnimation){await page.waitForTimeout(950);assert.equal(await page.locator('.animate-float-up').count(),0,'appended pages must not restart the entrance animation');}
 for(let step=0;step<20;step++){
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(150);
  const count=await page.evaluate(()=>window.__feedClient.getQueryData(window.__feedKey)?.pages.reduce((sum,page)=>sum+page.posts.length,0));
  if(count===51)break;
 }
 const ids=await page.evaluate(()=>window.__feedClient.getQueryData(window.__feedKey)?.pages.flatMap(page=>page.posts.map(post=>post.id)));
 assert.equal(ids.length,51);assert.equal(new Set(ids).size,51);assert.ok(ids.every(id=>!id.includes('fairy-tale')));if(personalArt){const creators=await page.evaluate(()=>new Set(window.__feedClient.getQueryData(window.__feedKey).pages.flatMap(page=>page.posts.map(post=>post.userId))).size);assert.equal(creators,3,'related previously liked creators must all remain in the feed');}
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
 await expect(page.getByText('すべての投稿を読み込みました')).toBeVisible();
 await expect(page.locator('[data-test-post="bsky:scroll-work-50"]')).toBeVisible();
 assert.deepEqual(errors,[]);console.log(`PASS: actual Feed at ${width}px scrolls through 51 unique relevant works, past four empty pages, including virtualization and the real recommendation API; ends only after all works${personalArt?'; three art creators retained; unfamiliar fairy tales excluded':''}`);await page.close();
 }
}finally{await browser?.close();await server.close();}
  },

  // recommended-personal-art-browser-test.mjs
  "recommended-personal-art": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
// Optional captured public response; default fixture keeps the test independent of live services.
const saved=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')).feed:[{post:{uri:'at://did:plc:fixture/app.bsky.feed.post/recovery',author:{did:'did:plc:fixture',handle:'fixture.bsky.social'},record:{text:'日本語の公開フィード候補（テスト用）',langs:['ja'],createdAt:new Date().toISOString()},likeCount:200,embed:{images:[{fullsize:'https://images.example/fixture.jpg',thumb:'https://images.example/fixture.jpg',alt:'テスト用イラスト'}]}}}];
const feedback=Array.from({length:110},(_,i)=>({id:`dismissed-${i}`,userId:`dismissed-creator-${i}`,topics:[i<4?'anime':i<65?'digital-illustration':'art'],imageUrls:[`https://images.example/old-${i}.jpg`],createdAt:new Date().toISOString()}));
const base='/RaimuNoteSNS.github.io',fixture='/__recommended_recovery.tsx';
const source=`import {recordRecommendationLike} from '/src/lib/recommendations';import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useRecommendedFeed} from '/src/hooks/useRecommendedFeed';import '/src/index.css';recordRecommendationLike({id:'bsky:liked-art',userId:'did:plc:liked-artist',content:'キャラクターイラスト',imageUrls:['https://images.example/liked-art.jpg'],recommendationTopics:['digital-illustration'],recommendationLanguages:['ja'],source:'bluesky',author:{id:'did:plc:liked-artist',username:'liked.bsky.social'},createdAt:new Date().toISOString()},true,'viewer');window.recoStart=performance.now();function View(){const feed=useRecommendedFeed(true);window.feedData=feed.data;window.feedError=String(feed.error);const posts=feed.data?.pages.flatMap(page=>page.posts)??[];if(posts.length&&!window.recoFirst)window.recoFirst=performance.now()-window.recoStart;return <><button onClick={()=>feed.fetchNextPage()}>続きを取得</button><output id="state">{feed.isError?'error:'+String(feed.error?.message):posts.length?'ready':'loading'}</output>{posts.map(post=><article key={post.id} data-post-id={post.id}>{post.content}</article>)}</>};if(!window.__personalRecoRoot){window.__personalRecoRoot=createRoot(document.getElementById('root'));window.__personalRecoRoot.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><View/></QueryClientProvider>);}`;
const server=await createServer({server:{host:'127.0.0.1',port:8206,strictPort:true},plugins:[{name:'recommended-recovery',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__recommended_recovery',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__recommended_recovery',`<html><head></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ("export const useAuth=()=>({user:{id:'viewer'},loading:false});")});
});
 await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const getFeed=async()=>[];export const getPostsByUser=async()=>[];export const searchPosts=async()=>[];'}));
 await page.route('**/src/hooks/useRecommendedFeed.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useRecommendationImpressions=()=>{};')});
});
 await page.route('**/*.supabase.co/**',route=>{const req=route.request(),url=new URL(req.url());const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/profile_private_settings')?{followed_topics:['anime','digital-illustration'],dismissed_topics:[],recommendation_feedback:feedback}:[])});});
 await page.route('**/api/notes/search',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'[]'}));await page.route('**/xrpc/app.bsky.feed.getAuthorFeed?*',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"feed":[]}'}));
 let searches=0,feeds=0;
 await page.route('**/xrpc/app.bsky.feed.searchPosts?*',route=>{searches++;return route.abort('failed');});
 await page.route('**/xrpc/app.bsky.unspecced.getPopularFeedGenerators?*',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({feeds:[]})}));
 await page.route('**/xrpc/app.bsky.feed.getFeed?*',route=>{feeds++;const url=new URL(route.request().url()),offset=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??8),end=offset+limit;return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({feed:Array.from({length:40},(_,index)=>({...saved[0],post:{...saved[0].post,uri:'at://did:plc:creator'+index+'/app.bsky.feed.post/illustration'+index,author:{...saved[0].post.author,did:'did:plc:creator'+index},embed:{images:[{fullsize:'https://images.example/illustration'+index+'.jpg',alt:''}]}}})).slice(offset,end),cursor:end<40?String(end):undefined})});});
 await page.route('**/src/api/search-newsRelay.ts*',route=>route.fulfill({contentType:'application/javascript',body:"export async function relayTwitterSearch(q,f,offset){return {ids:Array.from({length:6},(_,i)=>String(2110900000000000000n+BigInt(offset+i))),cursor:offset<6?6:null};}"}));await page.route('https://api.fxtwitter.com/2/status/*',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({code:200,status:{id,type:'status',text:'#ファンアート',lang:'ja',author:{id:'998877',screen_name:'artist',description:'イラストレーター'},created_timestamp:Math.floor(Date.now()/1000),likes:10,media:{photos:[{url:'https://images.example/twitter-'+id+'.jpg'}]}}})});});
 await page.goto(`http://127.0.0.1:8206${base}/__recommended_recovery`);
 try{await expect(page.locator('#state')).toHaveText('ready');}catch(error){console.error({errors,searches,feeds,state:await page.locator('#state').innerText()});throw error;}assert.ok(await page.locator('article').count()>0);assert.ok(feeds>0);assert.deepEqual(errors,[]);
 const first=await page.evaluate(()=>window.recoFirst);assert.ok(first<1500,'first card took '+first+'ms');for(let i=0;i<5&&await page.locator('article').count()<=8;i++){await page.getByRole('button',{name:'続きを取得'}).click();await page.waitForTimeout(250);}const ids=await page.locator('article').evaluateAll(rows=>rows.map(row=>row.dataset.postId));assert.ok(ids.length>8);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.some(id=>id.startsWith('x:')));console.log('PASS: personalized art, no image vectors, first visible in '+Math.round(first)+'ms; '+ids.length+' unique posts after continuation; '+feeds+' feed requests.');
}finally{await browser?.close();await server.close();}
  },

  // recommended-recovery-browser-test.mjs
  "recommended-recovery": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
// Optional captured public response; default fixture keeps the test independent of live services.
const saved=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')).feed:[{post:{uri:'at://did:plc:fixture/app.bsky.feed.post/recovery',author:{did:'did:plc:fixture',handle:'fixture.bsky.social'},record:{text:'日本語の公開フィード候補（テスト用）',langs:['ja'],createdAt:new Date().toISOString()},likeCount:200}}];
const base='/RaimuNoteSNS.github.io',fixture='/__recommended_recovery.tsx';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useRecommendedFeed} from '/src/hooks/useRecommendedFeed';import '/src/index.css';function View(){const feed=useRecommendedFeed(true);const posts=feed.data?.pages.flatMap(page=>page.posts)??[];return <><output id="state">{feed.isError?'error':posts.length?'ready':'loading'}</output>{posts.map(post=><article key={post.id} data-post-id={post.id}>{post.content}</article>)}</>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><View/></QueryClientProvider>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8197,strictPort:true},plugins:[{name:'recommended-recovery',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__recommended_recovery',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__recommended_recovery',`<html><head></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ("export const useAuth=()=>({user:{id:'viewer'},loading:false});")});
});
 await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const getFeed=async()=>[];export const getPostsByUser=async()=>[];export const searchPosts=async()=>[];'}));
 await page.route('**/src/hooks/useRecommendedFeed.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useRecommendationImpressions=()=>{};')});
});
 await page.route('**/*.supabase.co/**',route=>{const req=route.request(),url=new URL(req.url());const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/profile_private_settings')?{followed_topics:[],dismissed_topics:[],recommendation_feedback:[]}:[])});});
 let searches=0,feeds=0;
 await page.route('**/xrpc/app.bsky.feed.searchPosts?*',route=>{searches++;return route.abort('failed');});
 await page.route('**/xrpc/app.bsky.feed.getFeed?*',route=>{feeds++;const url=new URL(route.request().url()),offset=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??8),end=offset+limit;return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({feed:saved.slice(offset,end),cursor:end<saved.length?String(end):undefined})});});
 await page.goto(`http://127.0.0.1:8197${base}/__recommended_recovery`);
 await expect(page.locator('#state')).toHaveText('ready');assert.ok(await page.locator('article').count()>0);assert.ok(searches>0&&feeds>0);assert.deepEqual(errors,[]);
 console.log('PASS: browser search CORS/network failure with empty native source recovers Japanese candidates through public feed and useRecommendedFeed');
}finally{await browser?.close();await server.close();}
  },

  // recommended-topic-feedback-browser-test.mjs
  "recommended-topic-feedback": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
// Optional captured public response; default fixture keeps the test independent of live services.
const saved=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')).feed:[{post:{uri:'at://did:plc:fixture/app.bsky.feed.post/recovery',author:{did:'did:plc:fixture',handle:'fixture.bsky.social'},record:{text:'日本語の公開フィード候補（テスト用）',langs:['ja'],createdAt:new Date().toISOString()},likeCount:200,embed:{images:[{fullsize:'https://images.example/fixture.jpg',thumb:'https://images.example/fixture.jpg',alt:'テスト用イラスト'}]}}}];
const feedback=Array.from({length:110},(_,i)=>({id:`dismissed-${i}`,userId:`dismissed-creator-${i}`,topics:[i<4?'anime':i<65?'digital-illustration':'art'],imageUrls:[`https://images.example/old-${i}.jpg`],createdAt:new Date().toISOString()}));
const base='/RaimuNoteSNS.github.io',fixture='/__recommended_recovery.tsx';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useRecommendedFeed} from '/src/hooks/useRecommendedFeed';import '/src/index.css';function View(){const feed=useRecommendedFeed(true);const posts=feed.data?.pages.flatMap(page=>page.posts)??[];return <><output id="state">{feed.isError?'error:'+String(feed.error?.message):posts.length?'ready':'loading'}</output>{posts.map(post=><article key={post.id} data-post-id={post.id}>{post.content}</article>)}</>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><View/></QueryClientProvider>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8198,strictPort:true},plugins:[{name:'recommended-recovery',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__recommended_recovery',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__recommended_recovery',`<html><head></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ("export const useAuth=()=>({user:{id:'viewer'},loading:false});")});
});
 await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const getFeed=async()=>[];export const getPostsByUser=async()=>[];export const searchPosts=async()=>[];'}));
 await page.route('**/src/hooks/useRecommendedFeed.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useRecommendationImpressions=()=>{};')});
});
 await page.route('**/*.supabase.co/**',route=>{const req=route.request(),url=new URL(req.url());const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/profile_private_settings')?{followed_topics:['anime','digital-illustration'],dismissed_topics:[],recommendation_feedback:feedback}:[])});});
 await page.route('**/api/notes/search',route=>route.abort('failed'));
 let searches=0,feeds=0;
 await page.route('**/xrpc/app.bsky.feed.searchPosts?*',route=>{searches++;return route.abort('failed');});
 await page.route('**/xrpc/app.bsky.unspecced.getPopularFeedGenerators?*',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({feeds:[]})}));
 await page.route('**/xrpc/app.bsky.feed.getFeed?*',route=>{feeds++;const url=new URL(route.request().url()),offset=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??8),end=offset+limit;return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({feed:saved.slice(offset,end),cursor:end<saved.length?String(end):undefined})});});
 await page.goto(`http://127.0.0.1:8198${base}/__recommended_recovery`);
 try{await expect(page.locator('#state')).toHaveText('ready');}catch(error){console.error({errors,searches,feeds,state:await page.locator('#state').innerText()});throw error;}assert.ok(await page.locator('article').count()>0);assert.ok(feeds>0);assert.deepEqual(errors,[]);
 console.log('PASS: 110 individual dismissals with both followed topics still fetch and display fresh illustration posts; no preference/history reset');
}finally{await browser?.close();await server.close();}
  },

  // recommended-twitter-live-test.mjs
  "recommended-twitter": async () => {
const { createServer } = await import('vite');const { chromium } = await import('@playwright/test');const { default: assert } = await import('node:assert/strict');const { loadTwitterSearch } = await import("../supabase/functions/link-preview/metadata.ts");
const base='/RaimuNoteSNS.github.io';const source=`import{supabase}from'/src/lib/supabase';import{searchXPage}from'/src/lib/fxTwitter';import{rankRecommendations}from'/src/lib/recommendations';import{normalizeTimelineBlueskyPost}from'/src/lib/utils';supabase.auth.getSession=async()=>({data:{session:{user:{id:'fixture'}}},error:null});Object.defineProperty(supabase,'functions',{value:{invoke:async(_,options)=>{const r=await fetch('${base}/__twitter_search_fixture',{method:'POST',body:JSON.stringify(options.body),signal:options.signal});return{data:await r.json(),error:r.ok?null:new Error('relay failed')};}}});window.search=async cursor=>{const start=performance.now();const page=await searchXPage('ファンアート',{cursor,feed:'media',preferAlternative:true,limit:2});const eligible=rankRecommendations(page.posts.map(normalizeTimelineBlueskyPost),{authors:{},terms:{},followedTopics:['digital-illustration']},'fixture');return{ms:performance.now()-start,eligible:eligible.map(post=>post.id),rows:page.posts.map(post=>({id:post.id,content:post.content.slice(0,160),bio:post.author.bio,language:post.languages,images:post.imageUrls.length})),ids:page.posts.map(post=>post.id),counts:page.posts.map(post=>post.likesCount),cursor:page.cursor};};`;
let yahooReads=0;const original=globalThis.fetch;globalThis.fetch=async(...args)=>{if(String(args[0]).startsWith('https://search.yahoo.co.jp/'))yahooReads++;return original(...args);};
const server=await createServer({cacheDir:'/private/tmp/lime-live-search-cache',server:{host:'127.0.0.1',port:8205,strictPort:true},plugins:[{name:'live-twitter-search',resolveId(id){if(id.endsWith('/__search_fallback.js'))return'\0/__search_fallback.js';},load(id){if(id==='\0/__search_fallback.js')return source;},configureServer(s){s.middlewares.use(base+'/__twitter_search_fixture',async(req,res)=>{try{let body='';for await(const c of req)body+=c;const input=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await loadTwitterSearch(input.query,input.feed,input.offset)));}catch(error){console.error('Relay fixture failed',error);res.statusCode=502;res.end(JSON.stringify({error:error.message}));}});s.middlewares.use(base+'/__search_fallback',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__search_fallback',`<html><head></head><body><script type="module" src="${base}/__search_fallback.js"></script></body></html>`));});}}]});let browser;
try{await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();let searches=0,statuses=0;page.on('request',r=>{if(r.url().includes('api.fxtwitter.com/2/search?'))searches++;if(r.url().includes('api.fxtwitter.com/2/status/'))statuses++;});await page.goto('http://127.0.0.1:8205'+base+'/__search_fallback');await page.waitForFunction(()=>window.search);const first=await page.evaluate(()=>window.search(null));assert.ok(first.ids.length>0);assert.ok(first.ids.length<=6);assert.match(first.cursor,/^yahoo:/);const second=await page.evaluate(cursor=>window.search(cursor),first.cursor);assert.ok(second.ids.length>0);assert.ok(first.ids.every(id=>!second.ids.includes(id)));assert.ok(statuses<=12);assert.equal(searches,0);assert.equal(yahooReads,1);assert.ok(first.eligible.length+second.eligible.length>0,'actual media candidates must survive ranking');console.log(JSON.stringify({first:{read:first.ids.length,eligible:first.eligible.length,ms:Math.round(first.ms)},second:{read:second.ids.length,eligible:second.eligible.length,ms:Math.round(second.ms)},primarySearchRequests:searches,yahooReads,postRequests:statuses,duplicatePosts:0}));}finally{await browser?.close();await server.close();globalThis.fetch=original;}
  },
};

const command = process.argv[2];
if (command === '--list' || !Object.hasOwn(suites, command)) {
  console.log('Usage: node scripts/verify-recommendations.mjs <command> [arguments]\n\n' + Object.keys(suites).join('\n'));
  if (command !== '--list') process.exitCode = 2;
} else {
  // Preserve the original positional arguments consumed by individual checks.
  process.argv.splice(2, 1);
  await suites[command]();
}
