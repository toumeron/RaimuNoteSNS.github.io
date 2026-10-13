import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base='/RaimuNoteSNS.github.io',fixture='/__poll_surfaces.tsx';
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333';
const poll={options:[{label:'猫',votes:0},{label:'犬',votes:0}],endsAt:new Date(Date.now()+86400000).toISOString()};
const profile={id:owner,username:'author',display_name:'Author',avatar_url:'',is_private:false};
const row={id,user_id:owner,content:'好きな動物は？',image_urls:[],created_at:new Date().toISOString(),visibility:'public',likes_count:871,comments_count:7,reposts_count:2345,poll,profiles:profile};
const post={...row,userId:owner,imageUrls:[],createdAt:row.created_at,likesCount:871,commentsCount:7,repostsCount:2345,author:{id:owner,username:'author',displayName:'Author',avatarUrl:''}};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter,Routes,Route} from 'react-router-dom';import PostDetail from '/src/pages/PostDetail';import {MiniPostPreviewCard} from '/src/pages/ChatPage';import {ProfileThreadEmbeds} from '/src/pages/Profile';import {QuotedPost} from '/src/components/feed/QuotedPost';import {ChatPostPreview} from '/src/components/ai/ChatPostPreview';import {MediaLightbox} from '/src/components/media/MediaLightbox';import '/src/index.css';const client=new QueryClient({defaultOptions:{queries:{retry:false}}});window.__mediaFixtureClient=client;window.addEventListener('media-count-fixture',()=>client.setQueryData(['post','11111111-1111-4111-8111-111111111111'],{...post,likesCount:872,repostsCount:2346,commentsCount:8}));const mode=new URLSearchParams(location.search).get('mode');const post=${JSON.stringify(post)};createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/post/${id}']}><div style={{maxWidth:640,margin:'auto'}}>{mode==='detail'?<Routes><Route path='/post/:id' element={<PostDetail/>}/></Routes>:mode==='quote'?<QuotedPost post={post}/>:mode==='profile'?<ProfileThreadEmbeds item={post} imageTarget={{targetType:'post',targetId:post.id,postId:post.id}} onImageClick={()=>{}} onImageError={()=>{}}/>:mode==='ai'?<MiniPostPreviewCard post={{...post,sourceUrl:'https://toumeron.github.io/RaimuNoteSNS.github.io/post/'+post.id,authorUsername:'author',authorDisplayName:'Author',authorAvatarUrl:null,authorIsOfficial:false}}/>:mode==='media'?<MediaLightbox selection={{post,url:'https://example.test/image.png',media:[{src:'https://example.test/image.png'}]}} onClose={()=>{}}/>:<ChatPostPreview content={'https://toumeron.github.io/RaimuNoteSNS.github.io/post/${id}'} fallback={<p>loading preview</p>}/>}</div></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8194,strictPort:true},plugins:[{name:'poll-surfaces-fixture',transform(code,id){if(id.includes('/src/pages/ChatPage.tsx'))return code+'\nexport {MiniPostPreviewCard};';if(id.includes('/src/pages/Profile.tsx'))return code+'\nexport {ProfileThreadEmbeds};';},resolveId(value){if(value===fixture||value===base+fixture||value==='\0'+fixture)return '\0'+fixture;},load(value){if(value==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__poll',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__poll',`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.stack));
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:{id:'${viewer}',username:'viewer',displayName:'Viewer',avatarUrl:''},loading:false});export const AuthProvider=({children})=>children;`}));
 await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${viewer}';`}));
 let selected=null;
 await page.route('**/*.supabase.co/**',route=>{
  const req=route.request(),url=new URL(req.url());const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  let data=[];
  if(url.pathname.endsWith('/poll_votes')) {if(req.method()==='POST'){selected=JSON.parse(req.postData()).option_index;data=null;}else data=selected===null?null:{option_index:selected};}
  if(url.pathname.endsWith('/posts'))data=url.searchParams.get('select')==='poll'?{poll:{...poll,options:poll.options.map((option,i)=>({...option,votes:selected===i?1:0}))}}:row;
  if(url.pathname.endsWith('/profiles')&&req.headers()['accept']?.includes('object'))data=profile;
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('https://example.test/image.png',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')}));
 await mkdir('/private/tmp/lime-poll-surfaces',{recursive:true});
 for(const width of [320,390,1280])for(const dark of [false,true]){
  await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:8194${base}/__poll?mode=media`);await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
  const row=page.locator('.lime-media-bottom [data-lime-post-actions]');await expect(row).toBeVisible();
  if(width<768){
   const groupStyle=await row.locator(':scope > div:last-child').evaluate(el=>({blur:getComputedStyle(el).backdropFilter,background:getComputedStyle(el).backgroundColor}));
   assert.equal(groupStyle.blur,'none');assert.equal(groupStyle.background,'rgba(0, 0, 0, 0)');
  }
  const verify=async()=>{
   const metrics=await row.evaluate(el=>[...el.querySelectorAll(':scope > :nth-child(-n+4)')].map(button=>{const box=button.getBoundingClientRect();return {x:box.x,right:box.right,width:box.width,counts:[...button.querySelectorAll('.tabular-nums')].filter(c=>c.getBoundingClientRect().width).map(c=>{const r=c.getBoundingClientRect();return {left:r.left,right:r.right};})};}));
   for(const button of metrics){assert.ok(button.x>=0&&button.right<=width,JSON.stringify(button));for(const count of button.counts){assert.ok(count.left>=button.x&&count.right<=button.right,JSON.stringify(button));}}
  };
  await page.waitForFunction(()=>window.__mediaFixtureClient.getQueryState(['post','11111111-1111-4111-8111-111111111111'])?.fetchStatus==='idle');
  await expect(row.locator('.repost-count')).toHaveAttribute('aria-label','2,345');
  await verify();
  // Update the cached post while the viewer remains mounted to exercise animated counters.
  await page.evaluate(()=>window.dispatchEvent(new Event('media-count-fixture')));
  await expect(row.locator('.repost-count.is-up')).toHaveCount(1);
  for(let i=0;i<5;i++){await verify();await page.waitForTimeout(50);}
  await page.screenshot({path:`/private/tmp/lime-media-counts-${width}-${dark}.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS: media action backgrounds contain static and animated counts at 320/390/1280px in light/dark');
}finally{await browser?.close();await server.close();}
