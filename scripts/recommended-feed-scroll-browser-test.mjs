import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
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
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:"export const useAuth=()=>({user:{id:'fixture-viewer'},loading:false});"}));
 await page.route('**/src/components/feed/PostCard.tsx*',route=>route.fulfill({contentType:'application/javascript',body:"import React from '/RaimuNoteSNS.github.io/node_modules/.vite/deps/react.js';export function PostCard({post}){return React.createElement('article',{'data-test-post':post.id,style:{height:180}},post.content);}".replace('height:180',checkAnimation?'height:20':'height:180')}));
 await page.route('**/src/components/feed/PostComposer.tsx*',route=>route.fulfill({contentType:'application/javascript',body:'export const PostComposer=()=>null;'}));
 await page.route('**/src/hooks/useTimelineFeed.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const useTimelineFeed=()=>({data:{pages:[]}});'}));
 await page.route('**/src/hooks/useLists.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const useListFeed=()=>({data:{pages:[]}});export const useListCatalog=()=>({data:[]});'}));
 await page.route('**/src/hooks/useRecommendationImpressions.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const useRecommendationImpressions=()=>{};'}));
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
