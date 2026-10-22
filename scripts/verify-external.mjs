// Each command runs one original verification in its own process.
// Dependencies are loaded only after selecting that verification.
const suites = {
  // bluesky-video-browser-test.mjs
  "bluesky-video": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io';let bytes;
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {PostVideoPlayer} from '/src/components/video/PostVideoPlayer';import {Output,Mp4OutputFormat,BufferTarget,CanvasSource} from 'mediabunny';
const root=createRoot(document.getElementById('root'));
window.make=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');const target=new BufferTarget();const output=new Output({target,format:new Mp4OutputFormat({fastStart:'fragmented'})});const track=new CanvasSource(canvas,{codec:'avc',bitrate:500000});output.addVideoTrack(track);await output.start();for(let i=0;i<60;i++){ctx.fillStyle='#174d80';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='40px sans-serif';ctx.fillText('HLS '+i,80,180);await track.add(i/30,1/30);}await track.close();await output.finalize();return Array.from(new Uint8Array(target.buffer));};
window.show=async()=>{const externalVideo={playlist:location.origin+'/test.m3u8',width:640,height:360,duration:0};const post={id:'bsky:at://test',userId:'did:plc:test',source:'bluesky',content:'動画',externalVideo,imageUrls:[],createdAt:new Date().toISOString(),likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id:'did:plc:test',username:'test.bsky.social',displayName:'Bluesky動画',avatarUrl:'',bio:'',coverUrl:'',createdAt:new Date().toISOString()}};const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');const {BrowserRouter}=await import('react-router-dom');const {MediaLightboxRoot}=await import('/src/components/media/MediaLightbox');const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const next={...post,id:'x:991122',source:'x',content:'twitterの動画',author:{...post.author,id:'x-user:991',username:'artist@twitter.com'}};client.setQueryData(['post',next.id],next);client.setQueryData(['media-twitter-videos','video-fixture'],{pages:[{posts:[next],nextCursor:null}],pageParams:[undefined]});root.render(<QueryClientProvider client={client}><BrowserRouter><PostVideoPlayer postId={post.id} post={post} video={externalVideo} externalVideo={externalVideo}/><MediaLightboxRoot/></BrowserRouter></QueryClientProvider>);};`;
const server=await createServer({configFile:false,cacheDir:'/private/tmp/lime-bluesky-hls-cache',root:process.cwd(),base,resolve:{alias:{'@':process.cwd()+'/src'}},plugins:[(await import('@vitejs/plugin-react-swc')).default(),{name:'hls-fixture',resolveId(id){if(['/__hls.tsx',base+'/__hls.tsx'].includes(id))return '/__hls.tsx';},load(id){if(id==='/__hls.tsx')return fixture;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUser(){return null;} export async function getCurrentUserId(){return null;}';},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url==='/test.mp4'){res.setHeader('Content-Type','video/mp4');res.end(bytes);return;}if(req.url==='/test.m3u8'){let offset=0;while(offset<bytes.length){const size=bytes.readUInt32BE(offset);if(bytes.toString('ascii',offset+4,offset+8)==='moof')break;offset+=size;}res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end('#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="test.mp4",BYTERANGE="'+offset+'@0"\n#EXTINF:2.0,\n#EXT-X-BYTERANGE:'+(bytes.length-offset)+'@'+offset+'\ntest.mp4\n#EXT-X-ENDLIST\n');return;}if(req.url?.split('?')[0]===base+'/'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(base+'/', '<div id="root"></div><script type="module" src="'+base+'/__hls.tsx"></script>'));return;}next();});}}],server:{host:'127.0.0.1',port:8198}});
await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:1000,height:800},hasTouch:true});await page.addInitScript(()=>{const original=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type){return type.includes('mpegurl')?'':original.call(this,type);};});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ("export const useAuth=()=>({user:{id:'video-fixture'},loading:false});")});
});await page.route('**/src/api/search-news.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const getTwitterVideoPage=async()=>({posts:[],nextCursor:null});')});
});await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await page.goto('http://127.0.0.1:8198'+base+'/');await page.waitForFunction(()=>window.make);bytes=Buffer.from(await page.evaluate(()=>window.make()));await page.evaluate(()=>window.show());await page.getByRole('button',{name:'動画を再生',exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1&&v.videoWidth===640;});assert.ok(await page.locator('video').evaluate(v=>v.src.startsWith('blob:')),'Chrome uses MediaSource for HLS');await page.screenshot({path:'/private/tmp/lime-bluesky-video-desktop.png'});
await page.setViewportSize({width:390,height:740});await page.getByRole('button',{name:'動画を再生',exact:true}).click();const dialog=page.getByRole('dialog',{name:'動画を拡大表示'});await expect(dialog).toBeVisible();await page.waitForFunction(()=>{const v=document.querySelector('.lime-video-frame video');return v&&!v.paused&&v.currentTime>.1;});await page.screenshot({path:'/private/tmp/lime-bluesky-video-mobile.png'});await page.locator('.lime-video-frame video').tap();await expect(dialog).toHaveClass(/lime-media-controls-hidden/);await expect(page.getByLabel('動画の再生位置')).toBeHidden();assert.equal(await page.locator('.lime-video-frame video').evaluate(v=>v.paused),false);await page.waitForTimeout(400);await page.locator('.lime-video-frame video').tap();await expect(dialog).not.toHaveClass(/lime-media-controls-hidden/);await expect(page.getByLabel('動画の再生位置')).toBeVisible();await page.locator('.lime-video-frame video').dispatchEvent('pointerdown',{pointerId:21,pointerType:'touch',button:0,clientX:150,clientY:200});await page.locator('.lime-video-frame video').dispatchEvent('pointermove',{pointerId:21,pointerType:'touch',button:0,clientX:150,clientY:300});await page.locator('.lime-video-frame video').dispatchEvent('pointerup',{pointerId:21,pointerType:'touch',button:0,clientX:150,clientY:300});await expect(dialog.locator('.lime-media-mobile-summary p')).toContainText('twitterの動画');await page.waitForFunction(()=>{const v=document.querySelector('.lime-video-frame video');return v&&!v.paused;});await dialog.getByRole('button',{name:'動画を閉じる',exact:true}).click();await expect(dialog).toHaveCount(0);assert.deepEqual(errors,[]);console.log('PASS: actual Chrome HLS playback starts on one click; mobile overlay hides/restores controls without pausing, swipes to a twitter HLS video, and closes without errors.');}finally{await browser.close();await server.close();}
  },

  // fxtwitter-browser-test.mjs
  "fxtwitter": async () => {
const { createServer } = await import('vite');const { chromium, expect } = await import('@playwright/test');const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {QueryClient,QueryClientProvider}from '@tanstack/react-query';import{BrowserRouter}from'react-router-dom';import{PostCard}from'/src/components/feed/PostCard';import{MediaLightboxRoot}from'/src/components/media/MediaLightbox';import{mapXPost,xFeed}from'/src/lib/fxTwitter';import{normalizeTimelineBlueskyPost}from'/src/lib/utils';window.show=async()=>{const page=await xFeed({actor:'X@x.com'});const posts=page.posts.filter(p=>p.externalVideo||p.imageUrls.length).slice(0,2).map(normalizeTimelineBlueskyPost);window.fixturePosts=posts;const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><BrowserRouter>{posts.map(post=><PostCard key={post.id} post={post}/>)}<MediaLightboxRoot/></BrowserRouter></QueryClientProvider>);};`;
const server=await createServer({cacheDir:'/private/tmp/lime-fxtwitter-vite-cache',server:{host:'127.0.0.1',port:8199,strictPort:true},plugins:[{name:'fx-fixture',resolveId(id){if(['/__fx.tsx',base+'/__fx.tsx','\0/__fx.tsx'].includes(id))return '\0/__fx.tsx';},load(id){if(id==='\0/__fx.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return "export async function getCurrentUserId(){return null;}";},configureServer(s){s.middlewares.use(base+'/__fx_test',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__fx_test','<html><head></head><body><div id="root" style="max-width:700px;margin:auto"></div><script type="module" src="/__fx.tsx"></script></body></html>'));});}}]});
await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:1000,height:900}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await page.route('**/functions/v1/link-preview',r=>r.fulfill({status:200,contentType:'application/json',body:'{"preview":null}'}));await page.route('**/rest/v1/rpc/external_like_states',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await page.goto('http://127.0.0.1:8199'+base+'/__fx_test');await page.waitForFunction(()=>window.show);await page.evaluate(()=>window.show());await expect(page.locator('.post-video-start')).toBeVisible();assert.ok(await page.getByText('X',{exact:true}).count()>=1);await page.locator('.post-video-start').click();try{await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1;},null,{timeout:25000});}catch(e){console.error(await page.locator('.post-video-player').evaluate(n=>({text:n.textContent,src:n.querySelector('video').src,error:n.querySelector('video').error?.message,paused:n.querySelector('video').paused})));throw e;}await page.screenshot({path:'/private/tmp/lime-x-desktop.png'});await page.setViewportSize({width:390,height:740});await page.locator('.post-video-start').click();await expect(page.getByRole('dialog',{name:'動画を拡大表示'})).toBeVisible();await page.waitForFunction(()=>{const v=document.querySelector('.lime-video-frame video');return v&&!v.paused&&v.currentTime>.1;});await page.screenshot({path:'/private/tmp/lime-x-mobile.png'});await page.getByRole('button',{name:'動画を閉じる'}).click();assert.deepEqual(errors,[]);console.log('PASS: real FxTwitter posts render in shared cards; X video plays on desktop and mobile.');}finally{await browser.close();await server.close();}
  },

  // twitter-elements-browser-test.mjs
  "twitter-elements": async () => {
const { createServer } = await import('vite');const { chromium, expect } = await import('@playwright/test');const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io';
const source=`import React from'react';import{createRoot}from'react-dom/client';import'/src/index.css';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BrowserRouter,Routes,Route}from'react-router-dom';import SearchPage from'/src/pages/SearchPage';import PostDetail from'/src/pages/PostDetail';import Profile from'/src/pages/Profile';const root=createRoot(document.getElementById('root'));window.show=(kind,value)=>{const url=kind==='search'?'/search?q='+encodeURIComponent(value):kind==='profile'?'/u/'+encodeURIComponent(value):'/post/'+encodeURIComponent(value);history.replaceState({},'', '${base}'+url);localStorage.setItem('lime_search_page_tab','latest');const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});root.render(<QueryClientProvider key={value} client={client}><BrowserRouter basename="${base}"><Routes><Route path="search" element={<SearchPage/>}/><Route path="post/:id" element={<PostDetail/>}/><Route path="u/:username" element={<Profile/>}/></Routes></BrowserRouter></QueryClientProvider>);};`;
const server=await createServer({cacheDir:'/private/tmp/lime-twitter-elements-cache',server:{host:'127.0.0.1',port:8201,strictPort:true},plugins:[{name:'twitter-elements',resolveId(id){if(['/__twitter.tsx',base+'/__twitter.tsx','\0/__twitter.tsx'].includes(id))return '\0/__twitter.tsx';},load(id){if(id==='\0/__twitter.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUserId(){return null;}';},configureServer(s){s.middlewares.use(base+'/__twitter_test',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__twitter_test','<html><head></head><body><div id="root"></div><script type="module" src="/__twitter.tsx"></script></body></html>'));});}}]});
await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
const raw=(id,text,parent)=>({id,type:'status',text,author:{id:'123',name:'作者',screen_name:'artist',verification:{verified:true,type:'individual'}},created_timestamp:1792080000,likes:3,views:4811,reposts:0,quotes:0,bookmarks:0,...(parent?{replying_to:{screen_name:'artist',status:parent}}:{})});
try{const page=await browser.newPage({viewport:{width:1000,height:800}});const errors=[],searches=[],conversations=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await page.route('**/functions/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.route('https://api.fxtwitter.com/2/**',async r=>{const url=new URL(r.request().url());let body;if(url.pathname.endsWith('/search')){searches.push(url);body=url.searchParams.get('q').includes('失敗')?{code:404,results:[]}:{code:200,results:[raw(url.searchParams.has('cursor')?'502':'501',url.searchParams.has('cursor')?'猫の続きの投稿':'猫の最初の投稿')],cursor:{bottom:url.searchParams.has('cursor')?null:'next'}};}else if(url.pathname.includes('/conversation/')){conversations.push(url);body={code:200,status:raw('602','選択した返信','601'),thread:[raw('600','会話の先頭'),raw('601','親の投稿','600'),raw('602','選択した返信','601')],replies:[raw(url.searchParams.has('cursor')?'604':'603',url.searchParams.has('cursor')?'さらに続く返信':'子の返信',url.searchParams.has('cursor')?'603':'602')],cursor:{bottom:url.searchParams.has('cursor')?null:'more'}};}else if(url.pathname==='/2/profile/artist')body={code:200,user:raw('701','').author};else if(url.pathname.includes('/profile/artist/statuses'))body={code:200,results:[{type:'thread',statuses:[raw('701','プロフィールの親投稿'),raw('702','プロフィールの返信','701')]}],cursor:{bottom:null}};else body={code:200,users:[],results:[],cursor:{bottom:null}};await r.fulfill({status:body.code===404?404:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});});
await page.goto('http://127.0.0.1:8201'+base+'/__twitter_test');await page.waitForFunction(()=>window.show);await page.evaluate(()=>window.show('search','猫 source:twitter'));await expect(page.getByText('猫の最初の投稿',{exact:true})).toBeVisible();await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await expect(page.getByText('猫の続きの投稿',{exact:true})).toBeVisible();assert.equal(searches.length,2);assert.equal(searches[1].searchParams.get('cursor'),'next');assert.equal(searches[0].searchParams.get('feed'),'latest');await expect(page.getByRole('img',{name:'twitter認証済み'}).first()).toBeVisible();assert.ok(await page.getByText('twitter',{exact:true}).count());await expect(page.getByText('4,811 表示',{exact:true})).toHaveCount(0);await page.screenshot({path:'/private/tmp/lime-twitter-search.png'});
await page.evaluate(()=>window.show('search','失敗 source:twitter'));await expect(page.getByText(/twitterの代替検索にはLimeNoteへのログインが必要です/)).toBeVisible();await expect(page.getByText(/一致する結果はありません/)).toHaveCount(0);
await page.evaluate(()=>window.show('detail','x:602'));await expect(page.getByText('会話の先頭',{exact:true})).toBeVisible();await expect(page.getByText('親の投稿',{exact:true})).toBeVisible();await expect(page.getByText('選択した返信',{exact:true})).toBeVisible();await expect(page.getByText('子の返信',{exact:true})).toBeVisible();await page.getByRole('button',{name:'返信をさらに表示'}).click();await expect(page.getByText('さらに続く返信',{exact:true})).toBeVisible();assert.equal(conversations.length,2);await expect(page.getByRole('button',{name:'返信をさらに表示'})).toHaveCount(0);await page.screenshot({path:'/private/tmp/lime-twitter-conversation.png'});await page.evaluate(()=>window.show('profile','artist@twitter.com'));await expect(page.getByText('プロフィールの親投稿',{exact:true}).first()).toBeVisible();await expect(page.getByText('プロフィールの返信',{exact:true}).first()).toBeVisible();assert.ok(await page.getByRole('img',{name:'twitter認証済み'}).count()>=3);await expect(page.getByText('Bluesky',{exact:true})).toHaveCount(0);await expect(page.getByText('twitter',{exact:true}).first()).toBeVisible();await page.screenshot({path:'/private/tmp/lime-twitter-profile-thread.png'});assert.deepEqual(errors,[]);console.log('PASS: actual search screen displays twitter results and pagination; upstream failures are explicit; detail shows ancestors, replies and next-page replies; no summary metrics.');}finally{await browser.close();await server.close();}
  },

  // twitter-follow-search-browser-test.mjs
  "twitter-follow-search": async () => {
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const browser=await chromium.launch({channel:'chrome',headless:true});
const viewer='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
const external={id:'x-user:123',username:'Google@twitter.com',displayName:'Google',avatarUrl:'',bio:'Verified account',providerVerification:{provider:'twitter',type:'organization'}};
try{
 const page=await browser.newPage(),errors=[],saves=[];let followed=true;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + (`export const useAuth=()=>({user:{id:'${viewer}',username:'fixture',displayName:'Fixture',avatarUrl:''},loading:false,accounts:[],session:null});export const AuthProvider=({children})=>children;`)});
});
 await page.route('**/*.supabase.co/**',route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']??'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.pathname.endsWith('/market-data'))return route.continue();
  let data=[];
  if(url.pathname.endsWith('/profiles')&&url.searchParams.get('username')==='eq.owner')data={id:owner,username:'owner',display_name:'Owner'};
  if(url.pathname.endsWith('/follows')&&url.searchParams.get('select')?.includes('profile:profiles'))data=[{profile:null,external_provider:'x',external_handle:'google',external_profile:external}];
  if(url.pathname.endsWith('/external_account_users'))data=followed?[{provider:'x',handle:'google'}]:[];
  if(url.pathname.endsWith('/rpc/set_external_follow')){const body=JSON.parse(request.postData());saves.push(body);followed=body.enabled;data=null;}
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('https://public.api.bsky.app/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{"actors":[],"posts":[]}'}));
 await page.route('https://misskey.io/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'[]'}));
 await page.route('https://api.fxtwitter.com/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({code:200,users:[{id:'123',screen_name:'Google',name:'Google',verification:{verified:true,type:'organization'}}]})}));
 for(const width of [390,1280]){
  followed=true;await page.setViewportSize({width,height:900});
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/u/owner/followers_following?tab=following');
  const row=page.getByRole('article',{name:'Google'});
  await expect(row.getByAltText('twitter認証済み')).toBeVisible();
  await row.getByRole('button',{name:/フォロー中|フォロー解除/}).click();
  await expect(row.getByRole('button',{name:'フォロー',exact:true})).toBeEnabled();
  assert.equal(saves.at(-1).provider,'x');assert.equal(saves.at(-1).enabled,false);
  await row.getByRole('button',{name:'フォロー',exact:true}).click();
  await expect(row.getByRole('button',{name:/フォロー中|フォロー解除/})).toBeEnabled();assert.equal(saves.at(-1).enabled,true);
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/search');
  const input=page.getByPlaceholder('検索').filter({visible:true});await input.fill('Google');
  const suggestion=page.getByRole('button').filter({has:page.getByAltText('twitter認証済み')}).filter({hasText:'Google'});
  await expect(suggestion).toBeVisible({timeout:20000});
  console.log(JSON.stringify({width,followToggle:true,followBadge:true,suggestionBadge:true}));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
  },

  // twitter-live-detail-browser-test.mjs
  "twitter-live-detail": async () => {
const { createServer } = await import('vite');const { chromium, expect } = await import('@playwright/test');const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',id='2110766445940572599';
const source=`import React from'react';import{createRoot}from'react-dom/client';import'/src/index.css';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{MemoryRouter,Routes,Route}from'react-router-dom';import PostDetail from'/src/pages/PostDetail';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/post/x:${id}']}><Routes><Route path="post/:id" element={<PostDetail/>}/></Routes></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({cacheDir:'/private/tmp/lime-twitter-live-detail-cache',server:{host:'127.0.0.1',port:8203,strictPort:true},plugins:[{name:'twitter-live-detail',resolveId(id){if(id.endsWith('/__twitter_live.tsx'))return '\0/__twitter_live.tsx';},load(id){if(id==='\0/__twitter_live.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUserId(){return null;}';},configureServer(s){s.middlewares.use(base+'/__twitter_live',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__twitter_live',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="max-width:700px;margin:auto"></div><script type="module" src="${base}/__twitter_live.tsx"></script></body></html>`));});}}]});
let browser;try{await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});for(const width of [1000,390]){const page=await browser.newPage({viewport:{width,height:850}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await page.route('**/functions/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));await page.goto('http://127.0.0.1:8203'+base+'/__twitter_live');await expect(page.locator('[data-lime-conversation-comment]').first()).toBeVisible({timeout:30000});const count=await page.locator('[data-lime-conversation-comment]').count();assert.ok(count>0);await page.waitForFunction(()=>[...document.images].some(im=>im.alt==='Google'&&im.complete&&im.naturalWidth>=400),null,{timeout:15000});console.log('Replies rendered with a 400px Google avatar',width,count);await page.screenshot({path:`/private/tmp/lime-google-replies-${width}.png`});assert.deepEqual(errors,[]);await page.close();}}finally{await browser?.close();await server.close();}
  },

  // twitter-quote-layout-browser-test.mjs
  "twitter-quote-layout": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io';
const post={id:'x:2110000000000000001',source:'x',userId:'x-user:123',content:'引用した投稿',imageUrls:[],createdAt:'2026-10-16',likesCount:12,commentsCount:12,repostsCount:0,repostedByMe:false,author:{id:'x-user:123',username:'artist@twitter.com',displayName:'作者',avatarUrl:''},isQuote:true};
post.parentPost={...post,id:'x:2110000000000000002',content:'引用元の本文',isQuote:false,externalVideo:{playlist:'https://video.example.test/clip.mp4',format:'mp4',thumbnail:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><path fill="#467b91" d="M0 0h720v1280H0z"/><path fill="#edbc70" d="M0 0h720v160H0zM0 1120h720v160H0z"/><text x="190" y="650" fill="white" font-size="60" font-family="sans-serif">PORTRAIT</text></svg>'),duration:27,width:360,height:640}};
const reply={...post,id:'x:2110000000000000003',content:'@artist @another 返信本文 @intentional',isQuote:false,parentPost:undefined,externalReplyToId:post.id,externalReplyToUsername:'artist@twitter.com'};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {PostCard} from '/src/components/feed/PostCard';import {ReplyChain} from '/src/components/post/CommentList';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ReplyChain><PostCard thread post={${JSON.stringify(post)}}/><PostCard thread post={${JSON.stringify(reply)}}/></ReplyChain></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({cacheDir:'/private/tmp/lime-quote-layout-cache',server:{host:'127.0.0.1',port:8204,strictPort:true},plugins:[{name:'quote-layout',resolveId(id){if(id.endsWith('/__quote_layout.tsx'))return '\0/__quote_layout.tsx';},load(id){if(id==='\0/__quote_layout.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUserId(){return null;}';},configureServer(s){s.middlewares.use(base+'/__quote_layout',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__quote_layout',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="max-width:1100px;margin:auto"></div><script type="module" src="${base}/__quote_layout.tsx"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 const generator=await browser.newPage();
 await generator.goto('http://127.0.0.1:8204'+base+'/');
 const clip=Buffer.from(await generator.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
  const context=canvas.getContext('2d');context.fillStyle='#467b91';context.fillRect(0,0,720,1280);
  context.fillStyle='#edbc70';context.fillRect(0,0,720,160);context.fillRect(0,1120,720,160);
  context.fillStyle='white';context.font='60px sans-serif';context.fillText('PORTRAIT',190,650);
  const redraw=setInterval(()=>{context.fillStyle='#467b91';context.fillRect(0,700,720,10);},80);
  context.scale(.5,.5);context.fillStyle='#467b91';context.fillRect(0,0,720,1280);context.fillStyle='#edbc70';context.fillRect(0,0,720,160);context.fillRect(0,1120,720,160);context.fillStyle='white';context.fillText('PORTRAIT',190,650);
  const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
  const finished=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer())));});
  recorder.start();await new Promise(resolve=>setTimeout(resolve,1500));recorder.stop();clearInterval(redraw);const result=await finished;stream.getTracks().forEach(track=>track.stop());return result;
 }));await generator.close();
 for(const width of [1400,1000,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.route('**/functions/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await page.route('https://video.example.test/**',r=>r.fulfill({contentType:'video/webm',headers:{'access-control-allow-origin':'*'},body:clip}));
  await page.addInitScript(()=>{window.quoteOverlayOpened=false;window.addEventListener('lime-open-media-viewer',()=>window.quoteOverlayOpened=true);});
  await page.goto('http://127.0.0.1:8204'+base+'/__quote_layout');
  const quote=page.locator('[data-lime-quoted-post]'),frame=quote.locator('.post-video-player');await expect(frame).toBeVisible();await expect(frame.locator('img')).toHaveCSS('object-fit','cover');
  const quoteBox=await quote.boundingBox(),videoBox=await frame.boundingBox();
  assert.ok(videoBox.width>=quoteBox.width-4&&videoBox.width<=quoteBox.width,JSON.stringify({quoteBox,videoBox}));


  assert.ok(Math.abs(videoBox.height/videoBox.width-9/16)<.01);
  await expect(quote.locator('[data-lime-thread-avatar]')).toHaveCount(0);
  await expect(quote.locator('[data-lime-thread-item]')).toHaveCount(0);
  const lines=page.locator('[data-lime-reply-chain] > [data-lime-thread-lines] > line');await expect(lines).toHaveCount(1);
  const line=await lines.boundingBox();assert.ok(line.x<quoteBox.x,JSON.stringify({line,quoteBox}));
  const text=page.locator('[data-lime-comment-card] [data-lime-post-body] p').filter({hasText:'返信本文'});
  await expect(text).toHaveText('返信本文 @intentional');
  await expect(page.getByText('返信先:',{exact:false}).first()).toContainText('@artist');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/private/tmp/lime-twitter-quote-${width}.png`});
  await frame.getByRole('button',{name:'動画を再生',exact:true}).click();
  const media=frame.locator('video');
  await media.evaluate(video=>{video.loop=true;});
  await expect.poll(()=>media.evaluate(video=>!video.paused&&video.currentTime>0&&video.videoHeight>video.videoWidth)).toBe(true);
  await expect(media).toHaveCSS('object-fit','contain');await expect(frame).toHaveCSS('background-color','rgb(0, 0, 0)');
  const playingBox=await frame.boundingBox();assert.equal(playingBox.width,videoBox.width);assert.equal(playingBox.height,videoBox.height);
  assert.equal(await page.evaluate(()=>window.quoteOverlayOpened),false);
  await page.mouse.move(0,0);await expect(frame.locator('.post-video-controls')).toHaveCSS('opacity','0');await page.screenshot({path:`/private/tmp/lime-twitter-quote-playing-${width}.png`});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,quotedVideoWidth:videoBox.width,quotedVideoHeight:videoBox.height,inlinePlayback:true,playingFit:'contain',unchangedFrame:true,connectionLines:1,recipientsHidden:true}));
  await page.close();
 }
}finally{await browser?.close();await server.close();}
  },

  // twitter-search-fallback-live-test.mjs
  "twitter-search-fallback": async () => {
const { createServer } = await import('vite');const { chromium } = await import('@playwright/test');const { default: assert } = await import('node:assert/strict');const { loadTwitterSearch } = await import("../supabase/functions/link-preview/metadata.ts");
const base='/RaimuNoteSNS.github.io';const source=`import{supabase}from'/src/lib/supabase';import{searchXPage}from'/src/lib/fxTwitter';supabase.auth.getSession=async()=>({data:{session:{user:{id:'fixture'}}},error:null});Object.defineProperty(supabase,'functions',{value:{invoke:async(_,options)=>{const r=await fetch('${base}/__twitter_search_fixture',{method:'POST',body:JSON.stringify(options.body),signal:options.signal});return{data:await r.json(),error:r.ok?null:new Error('relay failed')};}}});window.search=async cursor=>{const page=await searchXPage('JR東日本',{cursor});return{ids:page.posts.map(post=>post.id),counts:page.posts.map(post=>post.likesCount),cursor:page.cursor};};`;
let yahooReads=0;const original=globalThis.fetch;globalThis.fetch=async(...args)=>{if(String(args[0]).startsWith('https://search.yahoo.co.jp/'))yahooReads++;return original(...args);};
const server=await createServer({cacheDir:'/private/tmp/lime-live-search-cache',server:{host:'127.0.0.1',port:8205,strictPort:true},plugins:[{name:'live-twitter-search',resolveId(id){if(id.endsWith('/__search_fallback.js'))return'\0/__search_fallback.js';},load(id){if(id==='\0/__search_fallback.js')return source;},configureServer(s){s.middlewares.use(base+'/__twitter_search_fixture',async(req,res)=>{try{let body='';for await(const c of req)body+=c;const input=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await loadTwitterSearch(input.query,input.feed,input.offset)));}catch(error){console.error('Relay fixture failed',error);res.statusCode=502;res.end(JSON.stringify({error:error.message}));}});s.middlewares.use(base+'/__search_fallback',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__search_fallback',`<html><head></head><body><script type="module" src="${base}/__search_fallback.js"></script></body></html>`));});}}]});let browser;
try{await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();let searches=0,statuses=0;page.on('request',r=>{if(r.url().includes('api.fxtwitter.com/2/search?'))searches++;if(r.url().includes('api.fxtwitter.com/2/status/'))statuses++;});await page.goto('http://127.0.0.1:8205'+base+'/__search_fallback');await page.waitForFunction(()=>window.search);const first=await page.evaluate(()=>window.search(null));assert.ok(first.ids.length>0);assert.ok(first.ids.length<=6);assert.match(first.cursor,/^yahoo:/);const second=await page.evaluate(cursor=>window.search(cursor),first.cursor);assert.ok(second.ids.length>0);assert.ok(first.ids.every(id=>!second.ids.includes(id)));assert.ok(statuses<=12);assert.equal(searches,1);assert.equal(yahooReads,1);console.log(JSON.stringify({first:first.ids.length,second:second.ids.length,primarySearchRequests:searches,yahooReads,postRequests:statuses,duplicatePosts:0}));}finally{await browser?.close();await server.close();globalThis.fetch=original;}
  },
};

const command = process.argv[2];
if (command === '--list' || !Object.hasOwn(suites, command)) {
  console.log('Usage: node scripts/verify-external.mjs <command> [arguments]\n\n' + Object.keys(suites).join('\n'));
  if (command !== '--list') process.exitCode = 2;
} else {
  // Preserve the original positional arguments consumed by individual checks.
  process.argv.splice(2, 1);
  await suites[command]();
}
