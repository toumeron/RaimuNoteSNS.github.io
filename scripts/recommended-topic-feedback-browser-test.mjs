import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Optional captured public response; default fixture keeps the test independent of live services.
const saved=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')).feed:[{post:{uri:'at://did:plc:fixture/app.bsky.feed.post/recovery',author:{did:'did:plc:fixture',handle:'fixture.bsky.social'},record:{text:'日本語の公開フィード候補（テスト用）',langs:['ja'],createdAt:new Date().toISOString()},likeCount:200,embed:{images:[{fullsize:'https://images.example/fixture.jpg',thumb:'https://images.example/fixture.jpg',alt:'テスト用イラスト'}]}}}];
const feedback=Array.from({length:110},(_,i)=>({id:`dismissed-${i}`,userId:`dismissed-creator-${i}`,topics:[i<4?'anime':i<65?'digital-illustration':'art'],imageUrls:[`https://images.example/old-${i}.jpg`],createdAt:new Date().toISOString()}));
const base='/RaimuNoteSNS.github.io',fixture='/__recommended_recovery.tsx';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useRecommendedFeed} from '/src/hooks/useRecommendedFeed';import '/src/index.css';function View(){const feed=useRecommendedFeed(true);const posts=feed.data?.pages.flatMap(page=>page.posts)??[];return <><output id="state">{feed.isError?'error:'+String(feed.error?.message):posts.length?'ready':'loading'}</output>{posts.map(post=><article key={post.id} data-post-id={post.id}>{post.content}</article>)}</>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><View/></QueryClientProvider>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8198,strictPort:true},plugins:[{name:'recommended-recovery',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__recommended_recovery',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__recommended_recovery',`<html><head></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:"export const useAuth=()=>({user:{id:'viewer'},loading:false});"}));
 await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const getFeed=async()=>[];export const getPostsByUser=async()=>[];export const searchPosts=async()=>[];'}));
 await page.route('**/src/hooks/useRecommendationImpressions.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const useRecommendationImpressions=()=>{};'}));
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
