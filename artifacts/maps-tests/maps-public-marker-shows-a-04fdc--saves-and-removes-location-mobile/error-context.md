# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: maps.spec.ts >> public marker shows author and post; own edit saves and removes location
- Location: tests/maps/maps.spec.ts:28:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '編集', exact: true })
    - locator resolved to <button type="button" class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div data-state="open" aria-hidden="true" data-aria-hidden="true" class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"></div> intercepts pointer events
  - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div data-state="open" aria-hidden="true" data-aria-hidden="true" class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"></div> intercepts pointer events
    - retrying click action
      - waiting 100ms
    81 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div data-state="open" aria-hidden="true" data-aria-hidden="true" class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"></div> intercepts pointer events
     - retrying click action
       - waiting 500ms

```

# Page snapshot

```yaml
- generic:
  - generic:
    - generic:
      - generic:
        - list
        - region "Notifications alt+T"
        - generic:
          - main:
            - generic:
              - generic [aria-hidden]:
                - generic:
                  - button [ref=e1] [cursor=pointer]
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - generic:
                            - generic:
                              - strong: 地図ユーザー
                              - time: 2026/10/9 9:00:00
                          - paragraph: 地図に載せたポスト
                          - button: ポストを見る
                    - button: ×
                  - generic:
                    - generic [ref=e4]:
                      - button [ref=e5] [cursor=pointer]: +
                      - button [ref=e6] [cursor=pointer]: −
                    - generic [ref=e7]:
                      - link [ref=e8] [cursor=pointer]:
                        - /url: https://leafletjs.com
                        - text: Leaflet
                      - text: "| ©"
                      - link [ref=e13] [cursor=pointer]:
                        - /url: https://www.openstreetmap.org/copyright
                        - text: OpenStreetMap
                      - text: contributors
              - generic [aria-hidden]:
                - button [ref=e14] [cursor=pointer]
                - textbox [ref=e20]:
                  - /placeholder: ポスト・ハッシュタグを検索
              - generic [aria-hidden]:
                - generic: 場所を押してピンを置き、ピンを押してポスト
              - generic: 1件の公開ポスト
  - navigation [aria-hidden]:
    - list:
      - listitem:
        - link:
          - /url: /RaimuNoteSNS.github.io/
          - text: ホーム
      - listitem:
        - link:
          - /url: /RaimuNoteSNS.github.io/search
          - text: 検索
      - listitem:
        - link:
          - /url: /RaimuNoteSNS.github.io/u/viewer
          - text: プロフ
      - listitem:
        - link:
          - /url: /RaimuNoteSNS.github.io/chat
          - text: チャット
      - listitem:
        - link:
          - /url: /RaimuNoteSNS.github.io/settings
          - text: 設定
  - dialog [ref=e22]:
    - heading "ポスト" [level=2] [ref=e23]
    - article [ref=e25] [cursor=pointer]:
      - generic [ref=e26]:
        - link "地" [ref=e27]:
          - /url: /RaimuNoteSNS.github.io/u/viewer
        - generic [ref=e30]:
          - generic [ref=e31]:
            - generic [ref=e32]:
              - link "地図ユーザー" [ref=e33]:
                - /url: /RaimuNoteSNS.github.io/u/viewer
              - generic [ref=e36]: "@viewer"
              - generic [ref=e37]: ·
              - generic [ref=e38]: 8時間前
            - button "ポストのメニュー" [active] [ref=e41]
          - paragraph [ref=e48]: 地図に載せたポスト
          - generic [ref=e49]:
            - button [ref=e51]
            - button "リポスト" [ref=e53]
            - link "返信" [ref=e54]:
              - /url: /RaimuNoteSNS.github.io/post/22222222-2222-4222-8222-222222222222
            - button "リアクションを追加" [ref=e58]
            - generic [ref=e60]:
              - button "ブックマークに追加" [ref=e61]
              - button "ポストを共有" [ref=e64]
    - button "Close" [ref=e68] [cursor=pointer]
  - generic:
    - button "ポストアクティビティー"
    - button "編集"
    - button "プロフィールに固定"
    - button "ハイライトに追加"
    - button "限定公開にする"
    - button "削除"
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
> 31 |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();
     |                                                                                                                            ^ Error: locator.click: Test timeout of 45000ms exceeded.
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
  45 |  await setup(page,false);await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
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
```