// Each command runs one original verification in its own process.
// Dependencies are loaded only after selecting that verification.
const suites = {
  "search-account-results":async()=>{
    const {createServer}=await import('vite');const {chromium,webkit,expect}=await import('@playwright/test');const assert=(await import('node:assert/strict')).default;
    const base='/RaimuNoteSNS.github.io',port=8198;
    const users=[{id:'x-user:1',username:'Nakkar7@twitter.com',displayName:'かなめなか　11/1北海道コミティア・F36',bio:'かわいいイラストレーター　SHOP https://shop.example/art 感想とか！',providerVerification:{provider:'twitter',type:'individual'}},{id:'x-user:2',username:'nakkar715@twitter.com',displayName:'なっかー',bio:'勝二→水工→国際航空専門学校　よろしくお願いします'},{id:'x-user:3',username:'Nakkar75193@twitter.com',displayName:'Nakka ramudu Ramudu',isPrivate:true}];
    const source=`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{UserCard}from'/src/components/search/SearchExploreContent';import'/src/index.css';document.documentElement.classList.toggle('dark',location.search.includes('dark=1'));createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><main style={{maxWidth:640,margin:'auto'}}>${users.map(user=>`<UserCard result user={${JSON.stringify({...user,avatarUrl:'',createdAt:'2026-10-20'})}}/>`).join('')}</main></MemoryRouter></QueryClientProvider>);`;
    const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true},plugins:[{name:'search-account-fixture',resolveId(id){if(id.endsWith('/__accounts.tsx'))return '\0/__accounts.tsx';},load(id){if(id==='\0/__accounts.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUserId(){return null;}';},configureServer(server){server.middlewares.use(base+'/__accounts',async(_,res)=>{res.setHeader('content-type','text/html');res.end(await server.transformIndexHtml(base+'/__accounts',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}/__accounts.tsx"></script></body></html>`));});}}]});
    try{await server.listen();for(const [name,engine] of [['chrome',chromium],['webkit',webkit]]){const browser=await engine.launch({headless:true,...(name==='chrome'?{channel:'chrome'}:{})});try{for(const width of [320,390,1280])for(const dark of [0,1]){const page=await browser.newPage({viewport:{width,height:850}});const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});await page.goto(`http://127.0.0.1:${port}${base}/__accounts?dark=${dark}`);await expect(page.locator('[data-lime-search-account]')).toHaveCount(3);await expect(page.getByRole('button',{name:'フォロー',exact:true})).toHaveCount(3);await expect(page.getByAltText('twitter認証済み')).toBeVisible();const row=page.locator('[data-lime-search-account]').first();const bio=await row.locator('p').boundingBox(),action=await row.getByRole('button').boundingBox();assert(bio.y>=action.y+action.height,'bio extends below the follow action');assert(bio.x+bio.width>action.x,'bio uses the entire text row');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');assert.deepEqual(errors,[]);await page.screenshot({path:`/private/tmp/lime-search-accounts-${name}-${width}-${dark}.png`});await page.close();}}finally{await browser.close();}}console.log('PASS account results: Chrome/WebKit, 320/390/1280px, light/dark');}finally{await server.close();}
  },
  // account-suspension-browser-test.mjs
  "account-suspension": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { mkdir } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',fixture='/__suspension_fixture.tsx';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {AccountSuspensionFeedback,SuspensionNotice} from '/src/components/layout/AppLayout';import {notifySuspendedAction} from '/src/lib/supabase';import {ListArt} from '/src/components/lists/ListDialogs';import SearchPage from '/src/pages/SearchPage';import '/src/index.css';const mode=new URLSearchParams(location.search).get('mode');document.documentElement.classList.add('dark');createRoot(document.getElementById('root')).render(<MemoryRouter><div style={{maxWidth:640,margin:'auto'}}><AccountSuspensionFeedback/>{mode==='search'?<SearchPage/>:<SuspensionNotice profile={mode==='profile'}/> }<button onClick={()=>notifySuspendedAction()}>操作を試す</button><ListArt/></div></MemoryRouter>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8190,strictPort:true},plugins:[{name:'suspension-fixture',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__suspension',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__suspension',`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
await server.listen();let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useAuth=()=>({user:{id:"fixture",isSuspended:true}});')});
});
 await mkdir('/private/tmp/lime-suspension-preview',{recursive:true});
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:850});await page.goto(`http://127.0.0.1:8190${base}/__suspension`);
  await expect(page.getByRole('heading',{name:'ご利用のアカウントは停止されています'})).toBeVisible();
  await page.getByRole('button',{name:'操作を試す'}).click();await expect(page.getByRole('alert')).toBeVisible();
  const box=await page.getByRole('alert').boundingBox();assert(box.x>=0&&box.x+box.width<=width);
  await page.screenshot({path:`/private/tmp/lime-suspension-preview/notice-${width}.png`});
  await expect(page.getByRole('button',{name:'詳細はこちら'})).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const colors=await page.getByRole('alert').evaluate(element=>({actual:getComputedStyle(element).backgroundColor,theme:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()}));
  const themeColor=await page.evaluate(theme=>{const element=document.createElement('span');element.style.backgroundColor=`hsl(${theme})`;document.body.append(element);const color=getComputedStyle(element).backgroundColor;element.remove();return color;},colors.theme);
  assert.equal(colors.actual,themeColor);
  await page.goto(`http://127.0.0.1:8190${base}/__suspension?mode=profile`);await expect(page.getByRole('heading',{name:'アカウントは停止されています'})).toBeVisible();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/private/tmp/lime-suspension-preview/profile-${width}.png`});
  await page.goto(`http://127.0.0.1:8190${base}/__suspension?mode=search`);
  await expect(page.getByRole('heading',{name:'検索は利用できません'})).toBeVisible();
  await expect(page.getByPlaceholder('検索',{exact:true})).toHaveCount(0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: mobile/desktop frozen-account notices, themed action feedback without a details overlay, themed star cover and no horizontal overflow');
}finally{await browser?.close();await server.close();}
  },

  // composer-list-browser-test.mjs
  "composer-list": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const { mkdir } = await import('node:fs/promises');
const base='/RaimuNoteSNS.github.io',fixture='/__composer_list_fixture.tsx';
const viewer={id:'11111111-1111-4111-8111-111111111111',username:'RaimuShare',displayName:'LimeNote',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const list={id:'22222222-2222-4222-8222-222222222222',owner_id:viewer.id,name:'テック企業',description:'',is_private:false,members:Array.from({length:29},(_,i)=>({id:String(i),username:'member'+i})),owner:{username:viewer.username,display_name:viewer.displayName,avatar_url:'',is_private:true},followers:5,saved:true};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter,Routes,Route} from 'react-router-dom';import {PostComposer as Inline} from '/src/components/feed/PostComposer';import {PostComposer as Overlay} from '/src/App';import {Lists} from '/src/pages/Bookmarks';import ChatPage from '/src/pages/ChatPage';import {CallSessionProvider} from '/src/components/layout/AppLayout';import {AI_CHAT_HISTORY_CHANGED} from '/src/lib/aiFriends';import {TypingPixelCat,MessagePixelCat,useMessagePixelCat} from '/src/components/chat/FriendProfile';import '/src/index.css';
function CatPreview(){const ref=React.useRef(null);const visit=useMessagePixelCat(ref,'preview',true);return <div ref={ref} className='dm-history' style={{height:260,padding:40,overflow:'auto'}}><div className='dm-message' data-pixel-cat-message='preview-message'><div className='dm-bubble'>メッセージの上でひと休み</div>{visit&&<MessagePixelCat motion={visit.motion} offset={visit.offset}/>}</div><div className='dm-typing' role='status' style={{marginTop:48}}>フレンドが入力中…<TypingPixelCat/></div></div>;}function Inbox(){const [revision,setRevision]=React.useState(0);React.useEffect(()=>{const refresh=()=>setRevision(v=>v+1);window.addEventListener(AI_CHAT_HISTORY_CHANGED,refresh);return()=>window.removeEventListener(AI_CHAT_HISTORY_CHANGED,refresh);},[]);return <div data-inbox-revision={revision}><CallSessionProvider><ChatPage embedded/></CallSessionProvider></div>;}const mode=new URLSearchParams(location.search).get('mode');if(mode?.startsWith('list'))document.documentElement.classList.add('dark');
const rootNode=document.getElementById('root');const fixtureRoot=rootNode.fixtureRoot??=createRoot(rootNode);fixtureRoot.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[mode==='list-detail'?'/lists/${list.id}':'/lists']}><div style={{maxWidth:640,margin:'auto'}}>{mode==='cat'?<CatPreview/>:mode==='chat'?<Inbox/>:mode?.startsWith('list')?<Routes><Route path='/lists' element={<Lists/>}/><Route path='/lists/:id' element={<Lists/>}/></Routes>:mode==='inline'?<Inline/>:<Overlay fullScreen={mode==='fullscreen'}/>}</div></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8189,strictPort:true},plugins:[{name:'composer-list-browser-fixture',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__layout',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__layout',`<html><head></head><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;const renderWarnings=[];
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>console.error('Fixture page error:',e.message));page.on('console',m=>{if(m.type()==='error'){if(m.text().includes('Cannot update a component'))renderWarnings.push(m.text());console.error('Fixture console:',m.text());}});await mkdir('/private/tmp/lime-composer-lists',{recursive:true});
 await page.route('**/src/hooks/useAuth.tsx*',route=>new URL(route.request().url()).searchParams.has('fixture-real')?route.continue():route.fulfill({contentType:'application/javascript',body:`export * from '${base}/src/hooks/useAuth.tsx?fixture-real';const user=${JSON.stringify(viewer)};export const useAuth=()=>({user,loading:false,session:null,accounts:[]});export const AuthProvider=({children})=>children;`}));
 await page.route('**/src/hooks/useTopics.ts*',route=>new URL(route.request().url()).searchParams.has('fixture-real')?route.continue():route.fulfill({contentType:'application/javascript',body:`export * from '${base}/src/hooks/useTopics.ts?fixture-real';const row=${JSON.stringify(list)};export const useLists=()=>({data:[row]}),useListCatalog=useLists,useList=()=>({data:row}),useListFeed=()=>({data:{pages:[]},hasNextPage:false,isFetching:false,isError:false}),useInvalidateLists=()=>async()=>{};`}));
 const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
 await page.route('https://res.cloudinary.com/**',route=>route.fulfill({contentType:'image/png',body:pixel}));
 await page.route('**/*.supabase.co/**',route=>{const req=route.request(),url=new URL(req.url());if(url.pathname.endsWith('/functions/v1/chat-gemma')&&req.method()==='POST')return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'テストの返答です。'}}]})+'\n\ndata: [DONE]\n\n'});return route.fulfill({status:req.method()==='OPTIONS'?204:200,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'},contentType:'application/json',body:req.method()==='OPTIONS'?undefined:JSON.stringify(url.pathname.includes('custom_emojis')?[{id:'sticker',name:'smile',public_id:'fixture/sticker',format:'png'}]:[])});});
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:900});
  for(const mode of ['inline','overlay','fullscreen']){
   await page.goto(`http://127.0.0.1:8189${base}/__layout?mode=${mode}`);const input=page.getByLabel('ポスト本文',{exact:true});await input.waitFor();await input.fill('あ');
   await page.getByRole('button',{name:'予約設定',exact:true}).click();
   const scheduleDialog=page.getByRole('dialog');await expect(scheduleDialog).toBeVisible();await expect(scheduleDialog).toHaveCSS('opacity','1');
   if(width===390){await expect.poll(async()=>Math.abs((await scheduleDialog.boundingBox()).y)).toBeLessThan(1);const bounds=await scheduleDialog.boundingBox();assert(Math.abs(bounds.x)<1&&Math.abs(bounds.y)<1&&Math.abs(bounds.width-width)<1&&Math.abs(bounds.height-900)<1,'mobile reservation fills the viewport');}
   await expect(page.getByRole('button',{name:'予約投稿ポスト',exact:true})).toHaveCount(0);
   await page.screenshot({path:`/private/tmp/lime-composer-lists/schedule-${mode}-${width}.png`});
   const fieldBackgrounds=await scheduleDialog.locator('label').evaluateAll(fields=>fields.map(field=>getComputedStyle(field).backgroundColor));assert(fieldBackgrounds.every(color=>color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'),'date fields have visible backgrounds');
   const month=page.getByRole('combobox',{name:'月',exact:true});const backgroundBefore=await month.evaluate(element=>getComputedStyle(element.parentElement).backgroundColor);await month.focus();const backgroundAfter=await month.evaluate(element=>getComputedStyle(element.parentElement).backgroundColor);assert.equal(backgroundBefore,backgroundAfter,'focus does not turn a date field pink');
   await page.getByRole('button',{name:'確認する',exact:true}).click();
   const scheduleNotice=await page.locator('[data-scheduled-post-notice]').boundingBox();const inputPosition=await input.boundingBox();assert(scheduleNotice.y+scheduleNotice.height<=inputPosition.y,'planned send time is above the post body');
   await page.getByRole('button',{name:'予約設定',exact:true}).click();await page.getByRole('button',{name:'予約を解除する',exact:true}).click();
   assert((await input.boundingBox()).height<=60,`${mode} ${width}: one line is compact`);
   await input.fill('あ\nい\nう');assert((await input.boundingBox()).height>80,`${mode}: actual newlines remain`);await input.fill('あ');assert((await input.boundingBox()).height<=60,`${mode}: textarea shrinks again`);
   await page.getByRole('button',{name:'投票を追加',exact:true}).click();const poll=page.getByRole('region',{name:'投票を作成'});await poll.waitFor();const textBox=await page.getByLabel('投票の質問').boundingBox(),pollBox=await poll.boundingBox();assert(pollBox.y-textBox.y-textBox.height<=24,`${mode}: no blank rows above poll`);
   if(width===1280&&mode==='inline')await page.screenshot({path:'/private/tmp/lime-composer-lists/poll.png'});
   await page.getByRole('button',{name:'投票を削除する'}).click();await input.fill('');await page.getByRole('button',{name:'スタンプを選ぶ',exact:true}).click();await page.getByRole('button',{name:'smileを選ぶ',exact:true}).click();await page.locator('[data-lime-sticker-draft]').waitFor();assert((await input.boundingBox()).height<=60,`${mode}: stamp does not reserve blank rows`);await page.getByRole('button',{name:'スタンプを外す'}).click();
   await page.locator('input[type=file][accept^="image/*"]').first().setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:pixel});await page.locator('img[src^="blob:"]').first().waitFor();assert((await input.boundingBox()).height<=60,`${mode}: image does not reserve blank rows`);await expect(page.getByRole('button',{name:mode==='fullscreen'?'ポストする':'ポスト',exact:true})).toBeEnabled();
  }
  await page.goto(`http://127.0.0.1:8189${base}/__layout?mode=list`);const pin=page.getByRole('button',{name:'テック企業をTLに追加'}).first();await pin.waitFor();const profile=page.locator('[data-list-row]').first().locator('a[href^="/u/"]');const rowBox=await page.locator('[data-list-row]').first().boundingBox(),profileBox=await profile.boundingBox();assert(profileBox.width<rowBox.width-90,'profile link fits its content rather than the row');const before=await pin.evaluate(el=>getComputedStyle(el).color);await pin.click();const active=page.getByRole('button',{name:'テック企業をTLから外す'}).first();assert(await active.getAttribute('aria-pressed')==='true');assert(await active.locator('svg').getAttribute('fill')==='currentColor');const primary=await page.evaluate(()=>{const sample=document.createElement('span');sample.className='text-primary';document.body.append(sample);const color=getComputedStyle(sample).color;sample.remove();return color;});await expect(active).toHaveCSS('color',primary);assert(await active.evaluate(el=>getComputedStyle(el).color)!==before);await page.screenshot({path:`/private/tmp/lime-composer-lists/lists-${width}.png`});await active.click();
  await page.goto(`http://127.0.0.1:8189${base}/__layout?mode=list-detail`);await page.locator('[data-list-default-cover]').waitFor();await page.screenshot({path:`/private/tmp/lime-composer-lists/detail-${width}.png`});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 }
 await page.goto(`http://127.0.0.1:8189${base}/__layout?mode=chat`);const message=page.getByRole('textbox',{name:'メッセージ',exact:true});await message.waitFor();await message.fill('こんにちは');await page.getByRole('button',{name:'送信',exact:true}).click();await page.getByText('テストの返答です。',{exact:true}).waitFor();assert(renderWarnings.length===0,'chat metadata never updates inbox during render');
 await page.clock.install();await page.addInitScript(()=>{Math.random=()=>0;});await page.goto(`http://127.0.0.1:8189${base}/__layout?mode=cat`);await page.getByText('フレンドが入力中…').waitFor();await page.clock.fastForward(20001);await page.locator('.pixel-cat-perch').waitFor();const firstFrame=await page.locator('.pixel-cat-typing .pixel-cat').getAttribute('data-cat-frame');await page.clock.fastForward(3500);assert(await page.locator('.pixel-cat-typing .pixel-cat').getAttribute('data-cat-frame')!==firstFrame,'cat changes articulated sprite pose');const pawBottom=await page.locator('.pixel-cat-perch svg>g').evaluate(el=>el.getBoundingClientRect().bottom),bubbleTop=(await page.locator('[data-pixel-cat-message] .dm-bubble').boundingBox()).y;assert(Math.abs(pawBottom-bubbleTop)<4,'cat paws rest on the actual bubble edge');await page.screenshot({path:'/private/tmp/lime-composer-lists/pixel-cat.png'});await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.pixel-cat-perch')).toHaveCount(0);await expect(page.locator('.pixel-cat-typing .pixel-cat')).toHaveCSS('animation-name','none');
 console.log('PASS: pixel cat typing/perch animation and reduced motion; normal embedded LimeAI receives and saves a streamed reply without render-time inbox updates; desktop/mobile inline/overlay/fullscreen composers fit actual lines and poll/sticker/image attachments; list pins visibly toggle; list detail fits viewport');
}finally{await browser?.close();await server.close();}
  },

  // lime-map-browser-test.mjs
  "lime-map": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',fixture='/__map_fixture.tsx';
