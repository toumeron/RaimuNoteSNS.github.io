# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accounts.spec.ts >> unread badges exclude viewed notifications and keep saved-account sessions isolated
- Location: tests/account-switching/accounts.spec.ts:162:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.tap: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'メニューを開く', exact: true })

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e4]:
    - region "Notifications (F8)":
      - list
    - region "Notifications alt+T"
    - generic [ref=f1e5]:
      - banner [ref=f1e6]:
        - generic [ref=f1e7]:
          - heading "通知" [level=1] [ref=f1e9]
          - tablist "通知の種類" [ref=f1e10]:
            - tab "すべて" [selected] [ref=f1e11] [cursor=pointer]
            - tab "メンション" [ref=f1e12] [cursor=pointer]
      - main [ref=f1e13]:
        - tabpanel "すべて" [ref=f1e15]:
          - link "B Bobさんがあなたをフォローしました 10月9日" [ref=f1e16] [cursor=pointer]:
            - /url: /RaimuNoteSNS.github.io/u/bob
            - generic [ref=f1e20]:
              - generic [ref=f1e21]: B
              - paragraph [ref=f1e24]: Bobさんがあなたをフォローしました
              - time [ref=f1e25]: 10月9日
  - button "新規投稿" [ref=f1e26] [cursor=pointer]
  - navigation [ref=f1e30]:
    - list [ref=f1e31]:
      - listitem [ref=f1e32]:
        - link [ref=f1e33] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=f1e38]:
        - link [ref=f1e39] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=f1e44]:
        - link [ref=f1e45] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/u/alice
      - listitem [ref=f1e50]:
        - link [ref=f1e51] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/notifications
      - listitem [ref=f1e56]:
        - link [ref=f1e57] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=f1e61]:
        - link [ref=f1e62] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/settings
