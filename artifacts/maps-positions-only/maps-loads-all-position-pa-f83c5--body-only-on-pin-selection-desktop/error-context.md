# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: maps.spec.ts >> loads all position pages automatically and fetches a post body only on pin selection
- Location: tests/maps/maps.spec.ts:108:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('大阪に来ました', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('大阪に来ました', { exact: true }) with timeout 5000ms
  - waiting for getByText('大阪に来ました', { exact: true })

```

```yaml
- region "Notifications (F8)":
  - list
- region "Notifications alt+T"
- complementary:
  - link "Lime Note":
    - /url: /RaimuNoteSNS.github.io/
  - navigation:
    - button "ホーム":
      - img
      - text: ホーム
    - button "プロフィール":
      - img
      - text: プロフィール
    - button "検索":
      - img
      - text: 検索
    - button "通知":
      - img
      - text: 通知
    - button "LimeAI":
      - img
      - text: LimeAI
    - button "設定":
      - img
      - text: 設定
    - button "もっと見る":
      - img
      - text: もっと見る
    - button "ポストする"
  - 'button "ログイン中のアカウント: 地図ユーザー（アカウント切り替え）"': 地 地図ユーザー @viewer
- main:
  - button "ポストを開く"
  - button "ポストを開く"
  - button "ポストを開く"
  - button "Close popup"
  - button "拡大"
  - button "縮小"
  - link "Leaflet":
    - /url: https://leafletjs.com
  - text: ©
  - link "OpenStreetMap":
    - /url: https://www.openstreetmap.org/copyright
  - text: contributors ·
  - link "GeoNames":
    - /url: https://www.geonames.org/
  - button "サイドバーを閉じる":
    - img
  - text: LimeMaps
  - img
  - textbox "ポスト・ハッシュタグを検索"
```

# Test source

```ts
  28  |  await page.screenshot({path:info.outputPath('maps.png'),animations:'disabled'});
  29  | });
  30  | test('public marker shows author and post; own edit saves and removes location',async({page})=>{
  31  |  await page.goto('maps');await page.locator('.leaflet-marker-icon[data-lime-map-post-id="22222222-2222-4222-8222-222222222222"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  32  |  const card=page.locator('[data-lime-map-selected-post]');await expect(card).toContainText('地図に載せたポスト');await expect(card).toContainText('地図ユーザー');
  33  |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();
  34  |  let dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await expect(dialog.getByRole('heading',{name:'ポストを編集'})).toBeVisible();await dialog.locator('.lime-map').click({position:{x:150,y:180}});await dialog.getByRole('button',{name:'保存する',exact:true}).click();await expect(page.getByRole('heading',{name:'ポストを編集'})).toHaveCount(0);
  35  |  expect((await page.evaluate(()=>(window as any).__savedLocation)).id).toBe(post.id);
  36  |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await dialog.getByRole('button',{name:'場所を削除',exact:true}).click();await expect(dialog).toHaveCount(0);
  37  |  expect((await page.evaluate(()=>(window as any).__savedLocation)).point).toBeNull();
  38  | });
  39  | test('desktop More and mobile sidebar link to LimeMaps',async({page})=>{
  40  |  await page.goto('search');
  41  |  if(page.viewportSize()!.width>=768) await page.getByRole('button',{name:'もっと見る',exact:true}).click();
  42  |  else await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
  43  |  await page.getByText('LimeMaps',{exact:true}).click();await expect(page).toHaveURL(/\/maps$/);await expect(page.locator('.lime-map')).toBeVisible();
  44  | });
  45  | 
  46  | test('another user cannot open the location editor',async({page})=>{
  47  |  await setup(page,false);await page.goto('maps');await page.locator('.leaflet-marker-icon[data-lime-map-post-id="22222222-2222-4222-8222-222222222222"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  48  |  await page.locator('[data-lime-map-selected-post]').getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  49  |  await expect(page.getByRole('button',{name:'編集',exact:true})).toHaveCount(0);
  50  | });
  51  | 
  52  | test('map fills the area outside navigation and keeps reference metadata on tiles',async({page})=>{
  53  |  await page.goto('maps');const map=page.locator('[data-lime-maps]');await expect(map).toBeVisible();
  54  |  await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
  55  |  const bounds=(await map.boundingBox())!;expect(bounds.y).toBe(0);
  56  |  if(page.viewportSize()!.width<768){const nav=(await page.locator('[data-lime-bottom-nav-root]').boundingBox())!;expect(bounds.x).toBe(0);expect(bounds.width).toBe(page.viewportSize()!.width);expect(bounds.height).toBeCloseTo(nav.y,0);await page.getByRole('button',{name:'メニューを開く',exact:true}).click();await expect(page.locator('[data-lime-mobile-sidebar]')).toBeVisible();}
  57  |  else {expect(bounds.x+bounds.width).toBeCloseTo(page.viewportSize()!.width,0);expect(bounds.height).toBe(page.viewportSize()!.height);}
  58  |  await expect(page.locator('.leaflet-tile').first()).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
  59  | });
  60  | 
  61  | test('live map tiles load with an origin referrer @live',async({page},info)=>{
  62  |  test.skip(process.env.LIME_MAP_LIVE!=='1','Explicit live tile verification only');
  63  |  await page.unroute('https://tile.openstreetmap.org/**');
  64  |  const statuses:number[]=[];let referer='';
  65  |  page.on('response',r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))statuses.push(r.status());});
  66  |  page.on('request',async r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))referer=(await r.allHeaders()).referer??'';});
  67  |  await page.goto('maps');
  68  |  await expect.poll(()=>statuses.filter(status=>status===200).length,{timeout:20000}).toBeGreaterThan(0);
  69  |  expect(statuses.filter(status=>status===403)).toHaveLength(0);expect(referer).toBe('http://127.0.0.1:8080/');
  70  |  await expect.poll(()=>page.locator('.leaflet-tile-loaded').first().evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(256);
  71  |  await page.screenshot({path:info.outputPath('live-map.png'),animations:'disabled'});
  72  | });
  73  | 
  74  | test('light and dark maps follow the theme and omit the guide and count',async({page})=>{
  75  |  await page.addInitScript(()=>localStorage.setItem('theme','light'));await page.goto('maps');
  76  |  await expect(page.locator('html')).toHaveClass(/light/);await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('filter','none');
  77  |  await expect(page.getByText('場所を押してピンを置き、ピンを押してポスト',{exact:true})).toHaveCount(0);await expect(page.getByText(/件の公開ポスト/)).toHaveCount(0);
  78  |  await expect(page.locator('.lime-maps-search input')).toHaveCSS('color','rgb(27, 37, 43)');
  79  |  await page.addInitScript(()=>localStorage.setItem('theme','dark'));await page.reload();await expect(page.locator('html')).toHaveClass(/dark/);await expect(page.locator('.leaflet-tile-pane')).not.toHaveCSS('filter','none');
  80  | });
  81  | test('sidebar can collapse only on desktop and restores outside maps without map errors',async({page},info)=>{
  82  |  await page.goto('maps');const close=page.getByRole('button',{name:'サイドバーを閉じる',exact:true});
  83  |  if(info.project.name!=='desktop'){await expect(close).not.toBeVisible();return;}
  84  |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  85  |  await close.click();await expect(page.locator('[data-lime-desktop-sidebar]')).not.toBeVisible();
  86  |  let box=(await page.locator('[data-lime-maps]').boundingBox())!;expect(box.x).toBe(0);expect(box.width).toBe(page.viewportSize()!.width);
  87  |  await page.getByRole('button',{name:'サイドバーを開く',exact:true}).click();await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();
  88  |  for(let i=0;i<3;i++){await page.locator('.lime-map').click({position:{x:160,y:200}});await page.locator('.lime-map-pin-selected').click();await page.getByRole('dialog').getByRole('button',{name:'閉じる',exact:true}).click();}
  89  |  await close.click();await page.goto('search');await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();expect(errors).toEqual([]);
  90  | });
  91  | 
  92  | 
  93  | test('post menus retain mobile styling and use readable desktop sizing',async({page},info)=>{
  94  |  const phone=page.viewportSize()!.width<640;
  95  |  await page.goto('maps');await page.locator('.leaflet-marker-icon[data-lime-map-post-id="22222222-2222-4222-8222-222222222222"]').press('Enter');await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  96  |  const card=page.locator('[data-lime-map-selected-post]');
  97  |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  98  |  const menu=page.locator('.lime-post-options');await expect(menu).toBeVisible();
  99  |  const row=menu.getByRole('button',{name:'編集',exact:true});
  100 |  await expect(row).toHaveCSS('font-size','14px');await expect(row).toHaveCSS('min-height',phone?'44px':'40px');
  101 |  expect(await menu.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(phone?240:280);
  102 |  if(phone)await expect(page.locator('.lime-post-options-backdrop')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  103 |  await expect(page.getByRole('combobox',{name:'ポストのメニュー',exact:true})).toHaveCount(0);
  104 |  await page.screenshot({path:info.outputPath('post-menu.png')});
  105 |  await row.click();await expect(page.getByRole('heading',{name:'ポストを編集',exact:true})).toBeVisible();
  106 | });
  107 | 
  108 | test('loads all position pages automatically and fetches a post body only on pin selection',async({page},info)=>{
  109 |  const requests:unknown[]=[];let detailRequests=0;
  110 |  const uri='at://did:plc:map/app.bsky.feed.post/place';
  111 |  const pin={id:`bsky:${uri}`,source:'bluesky',createdAt:'2026-10-09T00:00:00Z',mapLocation:{latitude:36.2,longitude:138.25}};
  112 |  await page.route('**/*.supabase.co/functions/v1/link-preview',r=>{
  113 |   const body=r.request().postDataJSON();requests.push(body);
  114 |   const next=Boolean(body.jobs);
  115 |   return r.fulfill({contentType:'application/json',body:JSON.stringify({pins:[next?{...pin,id:'bsky:at://did:plc:map/app.bsky.feed.post/second',mapLocation:{latitude:35.5,longitude:138.5}}:pin],next:next?[]:[{provider:'bluesky',query:'大阪',cursor:'page-two'}]})});
  116 |  });
  117 |  await page.route('**/public.api.bsky.app/**',r=>{
  118 |   if(r.request().url().includes('getPostThread')){detailRequests++;return r.fulfill({contentType:'application/json',body:JSON.stringify({thread:{post:{uri,cid:'cid',author:{did:'did:plc:map',handle:'maps.bsky.social',displayName:'外部の地図投稿'},record:{text:'大阪に来ました',createdAt:'2026-10-09T00:00:00Z'}}}})});}
  119 |   return r.fulfill({contentType:'application/json',body:'{"posts":[],"feed":[]}'});
  120 |  });
  121 |  await page.goto('maps');
  122 |  await expect(page.locator('[data-lime-map-post-id="bsky:at://did:plc:map/app.bsky.feed.post/second"]')).toHaveCount(1);
  123 |  expect(requests.length).toBeGreaterThanOrEqual(2);expect(detailRequests).toBe(0);
  124 |  expect(await page.evaluate(()=>(window as any).__detailLoads||0)).toBe(0);
  125 |  await expect(page.getByRole('button',{name:'さらに表示',exact:true})).toHaveCount(0);
  126 |  await expect(page.getByText(/地名から推定/)).toHaveCount(0);
  127 |  await page.locator(`[data-lime-map-post-id="${pin.id}"]`).press('Enter');
> 128 |  await expect(page.getByText('大阪に来ました',{exact:true})).toBeVisible();expect(detailRequests).toBe(1);
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  129 |  await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  130 |  await expect(page.locator('[data-lime-map-selected-post]')).toContainText('外部の地図投稿');
  131 |  await expect(page.getByText(/地名から推定/)).toHaveCount(0);
  132 |  await page.screenshot({path:info.outputPath('positions-only-map.png')});
  133 | });
  134 | 
```