const source=`import '/src/index.css';import React from 'react';import{createRoot}from'react-dom/client';import LimeMap from'/src/components/maps/LimeMap';import L from'leaflet';import{createLimeMapStyle}from'/src/components/maps/LimeMap';import{validateStyleMin}from'@maplibre/maplibre-gl-style-spec';window.__styleErrors=[...validateStyleMin(createLimeMapStyle(false)),...validateStyleMin(createLimeMapStyle(true))].map(x=>x.message);const add=L.Map.prototype.initialize;L.Map.prototype.initialize=function(...args){add.apply(this,args);window.__map=this;};if(!window.__mapFixtureRoot){window.__mapFixtureRoot=createRoot(document.getElementById('root'));window.__mapFixtureRoot.render(<LimeMap initialLocation={{latitude:34.74,longitude:135.48}} posts={[{id:'test-pin',author:{displayName:'猫の投稿者',avatarUrl:'/RaimuNoteSNS.github.io/limeai-cat.png'},mapLocation:{latitude:34.74,longitude:135.48}},{id:'test-pin-2',author:{displayName:'猫の投稿者',avatarUrl:'/RaimuNoteSNS.github.io/limeai-cat.png'},mapLocation:{latitude:34.74,longitude:135.485}}]} onLoadPost={async pin=>({id:pin.id,createdAt:'2026-10-14T00:00:00Z',content:'地図の投稿',author:{displayName:'猫の投稿者',avatarUrl:'/RaimuNoteSNS.github.io/limeai-cat.png'}})} onPost={p=>window.__openedPost=p.id} onSelect={p=>window.__selected=p} onBounds={b=>window.__bounds=b}/>);}`;
const server=await createServer({cacheDir:'/private/tmp/lime-map-vite-cache',server:{host:'127.0.0.1',port:8194,strictPort:true},plugins:[{name:'map-fixture',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__map_test',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__map_test',`<html><head><style>body{margin:0}#root .lime-map{height:100vh}</style></head><body><div id='root'></div><script type='module' src='${fixture}'></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:760}}),errors=[],tiles=[];page.on('console',m=>{if(m.type()==='error')console.log(m.text());});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('experimental_bvmap'))tiles.push(r.status());});
  await page.goto(`http://127.0.0.1:8194${base}/__map_test`);
  try { await expect(page.locator('.lime-map-vector canvas')).toBeVisible({timeout:15000}); } catch(error) { console.log({errors,body:await page.locator('body').innerText()}); throw error; }
  assert.deepEqual(await page.evaluate(()=>window.__styleErrors),[]);
  await page.waitForFunction(()=>{const layer=Object.values(window.__map._layers).find(l=>l.getMaplibreMap);return layer?.getMaplibreMap().loaded()&&layer.getMaplibreMap().queryRenderedFeatures().length>20;},{},{timeout:60000});
  const features=await page.evaluate(()=>{const gl=Object.values(window.__map._layers).find(l=>l.getMaplibreMap).getMaplibreMap();return [...new Set(gl.queryRenderedFeatures().map(f=>f.layer.id))];});
  assert.ok(features.includes('highway'));assert.ok(features.includes('railway'));assert.ok(features.includes('stations'));assert.ok(features.includes('cities'));
  if(width===390){await page.evaluate(()=>window.__map.setView([34.80,135.45],12));await page.waitForFunction(()=>Object.values(window.__map._layers).find(l=>l.getMaplibreMap)?.getMaplibreMap().loaded(),{},{timeout:60000});}
  await expect(page.locator('.lime-map-highway-pill').first()).toBeVisible();assert.ok(await page.evaluate(()=>document.fonts.check('400 20px LimeMapGothic','中国道')&&document.fonts.check('700 20px LimeMapGothic','E2A')));assert.ok((await page.locator('.lime-map-highway-pill').first().evaluate(n=>getComputedStyle(n).fontFamily)).includes('LimeMapGothic'));const badges=await page.locator('.lime-map-highway-pill').evaluateAll(nodes=>nodes.map(n=>({number:n.querySelector('.lime-map-highway-number')?.textContent??'',name:n.querySelector('.lime-map-highway-name').textContent,height:n.getBoundingClientRect().height})));assert.ok(badges.every(b=>(!b.number||/^(?:[EC])?\d+[A-Z]?$/.test(b.number))&&b.name.length&&b.height===26));
  await page.screenshot({path:`/private/tmp/lime-map-light-${width}.png`});
  await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.waitForTimeout(1500);await page.screenshot({path:`/private/tmp/lime-map-dark-${width}.png`});
  await page.evaluate(()=>window.__map.setView([34.74,135.48],13));await page.waitForTimeout(450);
  await expect(page.locator('.lime-map-avatar-pin')).toHaveCount(1);assert.equal(await page.locator('.lime-map-avatar-pin').evaluate(node=>node.getBoundingClientRect().width),40);await page.waitForFunction(()=>document.querySelector('.lime-map-avatar-pin img')?.naturalWidth>0);assert.ok(await page.locator('.lime-map-avatar-pin-body').evaluate(root=>Number(getComputedStyle(root.querySelector('.lime-map-avatar-pin-face')).zIndex)>Number(getComputedStyle(root.querySelector('svg')).zIndex)));assert.ok(await page.locator('.lime-map-avatar-pin-body').evaluate(root=>Number(getComputedStyle(root.querySelector('.lime-map-avatar-pin-rim')).zIndex)>Number(getComputedStyle(root.querySelector('.lime-map-avatar-pin-face')).zIndex)));await page.locator('.lime-map-avatar-pin').screenshot({path:`/private/tmp/lime-map-simple-pin-${width}.png`});
  await page.locator('.lime-map-avatar-pin').click();await page.getByText('ポストを見る',{exact:true}).click();assert.equal(await page.evaluate(()=>window.__openedPost),'test-pin');await page.evaluate(()=>window.__map.closePopup());
  await page.mouse.click(width/2,300);await page.waitForFunction(()=>window.__selected);assert.ok(await page.evaluate(()=>window.__bounds));
  await page.evaluate(()=>{document.documentElement.classList.remove('dark');window.__map.setView([34.74,135.48],12);});await page.waitForFunction(()=>Object.values(window.__map._layers).find(l=>l.getMaplibreMap)?.getMaplibreMap().loaded(),{},{timeout:60000});await page.waitForTimeout(600);const facilityLayers=await page.evaluate(()=>Object.values(window.__map._layers).find(l=>l.getMaplibreMap).getMaplibreMap().queryRenderedFeatures().map(f=>f.layer.id));assert.ok(facilityLayers.includes('station-points'));assert.ok(facilityLayers.includes('highway-facility-points'));if(width===1280)await expect(page.locator('.lime-map-highway-pill').filter({hasText:'中国道'})).toBeVisible();await page.screenshot({path:`/private/tmp/lime-map-network-${width}.png`});
  if(width===1280){await page.evaluate(()=>window.__map.setView([34.5,135.6],11));await page.waitForFunction(()=>Object.values(window.__map._layers).find(l=>l.getMaplibreMap)?.getMaplibreMap().loaded(),{},{timeout:60000});await expect(page.locator('.lime-map-highway-pill').filter({hasText:'阪和道'}).first()).toBeVisible();await expect(page.locator('.lime-map-highway-pill').filter({hasText:'京奈和道'}).first()).toBeVisible();await page.screenshot({path:'/private/tmp/lime-map-coarse-road-names.png'});}
  await page.evaluate(()=>window.__map.setView([34.74,135.48],13));await page.waitForTimeout(300);await page.evaluate(()=>{window.__stablePin=document.querySelector('[data-lime-map-post-id=\"test-pin\"]');window.__stableImage=window.__stablePin.querySelector('img');window.__zoomFrames=[];const start=performance.now();const sample=()=>{const style=getComputedStyle(window.__stablePin);window.__zoomFrames.push(window.__stablePin.isConnected&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0);if(performance.now()-start<400)requestAnimationFrame(sample);};requestAnimationFrame(sample);window.__map.setZoom(14,{animate:true});});await page.waitForTimeout(450);assert.ok(await page.evaluate(()=>window.__zoomFrames.length>0&&window.__zoomFrames.every(Boolean)));assert.ok(await page.evaluate(()=>document.querySelector('[data-lime-map-post-id=\"test-pin\"]')===window.__stablePin&&window.__stablePin.querySelector('img')===window.__stableImage));await expect(page.locator('[data-lime-map-post-id=\"test-pin-2\"]')).toBeVisible();await page.evaluate(()=>window.__map.setZoom(13,{animate:true}));await page.waitForTimeout(450);assert.ok(await page.evaluate(()=>document.querySelector('[data-lime-map-post-id=\"test-pin\"]')===window.__stablePin));await expect(page.locator('.lime-map-avatar-pin')).toHaveCount(1);await expect(page.locator('.lime-map-avatar-pin-count')).toHaveText('2');
  await page.evaluate(()=>window.__map.setView([35.17,136.90],13));await page.waitForFunction(()=>Object.values(window.__map._layers).find(l=>l.getMaplibreMap)?.getMaplibreMap().loaded(),{},{timeout:60000});await page.waitForTimeout(600);const stations=await page.evaluate(()=>Object.values(window.__map._layers).find(l=>l.getMaplibreMap).getMaplibreMap().queryRenderedFeatures({layers:['station-points']}).map(f=>({sourceLayer:f.sourceLayer,type:f.geometry.type})));assert.ok(stations.length);assert.ok(stations.every(f=>f.sourceLayer==='railway'&&['LineString','MultiLineString'].includes(f.type)));await page.screenshot({path:`/private/tmp/lime-map-nagoya-${width}.png`});
  await page.evaluate(()=>window.__map.setView([36.2,138.25],5));await page.waitForFunction(()=>Object.values(window.__map._layers).find(l=>l.getMaplibreMap)?.getMaplibreMap().loaded(),{},{timeout:60000});await page.waitForTimeout(600);await page.screenshot({path:`/private/tmp/lime-map-japan-${width}.png`});
  await page.evaluate(()=>window.__map.setView([48.85,2.35],10));const center=await page.evaluate(()=>window.__map.getCenter());assert.ok(center.lat<=46&&center.lng>=122);assert.equal(await page.locator('.leaflet-tile').count(),0);
  assert.deepEqual(errors,[]);assert.ok(tiles.includes(200));console.log(`PASS ${width}px: actual GSI transport/city/station layers, both themes, location selection and Japan-only bounds`);await page.close();
 }
}finally{await browser?.close();await server.close();}
  },

  // mobile-pwa-performance-browser-test.mjs
  "mobile-pwa-performance": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',port=8208;
const post={id:'x:2110000000000000001',source:'x',userId:'x-user:123',content:'プロフィールの親投稿',imageUrls:[],createdAt:'2026-10-18T00:00:00Z',likesCount:12,commentsCount:0,repostsCount:2,repostedByMe:false,author:{id:'x-user:123',username:'artist@twitter.com',displayName:'作者',avatarUrl:''}};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {PostCard} from '/src/components/feed/PostCard';import {ProfileReplyThreadCard} from '/src/pages/Profile';import {externalProfileReplyThread} from '/src/lib/utils';import {PostSourceLabelVisibility} from '/src/components/feed/QuotedPost';import {useBlueskySession} from '/src/hooks/useAuth';import {useTimelinePortalTheme} from '/src/hooks/useViewportWidth';import {useMinuteTick} from '/src/hooks/useViewportWidth';const post=${JSON.stringify(post)};function Probe(){useBlueskySession('bsky:probe');useTimelinePortalTheme(true);useMinuteTick();return null;}window.unmountFixture?.();const root=createRoot(document.getElementById('root'));function App(){return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{Array.from({length:200},(_,i)=><Probe key={i}/>)}<section data-profile><PostSourceLabelVisibility.Provider value={false}><PostCard post={post}/>{['x','bluesky','misskey'].map((source,i)=>{const parent={...post,id:['x:1','bsky:2','misskey:3'][i],source,content:'親投稿 '+source};const reply={...post,id:'x:reply'+i,content:'返信の本文',externalReplyToId:parent.id,externalReplyParent:parent};return <ProfileReplyThreadCard key={source} thread={externalProfileReplyThread(reply)} onImageClick={()=>{}} onImageError={()=>{}}/>;})}</PostSourceLabelVisibility.Provider></section><section data-feed>{Array.from({length:80},(_,i)=><PostCard key={i} timelineGlass post={{...post,id:'x:'+i,content:'タイムラインの投稿 '+i}}/>)}</section></MemoryRouter></QueryClientProvider>;}root.render(<App/>);window.unmountFixture=()=>root.unmount();`;
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
  },

  // mobile-sidebar-browser-test.mjs
  "mobile-sidebar": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',fixture='/__sidebar_test.tsx';
const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {useMobileDrawerMotion,useMobileFeedTabSwipe} from '/src/components/layout/Header';import '/src/index.css';function Harness(){const [open,setOpen]=useState(false);const [tab,setTab]=useState('all');useMobileDrawerMotion(open,setOpen,true,true);useMobileFeedTabSwipe(true,open,tab,setTab,[{value:'all'},{value:'following'}]);return <main id="surface" style={{height:'100vh'}}><output id="state">{open?'open':'closed'}</output><output id="tab">{tab}</output><aside data-lime-mobile-sidebar="true">sidebar</aside></main>};createRoot(document.getElementById('root')).render(<MemoryRouter><Harness/></MemoryRouter>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8195,strictPort:true},plugins:[{name:'sidebar-test',transform(code,id){if(id.includes('/src/components/layout/Header.tsx'))return code+'\nexport {useMobileDrawerMotion,useMobileFeedTabSwipe};';},resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__sidebar_test',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__sidebar_test',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:8195${base}/__sidebar_test`);await expect(page.locator('#state')).toHaveText('closed');
 const touch=async(type,x,y,count=1)=>page.evaluate(({type,x,y,count})=>{const target=document.getElementById('surface');const points=Array.from({length:count},(_,i)=>new Touch({identifier:i,target,clientX:x+i*10,clientY:y}));target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'||type==='touchcancel'?[]:points,changedTouches:points}));},{type,x,y,count});
 const swipe=async(x,y,dx,dy)=>{await touch('touchstart',x,y);await touch('touchmove',x+dx/2,y+dy/2);await touch('touchmove',x+dx,y+dy);await touch('touchend',x+dx,y+dy);};
 for(const [x,y,dx,dy] of [[160,100,100,0],[20,100,8,100],[20,100,70,65],[20,100,25,1]]){await swipe(x,y,dx,dy);await expect(page.locator('#state')).toHaveText('closed');}
 // A slight vertical wobble before a deliberate edge drag must not cancel opening.
 await touch('touchstart',34,100);await touch('touchmove',36,106);await touch('touchmove',70,107);await touch('touchmove',124,108);await touch('touchend',124,108);await expect(page.locator('#state')).toHaveText('open');await expect(page.locator('#tab')).toHaveText('all');
 await swipe(220,100,-90,3);await expect(page.locator('#state')).toHaveText('closed');
 await touch('touchstart',20,100);await touch('touchmove',90,100,2);await touch('touchend',100,100);await expect(page.locator('#state')).toHaveText('closed');
 for(const attributes of [{'data-lime-maps':''},{class:'lime-map-dialog'},{class:'lime-media-lightbox'}]){
  await page.evaluate(attrs=>{const el=document.createElement('div');el.id='blocker';for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);el.style.cssText='position:fixed;inset:0';document.body.append(el);},attributes);
  await swipe(20,100,120,0);await expect(page.locator('#state')).toHaveText('closed');await page.locator('#blocker').evaluate(el=>el.remove());
 }
 await swipe(72,100,68,4);await expect(page.locator('#state')).toHaveText('open');
 await swipe(220,100,-90,3);await expect(page.locator('#state')).toHaveText('closed');
 await swipe(150,100,135,5);await expect(page.locator('#state')).toHaveText('open');
 assert.deepEqual(errors,[]);console.log('PASS: edge opening, initial wobble, closing; no body/vertical/diagonal/short/multitouch opening; Maps and media viewer block drawer');
}finally{await browser?.close();await server.close();}
  },

  // profile-loading-browser-test.mjs
  "profile-loading": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',fixture='/__profile_loading.tsx';
