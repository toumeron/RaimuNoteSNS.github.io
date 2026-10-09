# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: maps.spec.ts >> city-only posts are estimated and more reads the next external page at 100 per request
- Location: tests/maps/maps.spec.ts:119:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - region "Notifications (F8)":
      - list
    - region "Notifications alt+T"
    - main [ref=e6]:
      - generic [ref=e7]:
        - generic "LimeMapsの地図" [ref=e9]:
          - generic:
            - generic:
              - button "地図ユーザーのポスト" [ref=e10] [cursor=pointer]
              - button "地名だけの投稿のポスト" [ref=e12] [cursor=pointer]
              - button "続きの投稿のポスト" [ref=e14] [cursor=pointer]
            - generic [ref=e16]:
              - generic [ref=e19]:
                - generic [ref=e21]:
                  - strong [ref=e22]: 地名だけの投稿
                  - time [ref=e23]: 2026/10/9 9:00:00
                - paragraph [ref=e24]: 今日は大阪でラーメン！
                - paragraph [ref=e25]: "地名から推定: 大阪"
                - button "ポストを見る" [ref=e26] [cursor=pointer]
              - button "Close popup" [ref=e28] [cursor=pointer]: ×
          - generic:
            - generic:
              - generic [ref=e29]:
                - button "拡大" [ref=e30] [cursor=pointer]: +
                - button "縮小" [ref=e31] [cursor=pointer]: −
              - generic [ref=e32]:
                - link "Leaflet" [ref=e33] [cursor=pointer]:
                  - /url: https://leafletjs.com
                - text: "| ©"
                - link "OpenStreetMap" [ref=e38] [cursor=pointer]:
                  - /url: https://www.openstreetmap.org/copyright
                - text: contributors ·
                - link "GeoNames" [ref=e39] [cursor=pointer]:
                  - /url: https://www.geonames.org/
        - generic:
          - button "メニューを開く" [ref=e40] [cursor=pointer]
          - textbox "ポスト・ハッシュタグを検索" [ref=e46]
  - navigation [ref=e47]:
    - list [ref=e48]:
      - listitem [ref=e49]:
        - link "ホーム" [ref=e50] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=e55]:
        - link "検索" [ref=e56] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=e61]:
        - link "プロフ" [ref=e62] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/u/viewer
      - listitem [ref=e67]:
        - link "通知" [ref=e68] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/notifications
      - listitem [ref=e73]:
        - link "チャット" [ref=e74] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=e78]:
        - link "設定" [ref=e79] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/settings
