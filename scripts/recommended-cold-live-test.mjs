import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// No response interception, seeded visual cache, saved timeline, or saved login.
// Public accounts/interests are explicit test input; all source and model reads are real.
const base='/RaimuNoteSNS.github.io',entry='/__recommendation_cold_live.tsx';
const source=`
 import React,{useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';
 import {getRecommendationContinuation} from '/src/api/recommendation-continuation';
 import {createRecommendationCursor} from '/src/api/recommendations';
 const handles=['nagomi_yyd@twitter.com','rurudo_@twitter.com','kantoku_5th@twitter.com'];
 const cursor=createRecommendationCursor(handles);cursor.preferences={authors:Object.fromEntries(handles.map(h=>[h,3])),followedAuthors:handles,terms:{},followedTopics:['digital-illustration']};
 if(!window.__recommendedColdRun){window.__recommendedColdRun=true;
 window.live={started:performance.now(),steps:[],count:0,done:false,source:'real-public-sources',coldVisualCache:true};
 const root=createRoot(document.getElementById('root'));
 function Cards({posts}){useLayoutEffect(()=>{window.live.renderedCount=posts.length;window.live.renderMs=Math.round(performance.now()-window.live.started);},[posts]);return posts.map(post=><article key={post.id} data-post-id={post.id}>{post.author.displayName??post.author.username}<p>{post.content}</p></article>);}
 setTimeout(()=>{window.live.countAt500=document.querySelectorAll('article[data-post-id]').length;},500);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('Live test deadline','TimeoutError')),90000);
 getRecommendationContinuation(cursor,null,controller.signal,page=>{
  window.live.count=page.posts.length;window.live.steps.push({ms:Math.round(performance.now()-window.live.started),count:page.posts.length});
  root.render(<Cards posts={page.posts}/>);
 }).then(page=>{window.live.ids=page.posts.map(p=>p.id);window.live.services=page.posts.map(p=>p.source);window.live.error=page.visualError?.message??page.twitterError?.message;},error=>{window.live.error=String(error?.message??error);}).finally(()=>{clearTimeout(timer);window.live.elapsedMs=Math.round(performance.now()-window.live.started);window.live.done=true;});
 }
`;
const server=await createServer({cacheDir:'/private/tmp/lime-real-cold-vite-cache',server:{host:'127.0.0.1',port:8214,strictPort:true},plugins:[{name:'real-cold-recommendation-test',resolveId(id){if(id===entry||id===base+entry||id==='\0'+entry)return '\0'+entry;},load(id){if(id==='\0'+entry)return source;},configureServer(s){s.middlewares.use(base+'/__recommendation_cold_live',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__recommendation_cold_live',`<html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="${base}${entry}"></script></body></html>`));});}}]});
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
 const result=await page.evaluate(()=>window.live);const output={...result,catalogReads,networkProfile:process.env.RECOMMENDATION_TEST_NETWORK??'unthrottled-local',preferences:'explicit-public-test-input-without-account-authentication',timingScope:'candidate-HTTP-read-ranking-and-card-DOM; image-analysis-prepared-on-server',requests,network,consoleErrors,pageErrors:errors};
 await writeFile('/private/tmp/lime-recommended-cold-live-result.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
 if(result.countAt500<20)process.exitCode=1;
}finally{await browser?.close();await server.close();}