const author='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333';
const profile={id:author,username:'author',display_name:'Author',avatar_url:'',is_private:false,created_at:'2026-10-01T00:00:00Z'};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter,Routes,Route} from 'react-router-dom';import Profile from '/src/pages/Profile';import '/src/index.css';const client=new QueryClient({defaultOptions:{queries:{retry:false}}});window.client=client;document.documentElement.setAttribute('data-lime-mobile-profile-page','true');createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/u/author']}><Routes><Route path='/u/:username' element={<Profile/>}/></Routes></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8196,strictPort:true},plugins:[{name:'profile-loading',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__profile_loading',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__profile_loading',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + (`export const useAuth=()=>({user:{id:'${viewer}',username:'viewer',displayName:'Viewer',avatarUrl:''},loading:false});`)});
});
 await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${viewer}';`}));
 await page.route('**/src/hooks/useFeed.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + (`const empty={data:{pages:[]},isPending:false,isLoading:false,isError:false,hasNextPage:false,isFetchingNextPage:false,fetchNextPage:async()=>{},refetch:async()=>{}};export const useProfile=()=>({data:{id:'${author}',username:'author',displayName:'Author',avatarUrl:'',coverUrl:'',bio:'',createdAt:'2026-10-01',isPrivate:false},isLoading:false,isError:false});export const useFollowStats=()=>({data:{followers:0,following:0,canView:true}});export const useUserLikesInfinite=()=>empty;export const useUserMediaInfinite=()=>empty;export const useUserReactionsInfinite=()=>empty;export const useToggleFollow=()=>({mutate:()=>{},isPending:false});export const followStatsKey=id=>['follow-stats',id];export const profileKey=id=>['profile',id];`)});
});
 await page.route('**/src/hooks/useTopics.ts*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + ('export const useProfileHighlights=()=>({data:{pages:[]},isPending:false,isLoading:false,isError:false});')});
});
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
  },

  // profile-twitter-header-browser-test.mjs
  "profile-twitter-header": async () => {
const { createServer } = await import('vite');const { chromium, expect } = await import('@playwright/test');const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io';
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{MemoryRouter}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Header}from'/src/components/layout/Header';import{ProfileHeader}from'/src/components/profile/ProfileHeader';import'/src/index.css';const user={id:'x-user:123',username:'artist@twitter.com',displayName:'認証された作者',avatarUrl:'',coverUrl:'',bio:'プロフィール本文',createdAt:'2026-10-15',providerVerification:{provider:'twitter',type:'individual'}};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/u/artist@twitter.com']}><Header/><ProfileHeader user={user} isBlueskyProfile blueskyStats={{posts:10,following:0,followers:1}}/><div style={{height:2400}}>投稿一覧</div></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({cacheDir:'/private/tmp/lime-profile-twitter-cache',server:{host:'127.0.0.1',port:8202,strictPort:true},plugins:[{name:'profile-twitter',resolveId(id){if(id.endsWith('/__profile_twitter.tsx'))return '\0profile-twitter.tsx';},load(id){if(id==='\0profile-twitter.tsx')return source;},configureServer(s){s.middlewares.use(base+'/__profile_twitter',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__profile_twitter',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}/__profile_twitter.tsx"></script></body></html>`));});}}]});
let browser;try{await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
await page.route('**/src/hooks/useAuth.tsx*',r => {
const fixtureRequestUrl = new URL(r.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return r.continue();
return r.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + (`export const useAuth=()=>({user:null,loading:false,accounts:[],logout:async()=>{}});`)});
});
await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await page.route('**/functions/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto('http://127.0.0.1:8202'+base+'/__profile_twitter');await expect(page.locator('[data-lime-profile-name]')).toBeVisible();const badge=page.locator('[data-lime-profile-header]').getByRole('img',{name:'twitter認証済み'});await expect(badge).toBeVisible();assert.ok((await badge.getAttribute('src')).endsWith('/verified.png'));
const follow=page.locator('header .lime-profile-bar-follow');await expect(follow).not.toHaveClass(/is-visible/);await page.evaluate(()=>window.scrollTo(0,700));await expect(follow).toHaveClass(/is-visible/);await expect(follow.getByRole('button',{name:'フォロー',exact:true})).toBeVisible();await expect(follow).toHaveCSS('width','124px');await expect(page.locator('a[aria-label="プロフィールを検索"]')).toHaveCSS('width','0px');await page.screenshot({path:'/private/tmp/lime-profile-twitter-header.png'});await page.evaluate(()=>window.scrollTo(0,0));await expect(follow).not.toHaveClass(/is-visible/);assert.deepEqual(errors,[]);console.log('PASS: existing LimeNote badge and twitter follow button after scrolling; hidden again at top.');
const layoutReads=await page.evaluate(async()=>{
 let reads=0;const original=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){if(this.matches('[data-lime-profile-name], [data-lime-profile-header], .profile-header-cover-avatar-gap'))reads++;return original.call(this);};
 try{for(let i=0;i<100;i++){scrollTo(0,i*10);await new Promise(requestAnimationFrame);}return reads;}
 finally{Element.prototype.getBoundingClientRect=original;}
});assert(layoutReads<15,`Profile scroll repeated ${layoutReads} layout reads`);console.log('PASS: 100 profile scroll frames require only '+layoutReads+' profile layout reads');
const result=await page.evaluate(async()=>{const r=await fetch('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?'+new URLSearchParams({q:'JR東日本',limit:'2'}));const d=await r.json();return{status:r.status,posts:d.posts?.length};});assert.equal(result.status,200);assert.ok(result.posts>0);console.log('PASS: live Bluesky search works from the browser origin',result);
}finally{await browser?.close();await server.close();}
  },

  // search-pwa-layout-browser-test.mjs
  "search-pwa-layout": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',port=8205;
