# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: maps.spec.ts >> another user cannot open the location editor
- Location: tests/maps/maps.spec.ts:44:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'ポストを見る', exact: true })
    - locator resolved to <button type="button">ポストを見る</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
      - waiting 100ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action
    - <html lang="ja" class="light">…</html> intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Notifications (F8)":
    - list
  - region "Notifications alt+T"
  - generic [ref=e3]:
    - complementary [ref=e5]:
      - generic [ref=e6]:
        - navigation [ref=e7]:
          - generic [ref=e8]:
            - button "ホーム" [ref=e9] [cursor=pointer]
            - button "プロフィール" [ref=e13] [cursor=pointer]
            - button "検索" [ref=e17] [cursor=pointer]
            - button "通知" [ref=e21] [cursor=pointer]
            - button "LimeAI" [ref=e25] [cursor=pointer]
            - button "設定" [ref=e28] [cursor=pointer]
            - button "もっと見る" [ref=e32] [cursor=pointer]
          - button "ポストする" [ref=e35] [cursor=pointer]
        - 'button "ログイン中のアカウント: 地図ユーザー（アカウント切り替え）" [ref=e41] [cursor=pointer]':
          - generic [ref=e42]: 地
    - main [ref=e46]:
      - generic [ref=e47]:
        - generic "LimeMapsの地図" [ref=e49]:
          - button "地図ユーザーのポスト" [ref=e50] [cursor=pointer]
          - generic:
            - generic:
              - generic [ref=e52]:
                - button "拡大" [ref=e53] [cursor=pointer]: +
                - button "縮小" [ref=e54] [cursor=pointer]: −
              - generic [ref=e55]:
                - link "Leaflet" [ref=e56]:
                  - /url: https://leafletjs.com
                - text: "| ©"
                - link "OpenStreetMap" [ref=e61]:
                  - /url: https://www.openstreetmap.org/copyright
                - text: contributors
        - generic:
          - generic [ref=e62]: LimeMaps
          - textbox "ポスト・ハッシュタグを検索" [ref=e67]
