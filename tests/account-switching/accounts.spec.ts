import {test,expect,type Page} from '@playwright/test';
import {loadEnv} from 'vite';
const host=new URL(loadEnv('development',process.cwd(),'VITE_').VITE_SUPABASE_URL).hostname;
const ref=host.split('.')[0];
const authKey=`sb-${ref}-auth-token`,savedKey=`lime_saved_accounts:${host}:v1`;
const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333'];
const users=ids.map((id,index)=>({id,email:`${['alice','bob','clara'][index]}@example.invalid`,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{username:['alice','bob','clara'][index],display_name:['Alice','Bob','Clara'][index]},created_at:new Date().toISOString()}));
const token=(id:string,expired=false)=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+(expired?-60:3600)})).toString('base64url')}.${Buffer.from('test-signature').toString('base64url')}`;
const sessions=users.map(u=>({access_token:token(u.id),refresh_token:`fixture-refresh-${u.id}`,expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:u}));
const profile=(u:typeof users[number])=>({id:u.id,username:u.user_metadata.username,display_name:u.user_metadata.display_name,avatar_url:'',is_official:u.id===ids[0],bio:'',location:'',cover_url:'',created_at:u.created_at});
async function setup(page:Page,standalone:boolean,options:{expired?:boolean;revoked?:boolean}={}) {
  await page.addInitScript(({authKey,savedKey,sessions,expiredToken,standalone})=>{
    if(standalone) {Object.defineProperty(navigator,'standalone',{get:()=>true});const original=window.matchMedia.bind(window);window.matchMedia=(query)=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};}
    if(localStorage.getItem('lime-account-test-seeded'))return;
    localStorage.setItem('lime-account-test-seeded','1');
    localStorage.setItem(authKey,JSON.stringify(sessions[0]));
    localStorage.setItem(savedKey,JSON.stringify(sessions.slice(0,2).map((s,index)=>({id:s.user.id,username:s.user.user_metadata.username,displayName:s.user.user_metadata.display_name,avatarUrl:'',accessToken:index===1&&expiredToken?expiredToken:s.access_token,refreshToken:s.refresh_token}))));
  },{authKey,savedKey,sessions,expiredToken:options.expired?token(ids[1],true):null,standalone});
  await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`import {getCurrentUserId} from '/RaimuNoteSNS.github.io/src/lib/currentUser.ts';
    const profiles=${JSON.stringify(users.map(profile))};
    const load=async()=>{const id=await getCurrentUserId();window.__feedViewers=[...(window.__feedViewers??[]),id];const p=profiles.find(p=>p.id===id);return [{id:'post-'+id,userId:id,content:p.username+'のみの投稿',createdAt:new Date().toISOString(),imageUrls:[],visibility:'following',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:p.username,displayName:p.display_name,avatarUrl:''}}];};
    export const getFeed=load,getFollowingFeed=load,getPostsByUser=load,getProfilePosts=load,getLikedPostsByUser=load,searchPosts=load;
    export const getPostById=async()=> (await load())[0];export const createPost=async()=> (await load())[0];export const toggleLike=async()=>({liked:true});export const toggleRepost=async()=>({reposted:true});export const deletePost=async()=>{};export const getPostLikers=async()=>[];`}));
  await page.route('**/*.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS,HEAD','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
    if(url.pathname==='/auth/v1/user') {
      const raw=req.headers().authorization?.replace(/^Bearer /,'') ?? '';
      let id='';try{id=JSON.parse(Buffer.from(raw.split('.')[1],'base64url').toString()).sub;}catch{}
      const user=users.find(user=>user.id===id);
      return route.fulfill({status:user?200:401,contentType:'application/json',body:JSON.stringify(user??{message:'invalid fixture token'})});
    }
    if(url.pathname==='/auth/v1/token') {
      const body=req.postDataJSON();
      if(url.searchParams.get('grant_type')==='password')return route.fulfill({contentType:'application/json',body:JSON.stringify(sessions[2])});
      if(options.revoked)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'refresh_token_not_found',message:'Invalid Refresh Token'})});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({...sessions[1],refresh_token:'rotated-bob-refresh'})});
    }
    if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204,body:''});
    const single=(req.headers().accept ?? '').includes('vnd.pgrst.object');
    let data:unknown=single?null:[];
    if(url.pathname.endsWith('/profiles')) {
      const idFilter=url.searchParams.get('id');
      const id=idFilter?.startsWith('eq.')?idFilter.slice(3):undefined,username=url.searchParams.get('username')?.replace(/^eq\./,'');
      const wanted=idFilter?.startsWith('in.')?idFilter.slice(4,-1).split(','):null;
      const rows=users.filter(u=>wanted?wanted.includes(u.id):id?u.id===id:username?u.user_metadata.username===username:true).map(profile);data=single?rows[0]??null:rows;
    }
    if(url.pathname.endsWith('/get_profile_activity_count'))data=1;
    if(url.pathname.includes('get-trends'))data=[];
    return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0','access-control-expose-headers':'content-range'},body:req.method()==='HEAD'?'':JSON.stringify(data)});
  });
  await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'}));
}
async function press(page:Page,locator:ReturnType<Page['locator']>){if((await page.evaluate(()=>navigator.maxTouchPoints))>0)await locator.tap();else await locator.click();}
async function openAccounts(page:Page){
  const desktop=(page.viewportSize()?.width??0)>=768;
  if(desktop)await press(page,page.locator('[data-lime-sidebar-account]'));
  else {await press(page,page.getByRole('button',{name:'メニューを開く',exact:true}));await press(page,page.getByRole('button',{name:'アカウント一覧を開く',exact:true}));}
  await expect(page.locator('[data-lime-account-switcher]')).toBeVisible();
}
test('switches saved accounts with real auth sessions and persists the selected account after reload',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await setup(page,info.project.name.includes('PWA'));await page.goto('./');
  await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true})).toContainText('@alice');
  await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true}).getByAltText('認証済み')).toBeVisible();
  await expect(page.getByRole('button',{name:'アカウントを管理',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-lime-sidebar-account] .lucide-ellipsis')).toHaveCount(0);
  if((page.viewportSize()?.width??0)<768) {
    await expect(page.locator('[data-lime-mobile-account-sheet]')).toBeVisible();
    await expect(page.getByRole('heading',{name:'アカウント',exact:true})).toBeVisible();
  } else expect(await page.locator('[data-lime-account-switcher]').evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('0px');
  await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();await expect(page.getByText('aliceのみの投稿',{exact:true})).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.reload();await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await expect(page.getByRole('button',{name:'Alice @aliceに切り替える',exact:true}).getByAltText('認証済み')).toBeVisible();await page.screenshot({path:info.outputPath('account-menu.png'),animations:'disabled'});await press(page,page.getByRole('button',{name:'Alice @aliceに切り替える',exact:true}));
  await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('adding and cancelling an account keeps previous sessions and successful login adds a new account',async({page},info)=>{
  await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await press(page,page.getByRole('button',{name:'既存のアカウントを追加',exact:true}));
  await expect(page.getByRole('heading',{name:'アカウントを追加',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'戻る',exact:true}).click();await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await press(page,page.getByRole('button',{name:'既存のアカウントを追加',exact:true}));
  await page.getByLabel('メールアドレス',{exact:true}).fill('clara@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill('fixture-password');await press(page,page.getByRole('button',{name:'ログインする',exact:true}));
  await expect(page.getByText('claraのみの投稿',{exact:true})).toBeVisible();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),savedKey);expect(saved.map((row:any)=>row.username)).toEqual(['alice','bob','clara']);
});
test('expired saved sessions refresh and persist the rotated token',async({page},info)=>{
  await setup(page,info.project.name.includes('PWA'),{expired:true});await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]').find((row:any)=>row.username==='bob')?.refreshToken,savedKey)).toBe('rotated-bob-refresh');
  await page.reload();await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
});
test('invalid target sessions restore the original account',async({page},info)=>{
  await setup(page,info.project.name.includes('PWA'),{expired:true,revoked:true});await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  await expect(page.getByText('このアカウントは再ログインが必要です',{exact:true})).toBeVisible();
  await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
});
test('logs out only the active account and allows a saved account to sign in again',async({page},info)=>{
  await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await press(page,page.getByRole('button',{name:'@aliceからログアウト',exact:true}));
  await expect(page.getByRole('button',{name:'ログインする',exact:true})).toBeVisible();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),savedKey);expect(saved.map((row:any)=>row.username)).toEqual(['bob']);
  await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
});
test('mobile sheet editing removes only the selected inactive account',async({page},info)=>{
  test.skip((page.viewportSize()?.width??0)>=768,'Editing is provided only in the mobile sheet');
  await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);await press(page,page.getByRole('button',{name:'編集',exact:true}));
  await press(page,page.getByRole('button',{name:'@bobをこの端末の保存から削除',exact:true}));
  await expect(page.getByRole('button',{name:'Bob @bobに切り替える',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true})).toContainText('@alice');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
});
test('account list remains scrollable with many accounts and preserves its actions',async({page},info)=>{
  await page.emulateMedia({colorScheme:'dark'});
  await setup(page,info.project.name.includes('PWA'));
  await page.addInitScript(key=>{
    localStorage.setItem('theme','dark');
    const accounts=JSON.parse(localStorage.getItem(key)??'[]');
    if(accounts.length>2)return;
    for(let i=1;i<=15;i++)accounts.push({id:`extra-${i}`,username:`account${i}`,displayName:`Account ${i}`,avatarUrl:'',accessToken:'fixture',refreshToken:'fixture'});
    localStorage.setItem(key,JSON.stringify(accounts));
  },savedKey);
  await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  await openAccounts(page);
  const list=page.locator('[data-lime-account-list]');
  if((page.viewportSize()?.width??0)<768)await expect.poll(()=>page.evaluate(()=>{
    const sheet=document.querySelector('[data-lime-mobile-account-sheet]')!;
    return sheet.contains(document.elementFromPoint(innerWidth-45,innerHeight-125));
  })).toBe(true);
  expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await list.getByRole('button',{name:'Account 15 @account15に切り替える',exact:true}).scrollIntoViewIfNeeded();
  await expect(list.getByText('@account15',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'既存のアカウントを追加',exact:true})).toBeVisible();
  await list.evaluate(el=>{el.scrollTop=0;});
  await expect(list.getByAltText('認証済み')).toBeVisible();
  await page.screenshot({path:info.outputPath('account-list-dark.png'),animations:'disabled'});
});

// Drawer gestures must not capture the nested avatar/name that receives a tap.
test('mobile account controls preserve touch targets for switching and adding',async({page},info)=>{
 test.skip((page.viewportSize()?.width??0)>=768,'Touch sheet controls');
 await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
 await openAccounts(page);
 await page.evaluate(()=>{const original=Element.prototype.setPointerCapture;window.__accountCaptures=0;Element.prototype.setPointerCapture=function(id){if(this.closest('[data-lime-mobile-account-sheet]'))window.__accountCaptures++;return original.call(this,id);};});
 await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}).getByText('Bob',{exact:true}));
 await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__accountCaptures)).toBe(0);
 await openAccounts(page);await press(page,page.getByRole('button',{name:'既存のアカウントを追加',exact:true}).locator('svg'));
 await expect(page.getByRole('heading',{name:'アカウントを追加',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__accountCaptures)).toBe(0);
 await page.getByLabel('メールアドレス',{exact:true}).tap();await expect(page.getByLabel('メールアドレス',{exact:true})).toBeFocused();
});

test('unread badges exclude viewed notifications and keep saved-account sessions isolated',async({page},info)=>{
 await setup(page,info.project.name.includes('PWA'));
 const rows=Array.from({length:4},(_,index)=>({id:`notification-${index}`,user_id:index===3?ids[1]:ids[0],actor_id:ids[1],post_id:null,type:index===1?'mention':'follow',actor_name:'Bob',actor_username:'bob',actor_avatar_url:'',content_preview:null,is_read:index===2,created_at:new Date().toISOString()}));
 const identities:string[]=[];
 await page.route('**/*.supabase.co/rest/v1/notifications*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,HEAD,PATCH,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
  const userId=url.searchParams.get('user_id')?.replace(/^eq\./,'');
  const jwt=req.headers().authorization?.replace(/^Bearer /,'')??'';
  const identity=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString()).sub;
  identities.push(identity);expect(identity).toBe(userId);
  if(req.method()==='PATCH'){
   const filter=url.searchParams.get('id')??'';
   rows.filter(row=>row.user_id===userId&&filter.includes(row.id)).forEach(row=>{row.is_read=true;});
   return route.fulfill({status:204,body:''});
  }
  const result=rows.filter(row=>row.user_id===userId&&(url.searchParams.get('is_read')!=='eq.false'||!row.is_read));
  return route.fulfill({contentType:'application/json',headers:{'content-range':`0-0/${result.length}`,'access-control-expose-headers':'content-range'},body:req.method()==='HEAD'?'':JSON.stringify(result)});
 });
 await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
 const notificationControl=()=> (page.viewportSize()?.width??0)>=768?page.getByRole('button',{name:'通知',exact:true}).filter({visible:true}).first():page.locator('a[href$="/notifications"]').filter({visible:true}).first();
 const notification=notificationControl();
 await expect(notification.locator('[data-lime-unread-count="2"]')).toBeVisible();
 await expect(notification.locator('[data-lime-unread-count="2"]')).toHaveCSS('font-size','9px');
 await openAccounts(page);
 await expect(page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}).locator('[data-lime-unread-count="1"]')).toBeVisible();
 await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true}).locator('[data-lime-unread-count="2"]')).toBeVisible();
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
 expect(identities).toContain(ids[1]);
 await page.screenshot({path:info.outputPath('unread-account-counts.png')});
 await page.goto('notifications?tab=mention');
 await expect.poll(()=>rows.filter(row=>row.user_id===ids[0]&&!row.is_read).length).toBe(1);
 await expect(notificationControl().locator('[data-lime-unread-count="1"]')).toBeVisible();
 await page.goto('notifications');
 await expect.poll(()=>rows.filter(row=>row.user_id===ids[0]&&!row.is_read).length).toBe(0);
 await expect(notificationControl().locator('[data-lime-unread-count]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('notifications-read.png')});
 await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
 await openAccounts(page);
 await expect(page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}).locator('[data-lime-unread-count="1"]')).toBeVisible();
 await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true}).locator('[data-lime-unread-count]')).toHaveCount(0);
});

test('mobile sidebar places identity below avatars and keeps existing navigation labels',async({page},info)=>{
 test.skip((page.viewportSize()?.width??0)>=768,'Mobile drawer only');
 await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
 await press(page,page.getByRole('button',{name:'メニューを開く',exact:true}));
 const drawer=page.locator('aside[data-lime-mobile-sidebar]:not([data-lime-desktop-sidebar])');
 await expect(drawer).toBeVisible();
 const name=await drawer.locator('[data-lime-sidebar-profile-name]').boundingBox(),avatar=await drawer.locator('[data-lime-sidebar-profile-layout] > span').first().boundingBox();
 expect(name!.y).toBeGreaterThan(avatar!.y+avatar!.height);
 await expect(drawer.getByRole('button',{name:'アカウント一覧を開く',exact:true}).locator('.lucide-circle-ellipsis')).toBeVisible();
 await expect(drawer.getByRole('button',{name:'LimeMaps',exact:true})).toBeVisible();
 await expect(drawer.getByRole('link',{name:/フォロー中/})).toBeVisible();
 await page.screenshot({path:info.outputPath('mobile-sidebar.png')});
 await drawer.getByRole('button',{name:'設定',exact:true}).scrollIntoViewIfNeeded();await press(page,drawer.getByRole('button',{name:'設定',exact:true}));
 await expect(page).toHaveURL(/settings$/);await expect(page.locator('[data-lime-settings-mobile-title]')).toContainText('@alice');
 await page.screenshot({path:info.outputPath('mobile-settings.png')});
});