```

# Test source

```ts
  35  |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await dialog.getByRole('button',{name:'場所を削除',exact:true}).click();await expect(dialog).toHaveCount(0);
  36  |  expect((await page.evaluate(()=>(window as any).__savedLocation)).point).toBeNull();
  37  | });
  38  | test('desktop More and mobile sidebar link to LimeMaps',async({page})=>{
  39  |  await page.goto('search');
  40  |  if(page.viewportSize()!.width>=768) await page.getByRole('button',{name:'もっと見る',exact:true}).click();
  41  |  else await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
  42  |  await page.getByText('LimeMaps',{exact:true}).click();await expect(page).toHaveURL(/\/maps$/);await expect(page.locator('.lime-map')).toBeVisible();
  43  | });
  44  | 
  45  | test('another user cannot open the location editor',async({page})=>{
  46  |  await setup(page,false);await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  47  |  await page.locator('[data-lime-map-selected-post]').getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  48  |  await expect(page.getByRole('button',{name:'編集',exact:true})).toHaveCount(0);
  49  | });
  50  | 
  51  | test('map fills the area outside navigation and keeps reference metadata on tiles',async({page})=>{
  52  |  await page.goto('maps');const map=page.locator('[data-lime-maps]');await expect(map).toBeVisible();
  53  |  await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
  54  |  const bounds=(await map.boundingBox())!;expect(bounds.y).toBe(0);
  55  |  if(page.viewportSize()!.width<768){const nav=(await page.locator('[data-lime-bottom-nav-root]').boundingBox())!;expect(bounds.x).toBe(0);expect(bounds.width).toBe(page.viewportSize()!.width);expect(bounds.height).toBeCloseTo(nav.y,0);await page.getByRole('button',{name:'メニューを開く',exact:true}).click();await expect(page.locator('[data-lime-mobile-sidebar]')).toBeVisible();}
  56  |  else {expect(bounds.x+bounds.width).toBeCloseTo(page.viewportSize()!.width,0);expect(bounds.height).toBe(page.viewportSize()!.height);}
  57  |  await expect(page.locator('.leaflet-tile').first()).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
  58  | });
  59  | 
  60  | test('live map tiles load with an origin referrer @live',async({page},info)=>{
  61  |  test.skip(process.env.LIME_MAP_LIVE!=='1','Explicit live tile verification only');
  62  |  await page.unroute('https://tile.openstreetmap.org/**');
  63  |  const statuses:number[]=[];let referer='';
  64  |  page.on('response',r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))statuses.push(r.status());});
  65  |  page.on('request',async r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))referer=(await r.allHeaders()).referer??'';});
  66  |  await page.goto('maps');
  67  |  await expect.poll(()=>statuses.filter(status=>status===200).length,{timeout:20000}).toBeGreaterThan(0);
  68  |  expect(statuses.filter(status=>status===403)).toHaveLength(0);expect(referer).toBe('http://127.0.0.1:8080/');
  69  |  await expect.poll(()=>page.locator('.leaflet-tile-loaded').first().evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(256);
  70  |  await page.screenshot({path:info.outputPath('live-map.png'),animations:'disabled'});
  71  | });
  72  | 
  73  | test('light and dark maps follow the theme and omit the guide and count',async({page})=>{
  74  |  await page.addInitScript(()=>localStorage.setItem('theme','light'));await page.goto('maps');
  75  |  await expect(page.locator('html')).toHaveClass(/light/);await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('filter','none');
  76  |  await expect(page.getByText('場所を押してピンを置き、ピンを押してポスト',{exact:true})).toHaveCount(0);await expect(page.getByText(/件の公開ポスト/)).toHaveCount(0);
  77  |  await expect(page.locator('.lime-maps-search input')).toHaveCSS('color','rgb(27, 37, 43)');
  78  |  await page.addInitScript(()=>localStorage.setItem('theme','dark'));await page.reload();await expect(page.locator('html')).toHaveClass(/dark/);await expect(page.locator('.leaflet-tile-pane')).not.toHaveCSS('filter','none');
  79  | });
  80  | test('sidebar can collapse only on desktop and restores outside maps without map errors',async({page},info)=>{
  81  |  await page.goto('maps');const close=page.getByRole('button',{name:'サイドバーを閉じる',exact:true});
  82  |  if(info.project.name!=='desktop'){await expect(close).not.toBeVisible();return;}
  83  |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  84  |  await close.click();await expect(page.locator('[data-lime-desktop-sidebar]')).not.toBeVisible();
  85  |  let box=(await page.locator('[data-lime-maps]').boundingBox())!;expect(box.x).toBe(0);expect(box.width).toBe(page.viewportSize()!.width);
  86  |  await page.getByRole('button',{name:'サイドバーを開く',exact:true}).click();await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();
  87  |  for(let i=0;i<3;i++){await page.locator('.lime-map').click({position:{x:160,y:200}});await page.locator('.lime-map-pin-selected').click();await page.getByRole('dialog').getByRole('button',{name:'閉じる',exact:true}).click();}
  88  |  await close.click();await page.goto('search');await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();expect(errors).toEqual([]);
  89  | });
  90  | 
  91  | 
  92  | test('post menus retain mobile styling and use readable desktop sizing',async({page},info)=>{
  93  |  const phone=page.viewportSize()!.width<640;
  94  |  await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').press('Enter');await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  95  |  const card=page.locator('[data-lime-map-selected-post]');
  96  |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  97  |  const menu=page.locator('.lime-post-options');await expect(menu).toBeVisible();
  98  |  const row=menu.getByRole('button',{name:'編集',exact:true});
  99  |  await expect(row).toHaveCSS('font-size','14px');await expect(row).toHaveCSS('min-height',phone?'44px':'40px');
  100 |  expect(await menu.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(phone?240:280);
  101 |  if(phone)await expect(page.locator('.lime-post-options-backdrop')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  102 |  await expect(page.getByRole('combobox',{name:'ポストのメニュー',exact:true})).toHaveCount(0);
  103 |  await page.screenshot({path:info.outputPath('post-menu.png')});
  104 |  await row.click();await expect(page.getByRole('heading',{name:'ポストを編集',exact:true})).toBeVisible();
  105 | });
  106 | 
  107 |  test('external public posts with destination coordinates appear and open without native ID queries',async({page})=>{
  108 |  const external={uri:'at://did:plc:map/app.bsky.feed.post/place',cid:'cid',author:{did:'did:plc:map',handle:'maps.bsky.social',displayName:'外部の地図投稿'},record:{text:'旅先 https://www.google.com/maps/search/?api=1&query=36.2%2C138.25',createdAt:'2026-10-09T00:00:00Z'}};
  109 |  await page.route('**/public.api.bsky.app/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({posts:[external]})}));
  110 |  await page.goto('maps');
  111 |  const marker=page.locator('.leaflet-marker-icon[title="外部の地図投稿のポスト"]');await expect(marker).toHaveCount(1);await marker.click();
  112 |  await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  113 |  await expect(page.locator('[data-lime-map-selected-post]')).toContainText('外部の地図投稿');
  114 |  await expect(page.locator('[data-lime-map-selected-post]')).toContainText('旅先');
  115 |  await page.getByRole('button',{name:'ポストを閉じる',exact:true}).click();
  116 |  await page.getByRole('textbox',{name:'ポスト・ハッシュタグを検索'}).fill('存在しない内容');await expect(marker).toHaveCount(0);
  117 |  });
  118 | 
  119 | test('city-only posts are estimated and more reads the next external page at 100 per request',async({page})=>{
  120 |  const requests:URL[]=[];
  121 |  await page.route('**/public.api.bsky.app/**',r=>{
  122 |   const url=new URL(r.request().url());
  123 |   if(!url.pathname.endsWith('searchPosts'))return r.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[]}'});
  124 |   requests.push(url);const next=url.searchParams.has('cursor');
  125 |   const row={uri:`at://did:plc:city/app.bsky.feed.post/${next?'second':'first'}`,cid:'cid',author:{did:'did:plc:city',handle:'city.bsky.social',displayName:next?'続きの投稿':'地名だけの投稿'},record:{text:next?'京都に着きました':'今日は大阪でラーメン！',createdAt:'2026-10-09T00:00:00Z'}};
  126 |   return r.fulfill({contentType:'application/json',body:JSON.stringify({posts:[row],cursor:next?undefined:'page-two'})});
  127 |  });
  128 |  await page.goto('maps');
  129 |  const marker=page.locator('.leaflet-marker-icon[title="地名だけの投稿のポスト"]');await expect(marker).toHaveCount(1);await marker.press('Enter');
  130 |  await expect(page.getByText(/地名から推定:.*大阪/)).toBeVisible();
  131 |  const more=page.getByRole('button',{name:'さらに表示',exact:true});await expect(more).toBeEnabled();await more.click();
  132 |  await expect(page.locator('.leaflet-marker-icon[title="続きの投稿のポスト"]')).toHaveCount(1);
  133 |  await expect(marker).toHaveCount(1);
  134 |  expect(requests.every(url=>url.searchParams.get('limit')==='100'&&!url.searchParams.has('since')&&!url.searchParams.has('lang'))).toBe(true);
> 135 |  expect(requests.some(url=>url.searchParams.get('q')?.includes('大阪'))).toBe(true);
      |                                                                        ^ Error: expect(received).toBe(expected) // Object.is equality
  136 |  expect(requests.some(url=>url.searchParams.get('cursor')==='page-two')).toBe(true);
  137 | });
  138 | 
```