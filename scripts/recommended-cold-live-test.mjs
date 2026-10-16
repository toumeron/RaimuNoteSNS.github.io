import {createServer,build,loadEnv} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {createServer as httpServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

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