```

# Test source

```ts
  1   | import {test,expect,type Page} from '@playwright/test';
  2   | import {loadEnv} from 'vite';
  3   | const host=new URL(loadEnv('development',process.cwd(),'VITE_').VITE_SUPABASE_URL).hostname;
  4   | const ref=host.split('.')[0];
  5   | const authKey=`sb-${ref}-auth-token`,savedKey=`lime_saved_accounts:${host}:v1`;
  6   | const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333'];
  7   | const users=ids.map((id,index)=>({id,email:`${['alice','bob','clara'][index]}@example.invalid`,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{username:['alice','bob','clara'][index],display_name:['Alice','Bob','Clara'][index]},created_at:new Date().toISOString()}));
  8   | const token=(id:string,expired=false)=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+(expired?-60:3600)})).toString('base64url')}.${Buffer.from('test-signature').toString('base64url')}`;
  9   | const sessions=users.map(u=>({access_token:token(u.id),refresh_token:`fixture-refresh-${u.id}`,expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:u}));
  10  | const profile=(u:typeof users[number])=>({id:u.id,username:u.user_metadata.username,display_name:u.user_metadata.display_name,avatar_url:'',is_official:u.id===ids[0],bio:'',location:'',cover_url:'',created_at:u.created_at});
  11  | async function setup(page:Page,standalone:boolean,options:{expired?:boolean;revoked?:boolean}={}) {
  12  |   await page.addInitScript(({authKey,savedKey,sessions,expiredToken,standalone})=>{
  13  |     if(standalone) {Object.defineProperty(navigator,'standalone',{get:()=>true});const original=window.matchMedia.bind(window);window.matchMedia=(query)=>{const result=original(query);if(query==='(display-mode: standalone)')Object.defineProperty(result,'matches',{value:true});return result;};}
  14  |     if(localStorage.getItem('lime-account-test-seeded'))return;
  15  |     localStorage.setItem('lime-account-test-seeded','1');
  16  |     localStorage.setItem(authKey,JSON.stringify(sessions[0]));
  17  |     localStorage.setItem(savedKey,JSON.stringify(sessions.slice(0,2).map((s,index)=>({id:s.user.id,username:s.user.user_metadata.username,displayName:s.user.user_metadata.display_name,avatarUrl:'',accessToken:index===1&&expiredToken?expiredToken:s.access_token,refreshToken:s.refresh_token}))));
  18  |   },{authKey,savedKey,sessions,expiredToken:options.expired?token(ids[1],true):null,standalone});
  19  |   await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`import {getCurrentUserId} from '/RaimuNoteSNS.github.io/src/lib/currentUser.ts';
  20  |     const profiles=${JSON.stringify(users.map(profile))};
  21  |     const load=async()=>{const id=await getCurrentUserId();window.__feedViewers=[...(window.__feedViewers??[]),id];const p=profiles.find(p=>p.id===id);return [{id:'post-'+id,userId:id,content:p.username+'のみの投稿',createdAt:new Date().toISOString(),imageUrls:[],visibility:'following',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:p.username,displayName:p.display_name,avatarUrl:''}}];};
  22  |     export const getFeed=load,getFollowingFeed=load,getPostsByUser=load,getProfilePosts=load,getLikedPostsByUser=load,searchPosts=load;
  23  |     export const getPostById=async()=> (await load())[0];export const createPost=async()=> (await load())[0];export const toggleLike=async()=>({liked:true});export const toggleRepost=async()=>({reposted:true});export const deletePost=async()=>{};export const getPostLikers=async()=>[];`}));
  24  |   await page.route('**/*.supabase.co/**',async route=>{
  25  |     const req=route.request(),url=new URL(req.url());
  26  |     if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS,HEAD','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
  27  |     if(url.pathname==='/auth/v1/user') {
  28  |       const raw=req.headers().authorization?.replace(/^Bearer /,'') ?? '';
  29  |       let id='';try{id=JSON.parse(Buffer.from(raw.split('.')[1],'base64url').toString()).sub;}catch{}
  30  |       const user=users.find(user=>user.id===id);
  31  |       return route.fulfill({status:user?200:401,contentType:'application/json',body:JSON.stringify(user??{message:'invalid fixture token'})});
  32  |     }
  33  |     if(url.pathname==='/auth/v1/token') {
  34  |       const body=req.postDataJSON();
  35  |       if(url.searchParams.get('grant_type')==='password')return route.fulfill({contentType:'application/json',body:JSON.stringify(sessions[2])});
  36  |       if(options.revoked)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'refresh_token_not_found',message:'Invalid Refresh Token'})});
  37  |       return route.fulfill({contentType:'application/json',body:JSON.stringify({...sessions[1],refresh_token:'rotated-bob-refresh'})});
  38  |     }
  39  |     if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204,body:''});
  40  |     const single=(req.headers().accept ?? '').includes('vnd.pgrst.object');
  41  |     let data:unknown=single?null:[];
  42  |     if(url.pathname.endsWith('/profiles')) {
  43  |       const idFilter=url.searchParams.get('id');
  44  |       const id=idFilter?.startsWith('eq.')?idFilter.slice(3):undefined,username=url.searchParams.get('username')?.replace(/^eq\./,'');
  45  |       const wanted=idFilter?.startsWith('in.')?idFilter.slice(4,-1).split(','):null;
  46  |       const rows=users.filter(u=>wanted?wanted.includes(u.id):id?u.id===id:username?u.user_metadata.username===username:true).map(profile);data=single?rows[0]??null:rows;
  47  |     }
  48  |     if(url.pathname.endsWith('/get_profile_activity_count'))data=1;
  49  |     if(url.pathname.includes('get-trends'))data=[];
  50  |     return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0','access-control-expose-headers':'content-range'},body:req.method()==='HEAD'?'':JSON.stringify(data)});
  51  |   });
  52  |   await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'}));
  53  | }
> 54  | async function press(page:Page,locator:ReturnType<Page['locator']>){if((await page.evaluate(()=>navigator.maxTouchPoints))>0)await locator.tap();else await locator.click();}
      |                                                                                                                                            ^ Error: locator.tap: Test timeout of 45000ms exceeded.
  55  | async function openAccounts(page:Page){
  56  |   const desktop=(page.viewportSize()?.width??0)>=768;
  57  |   if(desktop)await press(page,page.locator('[data-lime-sidebar-account]'));
  58  |   else {await press(page,page.getByRole('button',{name:'メニューを開く',exact:true}));await press(page,page.getByRole('button',{name:'アカウント一覧を開く',exact:true}));}
  59  |   await expect(page.locator('[data-lime-account-switcher]')).toBeVisible();
  60  | }
  61  | test('switches saved accounts with real auth sessions and persists the selected account after reload',async({page},info)=>{
  62  |   const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  63  |   await setup(page,info.project.name.includes('PWA'));await page.goto('./');
  64  |   await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  65  |   await openAccounts(page);await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true})).toContainText('@alice');
  66  |   await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true}).getByAltText('認証済み')).toBeVisible();
  67  |   await expect(page.getByRole('button',{name:'アカウントを管理',exact:true})).toHaveCount(0);
  68  |   await expect(page.locator('[data-lime-sidebar-account] .lucide-ellipsis')).toHaveCount(0);
  69  |   if((page.viewportSize()?.width??0)<768) {
  70  |     await expect(page.locator('[data-lime-mobile-account-sheet]')).toBeVisible();
  71  |     await expect(page.getByRole('heading',{name:'アカウント',exact:true})).toBeVisible();
  72  |   } else expect(await page.locator('[data-lime-account-switcher]').evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('0px');
  73  |   await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  74  |   await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();await expect(page.getByText('aliceのみの投稿',{exact:true})).toHaveCount(0);
  75  |   await page.waitForLoadState('networkidle');
  76  |   await page.reload();await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  77  |   await openAccounts(page);await expect(page.getByRole('button',{name:'Alice @aliceに切り替える',exact:true}).getByAltText('認証済み')).toBeVisible();await page.screenshot({path:info.outputPath('account-menu.png'),animations:'disabled'});await press(page,page.getByRole('button',{name:'Alice @aliceに切り替える',exact:true}));
  78  |   await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  79  |   expect(errors).toEqual([]);
  80  | });
  81  | test('adding and cancelling an account keeps previous sessions and successful login adds a new account',async({page},info)=>{
  82  |   await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  83  |   await openAccounts(page);await press(page,page.getByRole('button',{name:'既存のアカウントを追加',exact:true}));
  84  |   await expect(page.getByRole('heading',{name:'アカウントを追加',exact:true})).toBeVisible();
  85  |   await page.getByRole('link',{name:'戻る',exact:true}).click();await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  86  |   await openAccounts(page);await press(page,page.getByRole('button',{name:'既存のアカウントを追加',exact:true}));
  87  |   await page.getByLabel('メールアドレス',{exact:true}).fill('clara@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill('fixture-password');await press(page,page.getByRole('button',{name:'ログインする',exact:true}));
  88  |   await expect(page.getByText('claraのみの投稿',{exact:true})).toBeVisible();
  89  |   const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),savedKey);expect(saved.map((row:any)=>row.username)).toEqual(['alice','bob','clara']);
  90  | });
  91  | test('expired saved sessions refresh and persist the rotated token',async({page},info)=>{
  92  |   await setup(page,info.project.name.includes('PWA'),{expired:true});await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  93  |   await openAccounts(page);await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  94  |   await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  95  |   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]').find((row:any)=>row.username==='bob')?.refreshToken,savedKey)).toBe('rotated-bob-refresh');
  96  |   await page.reload();await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  97  | });
  98  | test('invalid target sessions restore the original account',async({page},info)=>{
  99  |   await setup(page,info.project.name.includes('PWA'),{expired:true,revoked:true});await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  100 |   await openAccounts(page);await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  101 |   await expect(page.getByText('このアカウントは再ログインが必要です',{exact:true})).toBeVisible();
  102 |   await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  103 |   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
  104 | });
  105 | test('logs out only the active account and allows a saved account to sign in again',async({page},info)=>{
  106 |   await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  107 |   await openAccounts(page);await press(page,page.getByRole('button',{name:'@aliceからログアウト',exact:true}));
  108 |   await expect(page.getByRole('button',{name:'ログインする',exact:true})).toBeVisible();
  109 |   const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),savedKey);expect(saved.map((row:any)=>row.username)).toEqual(['bob']);
  110 |   await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  111 | });
  112 | test('mobile sheet editing removes only the selected inactive account',async({page},info)=>{
  113 |   test.skip((page.viewportSize()?.width??0)>=768,'Editing is provided only in the mobile sheet');
  114 |   await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  115 |   await openAccounts(page);await press(page,page.getByRole('button',{name:'編集',exact:true}));
  116 |   await press(page,page.getByRole('button',{name:'@bobをこの端末の保存から削除',exact:true}));
  117 |   await expect(page.getByRole('button',{name:'Bob @bobに切り替える',exact:true})).toHaveCount(0);
  118 |   await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true})).toContainText('@alice');
  119 |   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
  120 | });
  121 | test('account list remains scrollable with many accounts and preserves its actions',async({page},info)=>{
  122 |   await page.emulateMedia({colorScheme:'dark'});
  123 |   await setup(page,info.project.name.includes('PWA'));
  124 |   await page.addInitScript(key=>{
  125 |     localStorage.setItem('theme','dark');
  126 |     const accounts=JSON.parse(localStorage.getItem(key)??'[]');
  127 |     if(accounts.length>2)return;
  128 |     for(let i=1;i<=15;i++)accounts.push({id:`extra-${i}`,username:`account${i}`,displayName:`Account ${i}`,avatarUrl:'',accessToken:'fixture',refreshToken:'fixture'});
  129 |     localStorage.setItem(key,JSON.stringify(accounts));
  130 |   },savedKey);
  131 |   await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  132 |   await openAccounts(page);
  133 |   const list=page.locator('[data-lime-account-list]');
  134 |   if((page.viewportSize()?.width??0)<768)await expect.poll(()=>page.evaluate(()=>{
  135 |     const sheet=document.querySelector('[data-lime-mobile-account-sheet]')!;
  136 |     return sheet.contains(document.elementFromPoint(innerWidth-45,innerHeight-125));
  137 |   })).toBe(true);
  138 |   expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  139 |   await list.getByRole('button',{name:'Account 15 @account15に切り替える',exact:true}).scrollIntoViewIfNeeded();
  140 |   await expect(list.getByText('@account15',{exact:true})).toBeVisible();
  141 |   await expect(page.getByRole('button',{name:'既存のアカウントを追加',exact:true})).toBeVisible();
  142 |   await list.evaluate(el=>{el.scrollTop=0;});
  143 |   await expect(list.getByAltText('認証済み')).toBeVisible();
  144 |   await page.screenshot({path:info.outputPath('account-list-dark.png'),animations:'disabled'});
  145 | });
  146 | 
  147 | // Drawer gestures must not capture the nested avatar/name that receives a tap.
  148 | test('mobile account controls preserve touch targets for switching and adding',async({page},info)=>{
  149 |  test.skip((page.viewportSize()?.width??0)>=768,'Touch sheet controls');
  150 |  await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  151 |  await openAccounts(page);
  152 |  await page.evaluate(()=>{const original=Element.prototype.setPointerCapture;window.__accountCaptures=0;Element.prototype.setPointerCapture=function(id){if(this.closest('[data-lime-mobile-account-sheet]'))window.__accountCaptures++;return original.call(this,id);};});
  153 |  await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}).getByText('Bob',{exact:true}));
  154 |  await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
```