const post={id:'x:2110000000000000001',source:'x',userId:'x-user:123',content:'検索結果の投稿本文です。モバイルでも左右に余白を確保します。',imageUrls:[],createdAt:'2026-10-18',likesCount:12,commentsCount:3,repostsCount:2,repostedByMe:false,author:{id:'x-user:123',username:'artist@twitter.com',displayName:'作者',avatarUrl:''}};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {DesktopLayoutContext} from '/src/components/layout/DesktopLayoutContext';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {PostCard} from '/src/components/feed/PostCard';import {PostSourceLabelVisibility} from '/src/components/feed/QuotedPost';import {SearchPostRow} from '/src/components/search/SearchExploreContent';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><DesktopLayoutContext.Provider value={innerWidth>=640}><div className={innerWidth>=640?'lime-app-shell':''} data-lime-page="/search" style={{display:'block'}}><section data-results><SearchPostRow><PostCard post={${JSON.stringify(post)}}/></SearchPostRow><SearchPostRow><PostCard post={${JSON.stringify({...post,id:'x:2110000000000000002'})}}/></SearchPostRow></section><section data-profile><PostSourceLabelVisibility.Provider value={false}><PostCard post={${JSON.stringify(post)}}/></PostSourceLabelVisibility.Provider></section></div></DesktopLayoutContext.Provider></MemoryRouter></QueryClientProvider>);`;
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
  },

  // stock-market-browser-test.mjs
  "stock-market": async () => {
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
 // Test the actual app with an isolated fake account, never a personal session.
 await page.route('**/src/hooks/useAuth.tsx*',route => {
const fixtureRequestUrl = new URL(route.request().url());
if (fixtureRequestUrl.searchParams.has('__lime_fixture_actual')) return route.continue();
return route.fulfill({contentType:'application/javascript',body:`export * from ${JSON.stringify(fixtureRequestUrl.pathname+"?__lime_fixture_actual=1")};\n` + (`export const useAuth=()=>({user:{id:'11111111-1111-4111-8111-111111111111',username:'fixture',displayName:'Fixture',avatarUrl:''},loading:false,accounts:[],switching:false,session:null});export const AuthProvider=({children})=>children;`)});
});
 await page.route('**/*.supabase.co/**',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.endsWith('/market-data'))return route.continue();
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']??'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  return route.fulfill({headers,contentType:'application/json',body:'[]'});
 });
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:1000});
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/search?q=%24AAPL');
  const card=page.locator('[data-lime-stock-card]');
  try{await expect(card.locator('.lime-stock-price')).toContainText('$',{timeout:15000});}catch(error){console.log(JSON.stringify({errors,url:page.url(),body:(await page.locator('body').innerText()).slice(0,1000)}));throw error;}
  await expect(card.getByRole('img',{name:/株価チャート/})).toBeVisible();
  await card.getByRole('button',{name:'1W',exact:true}).click();
  await expect(card.getByRole('img',{name:/1W/})).toBeVisible({timeout:15000});
  const bounds=await card.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  const input=page.getByPlaceholder('検索').filter({visible:true});
  await input.fill('$AAP');await input.focus();
  const suggestion=page.getByRole('button').filter({has:page.locator('.lime-stock-suggestion-name')}).filter({hasText:'Apple Inc.'});
  await expect(suggestion).toBeVisible();await expect(suggestion.locator('.lime-stock-suggestion-price')).toContainText('$');
  await suggestion.click();await expect(input).toHaveValue('$AAPL');await expect(card).toBeVisible();
  await expect(card.locator('.lime-stock-mark,img')).toHaveCount(0);
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/search?q='+encodeURIComponent('キオクシア'));
  await expect(card.locator('.lime-stock-price')).toContainText('￥',{timeout:15000});
  await input.focus();
  const domestic=page.getByRole('button').filter({has:page.locator('.lime-stock-suggestion-name')}).filter({hasText:'キオクシアホールディングス'});
  await expect(domestic).toBeVisible();
  await input.press('Escape');
  await expect(card.getByRole('heading',{name:'キオクシアホールディングス'})).toBeVisible();
  await expect(card.locator('.lime-stock-price')).toContainText('￥',{timeout:15000});
  await expect(card.locator('.lime-stock-mark,img')).toHaveCount(0);
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await card.screenshot({path:`/tmp/lime-stock-card-${width}.png`});
  console.log(JSON.stringify({width,price:await card.locator('.lime-stock-price').innerText(),cardWidth:bounds.width,suggestion:true,periodSwitch:true}));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
  },
  "timeline-notice": async () => {
const {createServer}=await import('vite');
const {chromium,expect}=await import('@playwright/test');
const assert=(await import('node:assert/strict')).default;
const {mkdir}=await import('node:fs/promises');
const base='/RaimuNoteSNS.github.io',fixture='/__timeline_notice.tsx';
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{MemoryRouter}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Feed,{collectTimelineNoticePosts}from'/src/pages/Feed';import'/src/index.css';window.switchNoticeTab=(tab,top)=>{flushSync(()=>window.dispatchEvent(new CustomEvent('lime-active-feed-tab-changed',{detail:{tab}})));window.scrollTo(0,top)};window.collectNotice=collectTimelineNoticePosts;createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><header data-lime-app-header style={{height:innerWidth<640?108:64,position:'sticky',top:0,zIndex:500,transition:'transform .3s ease-out',background:'#111',color:'#fff',display:'flex',alignItems:'center',justifyContent:'space-around'}}><b>最新</b><span>フォロー中</span></header><main style={{maxWidth:620,margin:'auto'}}><React.Profiler id="feed" onRender={()=>{window.feedCommits=(window.feedCommits??0)+1}}><Feed/></React.Profiler></main></MemoryRouter></QueryClientProvider>);`;
const mocks={
 '/src/lib/supabase.ts':`window.noticeReads=0;window.noticeHandlers=[];export const supabase={auth:{getUser:async()=>({data:{user:{id:'viewer'}}}),getSession:async()=>({data:{session:null}})},rpc:async()=>({data:[],error:null}),from(table){const q={select(){return q},eq(){return q},maybeSingle(){return q},then(done){return Promise.resolve({data:table==='follows'?[{followee_id:'friend'}]:table==='profiles'?{timeline_background_url:null}:[],error:null}).then(done)}};return q},channel(name){const c={name,on(kind,config,handler){if(name==='feed-new-posts')window.noticeHandlers.push(handler);return c},subscribe(){return c}};return c},removeChannel(){}};`,
 '/src/hooks/useAuth.tsx':`export const useAuth=()=>({user:{id:'viewer',username:'viewer',displayName:'Viewer'},loading:false});`,
 '/src/hooks/useFeed.ts':`const old=Array.from({length:new URLSearchParams(location.search).has('performance')?80:8},(_,i)=>({id:'old-'+i,userId:'friend',content:'以前のポスト '+i,createdAt:'2026-10-18T00:00:00Z',imageUrls:[],likesCount:0,commentsCount:0,repostsCount:0,author:{id:'friend',username:'friend',displayName:'Friend',avatarUrl:''}}));const result={data:{pages:[{posts:old}]},isLoading:false,isFetching:false,isError:false,isFetchingNextPage:false,hasNextPage:false,fetchNextPage:async()=>{}};export const useTimelineFeed=()=>result;`,
 '/src/api/posts.ts':`export async function getPostById(id){window.noticeReads++;return window.noticePosts[id]??null}`,
 '/src/components/feed/PostCard.tsx':`import React from'react';export function PostCard({post}){return <article data-notice-post={post.id} style={{height:260,padding:24,borderBottom:'1px solid #444'}}>{post.content}</article>}`,
 '/src/components/feed/PostComposer.tsx':`import React from'react';export function PostComposer(){return <div style={{height:80,padding:20}}>いまどうしてる？</div>}`,
};
const server=await createServer({cacheDir:'/private/tmp/lime-notice-vite-cache',server:{host:'127.0.0.1',port:8210,strictPort:true},plugins:[{name:'timeline-notice-fixture',resolveId(id){if(id.endsWith(fixture))return '\0'+fixture},load(id){if(id==='\0'+fixture)return source;for(const [path,body]of Object.entries(mocks))if(id.split('?')[0].endsWith(path)&&!id.includes('notice-actual'))return (path.endsWith('/supabase.ts')?'':`export * from '${path}?notice-actual';\n`)+body},configureServer(s){s.middlewares.use(base+'/__timeline_notice',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__timeline_notice',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`))})}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});await mkdir('/private/tmp/lime-timeline-notice',{recursive:true});
 for(const width of [320,390,1280])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:850},isMobile:width<640,hasTouch:width<640,reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(theme=>{window.noticePosts={};localStorage.setItem('lime_active_feed_tab','all');document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.toggle('dark',theme==='dark'),{once:true})},theme);
  await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await page.goto(`http://127.0.0.1:8210${base}/__timeline_notice`);await expect(page.locator('[data-notice-post="old-0"]')).toBeVisible();await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);
  const switchTab=async(tab,top)=>{await page.evaluate(({tab,top})=>window.switchNoticeTab(tab,top),{tab,top});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))));await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(top);};
  const emit=async(id,author='friend',extra={})=>page.evaluate(async({id,author,extra})=>{const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="'+(author==='friend'?'#c5a3ef':'#f6b5b5')+'"/></svg>');window.noticePosts[id]={id,userId:author,content:'新着 '+id,createdAt:new Date().toISOString(),imageUrls:[],likesCount:0,commentsCount:0,repostsCount:0,author:{id:author,username:author,displayName:author,avatarUrl:image}};await Promise.all(window.noticeHandlers.map(handler=>handler({new:{id,...extra}})));},{id,author,extra});
  await emit('reply','friend',{parent_id:'old-0'});assert.equal(await page.evaluate(()=>window.noticeReads),0);
  await switchTab('following',0);await page.evaluate(()=>window.scrollTo(0,500));await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(500);
  await switchTab('all',0);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await emit('self','viewer');await emit('at-top');await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);
  await page.evaluate(()=>window.scrollTo(0,500));await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);
  if(width===390&&theme==='dark')await page.emulateMedia({reducedMotion:'no-preference'});
  const readingPosition=await page.locator('[data-notice-post="old-0"]').evaluate(element=>({scroll:scrollY,top:element.getBoundingClientRect().top}));
  await emit('friend-one');await expect(page.locator('.lime-new-posts-notice')).toBeVisible();
  const calls=await page.evaluate(()=>window.noticeReads);await emit('friend-one');assert.equal(await page.evaluate(()=>window.noticeReads),calls);
  await emit('friend-two');await expect(page.locator('.lime-new-posts-avatars>span')).toHaveCount(1);await emit('other','other');await emit('third','third');await emit('fourth','fourth');await expect(page.locator('.lime-new-posts-avatars>span')).toHaveCount(3);
  assert.deepEqual(await page.locator('[data-notice-post="old-0"]').evaluate(element=>({scroll:scrollY,top:element.getBoundingClientRect().top})),readingPosition);await expect(page.locator('[data-notice-post="friend-one"]')).toHaveCount(0);
  const geometry=await page.locator('.lime-new-posts-notice').evaluate(element=>{const r=element.getBoundingClientRect(),h=document.querySelector('[data-lime-app-header]').getBoundingClientRect(),b=getComputedStyle(element.querySelector('button'));return{left:r.left,right:r.right,top:r.top,headerBottom:h.bottom,color:b.backgroundColor,radius:b.borderRadius,height:r.height,fontSize:b.fontSize,avatarWidth:parseFloat(getComputedStyle(element.querySelector('.lime-new-posts-avatars>span')).width),animation:b.animationName,duration:b.animationDuration,theme:(()=>{const probe=document.createElement('span');probe.style.backgroundColor='hsl('+getComputedStyle(document.documentElement).getPropertyValue('--primary')+')';document.body.append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color})()}});
  assert(geometry.left>=0&&geometry.right<=width);assert(geometry.top>=geometry.headerBottom);assert.equal(geometry.color,geometry.theme);assert.equal(geometry.fontSize,width<640?'12px':'15px');assert.equal(geometry.avatarWidth,width<640?23:30);assert(geometry.height<=(width<640?36:50));assert.equal(geometry.animation,width===390&&theme==='dark'?'lime-new-posts-enter':'none');if(geometry.animation!=='none'){assert.equal(geometry.duration,'0.24s');await expect.poll(()=>page.locator('.lime-new-posts-notice button').evaluate(element=>getComputedStyle(element).opacity)).toBe('1');}
  if(width<640){
   await page.locator('[data-lime-app-header]').evaluate(element=>{element.style.transform='translateY(-100%)'});
   await expect.poll(()=>page.locator('[data-lime-app-header]').evaluate(element=>Math.round(element.getBoundingClientRect().bottom))).toBe(0);
   await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
   await expect.poll(()=>page.locator('.lime-new-posts-notice').evaluate(element=>Math.round(element.getBoundingClientRect().top))).toBe(12);
   await page.locator('[data-lime-app-header]').evaluate(element=>{element.style.transform='translateY(0)'});
   await expect.poll(()=>page.locator('[data-lime-app-header]').evaluate(element=>Math.round(element.getBoundingClientRect().bottom))).toBe(108);
   await expect.poll(()=>page.locator('.lime-new-posts-notice').evaluate(element=>Math.round(element.getBoundingClientRect().top))).toBe(120);
   assert(await page.locator('.lime-new-posts-notice button').evaluate(element=>{const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));
  }
  await page.screenshot({path:`/private/tmp/lime-timeline-notice/${width}-${theme}.png`});
  await switchTab('following',500);await expect(page.locator('.lime-new-posts-avatars>span')).toHaveCount(1);
  await page.locator('.lime-new-posts-notice button').click();await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await switchTab('all',500);await expect(page.locator('.lime-new-posts-notice')).toBeVisible();await page.locator('.lime-new-posts-notice button').click();await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);await expect(page.locator('[data-notice-post="friend-one"]')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await page.evaluate(()=>window.scrollTo(0,500));await emit('header-reset');await expect(page.locator('.lime-new-posts-notice')).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('lime-feed-scroll-top')));await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);await expect(page.locator('[data-notice-post="header-reset"]')).toHaveCount(1);
  await emit('manual-return');await expect(page.locator('.lime-new-posts-notice')).toBeVisible();await page.evaluate(()=>window.scrollTo(0,0));await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);await page.evaluate(()=>window.scrollTo(0,500));await expect(page.locator('.lime-new-posts-notice')).toHaveCount(0);
  assert.deepEqual(errors,[]);console.log(`PASS ${width}px ${theme}: theme pink, entrance/reduced-motion, scrolled-only display, native realtime, own/reply/duplicate exclusion, three author avatars, stable reading position, buffered posts and independent tab acknowledgement`);await page.close();
 }
 const feedSamples=[];
 for(const pwa of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  await page.addInitScript(pwa=>{Object.defineProperty(navigator,'standalone',{value:pwa});window.noticePosts={};localStorage.setItem('lime_active_feed_tab','all');},pwa);
  await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(`http://127.0.0.1:8210${base}/__timeline_notice?performance=1`);await expect(page.locator('[data-notice-post="old-0"]')).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1000)));
  const timing=await page.evaluate(async()=>{
   const measure=async()=>{
   window.feedCommits=0;const frames=[];let previous=performance.now(),blank=0;
   for(let i=0;i<120;i++){
    window.scrollBy(0,40);await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;
    if(![...document.querySelectorAll('[data-notice-post]')].some(element=>{const r=element.getBoundingClientRect();return r.bottom>140&&r.top<innerHeight;}))blank++;
   }
   frames.sort((a,b)=>a-b);return {commits:window.feedCommits,medianFrameMs:frames[60],p95FrameMs:frames[114],blankFrames:blank,scrollY};
   };
   const cold=await measure();window.scrollTo(0,0);
   for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);
   return {...await measure(),cold};
  });
  assert.equal(timing.blankFrames,0);assert.equal(timing.cold.blankFrames,0);assert(timing.scrollY>4000);feedSamples.push(timing);console.log(JSON.stringify({feedPerformance:true,pwa,cpuThrottle:4,...timing}));await page.close();
 }
 assert(feedSamples[1].commits<feedSamples[0].commits*.7,'The iOS PWA should avoid redundant scroll renders');
}finally{await browser?.close();await server.close();}
  },

};

const command = process.argv[2];
if (command === '--list' || !Object.hasOwn(suites, command)) {
  console.log('Usage: node scripts/verify-layout.mjs <command> [arguments]\n\n' + Object.keys(suites).join('\n'));
  if (command !== '--list') process.exitCode = 2;
} else {
  // Preserve the original positional arguments consumed by individual checks.
  process.argv.splice(2, 1);
  await suites[command]();
}
