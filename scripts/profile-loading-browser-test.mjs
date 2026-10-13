import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io',fixture='/__profile_loading.tsx';
const author='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333';
const profile={id:author,username:'author',display_name:'Author',avatar_url:'',is_private:false,created_at:'2026-10-01T00:00:00Z'};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter,Routes,Route} from 'react-router-dom';import Profile from '/src/pages/Profile';import '/src/index.css';const client=new QueryClient({defaultOptions:{queries:{retry:false}}});window.client=client;document.documentElement.setAttribute('data-lime-mobile-profile-page','true');createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/u/author']}><Routes><Route path='/u/:username' element={<Profile/>}/></Routes></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8196,strictPort:true},plugins:[{name:'profile-loading',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__profile_loading',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__profile_loading',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:{id:'${viewer}',username:'viewer',displayName:'Viewer',avatarUrl:''},loading:false});`}));
 await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${viewer}';`}));
 await page.route('**/src/hooks/useProfile.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const empty={data:{pages:[]},isPending:false,isLoading:false,isError:false,hasNextPage:false,isFetchingNextPage:false,fetchNextPage:async()=>{},refetch:async()=>{}};export const useProfile=()=>({data:{id:'${author}',username:'author',displayName:'Author',avatarUrl:'',coverUrl:'',bio:'',createdAt:'2026-10-01',isPrivate:false},isLoading:false,isError:false});export const useFollowStats=()=>({data:{followers:0,following:0,canView:true}});export const useUserLikesInfinite=()=>empty;export const useUserMediaInfinite=()=>empty;export const useUserReactionsInfinite=()=>empty;export const useToggleFollow=()=>({mutate:()=>{},isPending:false});export const followStatsKey=id=>['follow-stats',id];export const profileKey=id=>['profile',id];`}));
 await page.route('**/src/hooks/useProfileHighlights.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const useProfileHighlights=()=>({data:{pages:[]},isPending:false,isLoading:false,isError:false});'}));
 await page.route('**/node_modules/.vite/deps/react-intersection-observer.js*',route=>route.fulfill({contentType:'application/javascript',body:'export const useInView=(options)=>({ref:()=>{},inView:!!options?.initialInView});'}));
 let postDelay=650,replyDelay=30;const commentRanges=[];
 const post={id:'11111111-1111-4111-8111-111111111111',user_id:author,content:'通常ポストの本文',created_at:'2026-10-13T06:10:00Z',image_urls:[],visibility:'public',profiles:profile,likes_count:0,comments_count:0,reposts_count:0};
 const reply={id:'44444444-4444-4444-8444-444444444444',user_id:author,post_id:post.id,content:'返信の本文',created_at:'2026-10-13T06:00:00Z',image_urls:[],parent_comment_id:null,likes_count:0};
 await page.route('**/*.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url());const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});let data=[];
  if(url.pathname.endsWith('/posts')){if(url.searchParams.has('user_id'))await new Promise(resolve=>setTimeout(resolve,postDelay));data=[post];}
  if(url.pathname.endsWith('/profiles'))data=profile;
  if(url.pathname.endsWith('/comments')&&url.searchParams.has('user_id')){commentRanges.push([req.headers().range,url.searchParams.get('limit'),url.searchParams.get('offset')]);await new Promise(resolve=>setTimeout(resolve,replyDelay));data=[reply];}
  if(req.headers().accept?.includes('object')&&Array.isArray(data))data=data[0]??null;
  await route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 for(const repliesFirst of [true,false]){
  postDelay=repliesFirst?650:30;replyDelay=repliesFirst?30:650;await page.goto(`http://127.0.0.1:8196${base}/__profile_loading`);
  await page.waitForFunction(()=>window.client?.getQueryState(['posts','user','22222222-2222-4222-8222-222222222222','activity','33333333-3333-4333-8333-333333333333'])?.fetchStatus==='fetching');
  await page.waitForTimeout(150);const list=page.locator('[data-lime-profile-posts]');await expect(list.getByText('返信の本文',{exact:true})).toHaveCount(0);await expect(list.getByText('通常ポストの本文',{exact:true})).toHaveCount(0);
  try{await expect(list.getByText('返信の本文',{exact:true})).toBeVisible();}catch(error){console.error({errors,text:await list.innerText()});throw error;}
  await expect(list.getByText('通常ポストの本文',{exact:true}).first()).toBeVisible();
  const text=await list.innerText();assert.ok(text.indexOf('通常ポストの本文')<text.indexOf('返信の本文'));
  await page.evaluate(()=>document.documentElement.setAttribute('data-lime-mobile-profile-page','true'));
  const light=await page.evaluate(()=>({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor}));assert.equal(light.html,light.body);assert.notEqual(light.body,'rgba(0, 0, 0, 0)');assert.notEqual(light.body,'rgb(255, 255, 255)');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)');
 }
 await page.getByRole('tab',{name:'すべて',exact:true}).click();await page.getByRole('menuitem',{name:/並び替え/}).click();await page.getByRole('menuitem',{name:'人気順',exact:true}).click();
 await expect(page.locator('[data-lime-profile-posts]').getByText('返信の本文',{exact:true})).toBeVisible();
 assert.ok(commentRanges.every(([range,limit])=>range==='0-19'||limit==='20'||range==='0-99'||limit==='100'),JSON.stringify(commentRanges));assert.deepEqual(errors,[]);console.log('PASS: replies/posts finish in either order but render together, chronological; first reply read is bounded to 20; theme fills profile canvas');
}finally{await browser?.close();await server.close();}