```

# Test source

```ts
  1  | import {test,expect,type Page} from '@playwright/test';
  2  | const viewer={id:'11111111-1111-4111-8111-111111111111',username:'viewer',displayName:'地図ユーザー',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
  3  | const post={id:'22222222-2222-4222-8222-222222222222',userId:viewer.id,content:'地図に載せたポスト',createdAt:'2026-10-09T00:00:00Z',imageUrls:[],likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,visibility:'public',author:viewer,mapLocation:{latitude:36.2,longitude:138.25}};
  4  | async function setup(page:Page,own=true){
  5  |  const mapPost=own?post:{...post,userId:"other",author:{...viewer,id:"other"}};
  6  |  page.on('pageerror',e=>console.log('BROWSER ERROR',e.message));
  7  |  await page.addInitScript(()=>{(window as any).__locationCalls=0;Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>{(window as any).__locationCalls++},watchPosition:()=>{(window as any).__locationCalls++}}});});
  8  |  await page.route('**/src/hooks/useAuth.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(viewer)},loading:false,accounts:[],logout:async()=>{}});export const AuthProvider=({children})=>children;`}));
  9  |  await page.route('**/src/lib/currentUser.ts*',r=>r.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${viewer.id}';`}));
  10 |  await page.route('**/src/api/posts.ts*',r=>r.fulfill({contentType:'application/javascript',body:`const p=${JSON.stringify(mapPost)};export const getMapPosts=async()=>[p];export const setPostMapLocation=async(id,point)=>{window.__savedLocation={id,point};p.mapLocation=point;};export const getPostById=async()=>p;export const getFeed=async()=>[p],getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,getHighlightedPosts=getFeed,searchPosts=getFeed;export const toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[],createPost=async input=>{window.__createdPost=input;return {...p,...input,id:'new-post'};};`}));
  11 |  await page.route('**/*.supabase.co/**',r=>r.fulfill({contentType:'application/json',body:r.request().method()==='HEAD'?'':'[]',headers:{'content-range':'0-0/0'}}));
  12 |  await page.route('**/public.api.bsky.app/**',r=>r.fulfill({contentType:'application/json',body:'{"posts":[],"feed":[]}'}));
  13 |  await page.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK9sAAAAASUVORK5CYII=','base64')}));
  14 | }
  15 | test.beforeEach(async({page})=>setup(page));
  16 | test('map selection opens the existing composer and submits the chosen location without device location',async({page},info)=>{
  17 |  await page.goto('maps');await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
  18 |  const map=page.locator('.lime-map').first();await expect(map.locator('.leaflet-tile-loaded').first()).toBeVisible();
  19 |  await map.click({position:{x:140,y:180}});
  20 |  await page.locator('.lime-map-pin-selected').click();
  21 |  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'ポストする',exact:true})).toBeVisible();
  22 |  await dialog.locator('textarea').fill('ピンから投稿します');await dialog.getByRole('button',{name:'ポスト',exact:true}).click();await expect(dialog).toHaveCount(0);
  23 |  const submitted=await page.evaluate(()=>(window as any).__createdPost);expect(submitted.content).toBe('ピンから投稿します');expect(submitted.mapLocation.latitude).toBeGreaterThan(-90);expect(submitted.mapLocation.longitude).toBeGreaterThan(-180);
  24 |  expect(await page.evaluate(()=>(window as any).__locationCalls)).toBe(0);
  25 |  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  26 |  await page.screenshot({path:info.outputPath('maps.png'),animations:'disabled'});
  27 | });
  28 | test('public marker shows author and post; own edit saves and removes location',async({page})=>{
  29 |  await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  30 |  const card=page.locator('[data-lime-map-selected-post]');await expect(card).toContainText('地図に載せたポスト');await expect(card).toContainText('地図ユーザー');
  31 |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();
  32 |  let dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await expect(dialog.getByRole('heading',{name:'ポストを編集'})).toBeVisible();await dialog.locator('.lime-map').click({position:{x:150,y:180}});await dialog.getByRole('button',{name:'保存する',exact:true}).click();await expect(page.getByRole('heading',{name:'ポストを編集'})).toHaveCount(0);
  33 |  expect((await page.evaluate(()=>(window as any).__savedLocation)).id).toBe(post.id);
  34 |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await dialog.getByRole('button',{name:'場所を削除',exact:true}).click();await expect(dialog).toHaveCount(0);
  35 |  expect((await page.evaluate(()=>(window as any).__savedLocation)).point).toBeNull();
  36 | });
  37 | test('desktop More and mobile sidebar link to LimeMaps',async({page})=>{
  38 |  await page.goto('search');
  39 |  if(page.viewportSize()!.width>=768) await page.getByRole('button',{name:'もっと見る',exact:true}).click();
  40 |  else await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
  41 |  await page.getByText('LimeMaps',{exact:true}).click();await expect(page).toHaveURL(/\/maps$/);await expect(page.locator('.lime-map')).toBeVisible();
  42 | });
  43 | 
  44 | test('another user cannot open the location editor',async({page})=>{
> 45 |  await setup(page,false);await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
     |                                                                                                                                                                                   ^ Error: locator.click: Test timeout of 45000ms exceeded.
  46 |  await page.locator('[data-lime-map-selected-post]').getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  47 |  await expect(page.getByRole('button',{name:'編集',exact:true})).toHaveCount(0);
  48 | });
  49 | 
  50 | test('map fills the area outside navigation and keeps reference metadata on tiles',async({page})=>{
  51 |  await page.goto('maps');const map=page.locator('[data-lime-maps]');await expect(map).toBeVisible();
  52 |  await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
  53 |  const bounds=(await map.boundingBox())!;expect(bounds.y).toBe(0);
  54 |  if(page.viewportSize()!.width<768){const nav=(await page.locator('[data-lime-bottom-nav-root]').boundingBox())!;expect(bounds.x).toBe(0);expect(bounds.width).toBe(page.viewportSize()!.width);expect(bounds.height).toBeCloseTo(nav.y,0);await page.getByRole('button',{name:'メニューを開く',exact:true}).click();await expect(page.locator('[data-lime-mobile-sidebar]')).toBeVisible();}
  55 |  else {expect(bounds.x+bounds.width).toBeCloseTo(page.viewportSize()!.width,0);expect(bounds.height).toBe(page.viewportSize()!.height);}
  56 |  await expect(page.locator('.leaflet-tile').first()).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
  57 | });
  58 | 
  59 | test('live map tiles load with an origin referrer @live',async({page},info)=>{
  60 |  test.skip(process.env.LIME_MAP_LIVE!=='1','Explicit live tile verification only');
  61 |  await page.unroute('https://tile.openstreetmap.org/**');
  62 |  const statuses:number[]=[];let referer='';
  63 |  page.on('response',r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))statuses.push(r.status());});
  64 |  page.on('request',async r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))referer=(await r.allHeaders()).referer??'';});
  65 |  await page.goto('maps');
  66 |  await expect.poll(()=>statuses.filter(status=>status===200).length,{timeout:20000}).toBeGreaterThan(0);
  67 |  expect(statuses.filter(status=>status===403)).toHaveLength(0);expect(referer).toBe('http://127.0.0.1:8080/');
  68 |  await expect.poll(()=>page.locator('.leaflet-tile-loaded').first().evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(256);
  69 |  await page.screenshot({path:info.outputPath('live-map.png'),animations:'disabled'});
  70 | });
  71 | 
  72 | test('light and dark maps follow the theme and omit the guide and count',async({page})=>{
  73 |  await page.addInitScript(()=>localStorage.setItem('theme','light'));await page.goto('maps');
  74 |  await expect(page.locator('html')).toHaveClass(/light/);await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('filter','none');
  75 |  await expect(page.getByText('場所を押してピンを置き、ピンを押してポスト',{exact:true})).toHaveCount(0);await expect(page.getByText(/件の公開ポスト/)).toHaveCount(0);
  76 |  await expect(page.locator('.lime-maps-search input')).toHaveCSS('color','rgb(27, 37, 43)');
  77 |  await page.addInitScript(()=>localStorage.setItem('theme','dark'));await page.reload();await expect(page.locator('html')).toHaveClass(/dark/);await expect(page.locator('.leaflet-tile-pane')).not.toHaveCSS('filter','none');
  78 | });
  79 | test('sidebar can collapse only on desktop and restores outside maps without map errors',async({page},info)=>{
  80 |  await page.goto('maps');const close=page.getByRole('button',{name:'サイドバーを閉じる',exact:true});
  81 |  if(info.project.name!=='desktop'){await expect(close).not.toBeVisible();return;}
  82 |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  83 |  await close.click();await expect(page.locator('[data-lime-desktop-sidebar]')).not.toBeVisible();
  84 |  let box=(await page.locator('[data-lime-maps]').boundingBox())!;expect(box.x).toBe(0);expect(box.width).toBe(page.viewportSize()!.width);
  85 |  await page.getByRole('button',{name:'サイドバーを開く',exact:true}).click();await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();
  86 |  for(let i=0;i<3;i++){await page.locator('.lime-map').click({position:{x:160,y:200}});await page.locator('.lime-map-pin-selected').click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();}
  87 |  await close.click();await page.goto('search');await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();expect(errors).toEqual([]);
  88 | });
  89 | 
```