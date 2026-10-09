# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: maps.spec.ts >> phone menus follow iOS and Android; repost actions use a bottom sheet only on phones
- Location: tests/maps/maps.spec.ts:110:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]')
    - locator resolved to <div tabindex="0" role="button" title="地図ユーザーのポスト" class="leaflet-marker-icon lime-map-dot leaflet-zoom-animated leaflet-interactive">…</div>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <label class="lime-maps-search">…</label> from <div class="lime-maps-toolbar">…</div> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <label class="lime-maps-search">…</label> from <div class="lime-maps-toolbar">…</div> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    83 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <label class="lime-maps-search">…</label> from <div class="lime-maps-toolbar">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms

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
          - button "地図ユーザーのポスト" [ref=e10] [cursor=pointer]
          - generic:
            - generic:
              - generic [ref=e12]:
                - button "拡大" [ref=e13] [cursor=pointer]: +
                - button "縮小" [ref=e14] [cursor=pointer]: −
              - generic [ref=e15]:
                - link "Leaflet" [ref=e16]:
                  - /url: https://leafletjs.com
                - text: "| ©"
                - link "OpenStreetMap" [ref=e21]:
                  - /url: https://www.openstreetmap.org/copyright
                - text: contributors
        - generic:
          - button "メニューを開く" [ref=e22] [cursor=pointer]
          - textbox "ポスト・ハッシュタグを検索" [ref=e28]
  - navigation [ref=e29]:
    - list [ref=e30]:
      - listitem [ref=e31]:
        - link "ホーム" [ref=e32]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=e36]:
        - link "検索" [ref=e37]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=e41]:
        - link "プロフ" [ref=e42]:
          - /url: /RaimuNoteSNS.github.io/u/viewer
      - listitem [ref=e46]:
        - link "チャット" [ref=e47]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=e50]:
        - link "設定" [ref=e51]:
          - /url: /RaimuNoteSNS.github.io/settings
```

# Test source

```ts
  15  | test.beforeEach(async({page})=>setup(page));
  16  | test('map selection opens the existing composer and submits the chosen location without device location',async({page},info)=>{
  17  |  await page.goto('maps');await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
  18  |  const map=page.locator('.lime-map').first();await expect(map.locator('.leaflet-tile-loaded').first()).toBeVisible();
  19  |  await map.click({position:{x:140,y:180}});
  20  |  await page.locator('.lime-map-pin-selected').click();
  21  |  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'ポストする',exact:true})).toBeVisible();
  22  |  await dialog.locator('textarea').fill('ピンから投稿します');await dialog.getByRole('button',{name:'ポスト',exact:true}).click();await expect(dialog).toHaveCount(0);
  23  |  const submitted=await page.evaluate(()=>(window as any).__createdPost);expect(submitted.content).toBe('ピンから投稿します');expect(submitted.mapLocation.latitude).toBeGreaterThan(-90);expect(submitted.mapLocation.longitude).toBeGreaterThan(-180);
  24  |  expect(await page.evaluate(()=>(window as any).__locationCalls)).toBe(0);
  25  |  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  26  |  await page.screenshot({path:info.outputPath('maps.png'),animations:'disabled'});
  27  | });
  28  | test('public marker shows author and post; own edit saves and removes location',async({page})=>{
  29  |  await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  30  |  const card=page.locator('[data-lime-map-selected-post]');await expect(card).toContainText('地図に載せたポスト');await expect(card).toContainText('地図ユーザー');
  31  |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();
  32  |  let dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await expect(dialog.getByRole('heading',{name:'ポストを編集'})).toBeVisible();await dialog.locator('.lime-map').click({position:{x:150,y:180}});await dialog.getByRole('button',{name:'保存する',exact:true}).click();await expect(page.getByRole('heading',{name:'ポストを編集'})).toHaveCount(0);
  33  |  expect((await page.evaluate(()=>(window as any).__savedLocation)).id).toBe(post.id);
  34  |  await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await dialog.getByRole('button',{name:'場所を削除',exact:true}).click();await expect(dialog).toHaveCount(0);
  35  |  expect((await page.evaluate(()=>(window as any).__savedLocation)).point).toBeNull();
  36  | });
  37  | test('desktop More and mobile sidebar link to LimeMaps',async({page})=>{
  38  |  await page.goto('search');
  39  |  if(page.viewportSize()!.width>=768) await page.getByRole('button',{name:'もっと見る',exact:true}).click();
  40  |  else await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
  41  |  await page.getByText('LimeMaps',{exact:true}).click();await expect(page).toHaveURL(/\/maps$/);await expect(page.locator('.lime-map')).toBeVisible();
  42  | });
  43  | 
  44  | test('another user cannot open the location editor',async({page})=>{
  45  |  await setup(page,false);await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  46  |  await page.locator('[data-lime-map-selected-post]').getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  47  |  await expect(page.getByRole('button',{name:'編集',exact:true})).toHaveCount(0);
  48  | });
  49  | 
  50  | test('map fills the area outside navigation and keeps reference metadata on tiles',async({page})=>{
  51  |  await page.goto('maps');const map=page.locator('[data-lime-maps]');await expect(map).toBeVisible();
  52  |  await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
  53  |  const bounds=(await map.boundingBox())!;expect(bounds.y).toBe(0);
  54  |  if(page.viewportSize()!.width<768){const nav=(await page.locator('[data-lime-bottom-nav-root]').boundingBox())!;expect(bounds.x).toBe(0);expect(bounds.width).toBe(page.viewportSize()!.width);expect(bounds.height).toBeCloseTo(nav.y,0);await page.getByRole('button',{name:'メニューを開く',exact:true}).click();await expect(page.locator('[data-lime-mobile-sidebar]')).toBeVisible();}
  55  |  else {expect(bounds.x+bounds.width).toBeCloseTo(page.viewportSize()!.width,0);expect(bounds.height).toBe(page.viewportSize()!.height);}
  56  |  await expect(page.locator('.leaflet-tile').first()).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
  57  | });
  58  | 
  59  | test('live map tiles load with an origin referrer @live',async({page},info)=>{
  60  |  test.skip(process.env.LIME_MAP_LIVE!=='1','Explicit live tile verification only');
  61  |  await page.unroute('https://tile.openstreetmap.org/**');
  62  |  const statuses:number[]=[];let referer='';
  63  |  page.on('response',r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))statuses.push(r.status());});
  64  |  page.on('request',async r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))referer=(await r.allHeaders()).referer??'';});
  65  |  await page.goto('maps');
  66  |  await expect.poll(()=>statuses.filter(status=>status===200).length,{timeout:20000}).toBeGreaterThan(0);
  67  |  expect(statuses.filter(status=>status===403)).toHaveLength(0);expect(referer).toBe('http://127.0.0.1:8080/');
  68  |  await expect.poll(()=>page.locator('.leaflet-tile-loaded').first().evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(256);
  69  |  await page.screenshot({path:info.outputPath('live-map.png'),animations:'disabled'});
  70  | });
  71  | 
  72  | test('light and dark maps follow the theme and omit the guide and count',async({page})=>{
  73  |  await page.addInitScript(()=>localStorage.setItem('theme','light'));await page.goto('maps');
  74  |  await expect(page.locator('html')).toHaveClass(/light/);await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('filter','none');
  75  |  await expect(page.getByText('場所を押してピンを置き、ピンを押してポスト',{exact:true})).toHaveCount(0);await expect(page.getByText(/件の公開ポスト/)).toHaveCount(0);
  76  |  await expect(page.locator('.lime-maps-search input')).toHaveCSS('color','rgb(27, 37, 43)');
  77  |  await page.addInitScript(()=>localStorage.setItem('theme','dark'));await page.reload();await expect(page.locator('html')).toHaveClass(/dark/);await expect(page.locator('.leaflet-tile-pane')).not.toHaveCSS('filter','none');
  78  | });
  79  | test('sidebar can collapse only on desktop and restores outside maps without map errors',async({page},info)=>{
  80  |  await page.goto('maps');const close=page.getByRole('button',{name:'サイドバーを閉じる',exact:true});
  81  |  if(info.project.name!=='desktop'){await expect(close).not.toBeVisible();return;}
  82  |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  83  |  await close.click();await expect(page.locator('[data-lime-desktop-sidebar]')).not.toBeVisible();
  84  |  let box=(await page.locator('[data-lime-maps]').boundingBox())!;expect(box.x).toBe(0);expect(box.width).toBe(page.viewportSize()!.width);
  85  |  await page.getByRole('button',{name:'サイドバーを開く',exact:true}).click();await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();
  86  |  for(let i=0;i<3;i++){await page.locator('.lime-map').click({position:{x:160,y:200}});await page.locator('.lime-map-pin-selected').click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();}
  87  |  await close.click();await page.goto('search');await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();expect(errors).toEqual([]);
  88  | });
  89  | 
  90  | test('post options stay compact and readable in both themes on cards and details',async({page},info)=>{
  91  |  for(const theme of ['light','dark']){
  92  |   await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
  93  |   await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').press('Enter');await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  94  |   await page.locator('[data-lime-map-selected-post]').getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  95  |   const menu=page.locator('.lime-post-options');await expect(menu).toBeVisible();
  96  |   const items=menu.locator(':scope > button');expect(await items.count()).toBeGreaterThan(4);
  97  |   for(const item of await items.all()){
  98  |    await expect(item).toHaveCSS('font-size',page.viewportSize()!.width<640?'14px':'12px');await expect(item.locator('svg')).toHaveCount(1);
  99  |    await expect.poll(async()=>Math.round((await item.boundingBox())!.height)).toBe(page.viewportSize()!.width<640?44:32);
  100 |   }
  101 |   await expect(menu.getByRole('button',{name:'削除',exact:true})).toHaveCSS('border-top-width','0px');
  102 |   const box=(await menu.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width);expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  103 |   await page.screenshot({path:info.outputPath(`post-options-${theme}.png`),animations:'disabled'});
  104 |   await page.goto(`post/${post.id}`);await page.getByRole('button',{name:'その他のメニュー',exact:true}).filter({visible:true}).click();
  105 |   await expect(menu).toBeVisible();await expect(menu.getByRole('button',{name:'削除',exact:true})).toHaveCSS('font-size',page.viewportSize()!.width<640?'14px':'12px');
  106 |  }
  107 | });
  108 | 
  109 | 
  110 | test('phone menus follow iOS and Android; repost actions use a bottom sheet only on phones',async({page},info)=>{
  111 |  const phone=page.viewportSize()!.width<640;
  112 |  for(const os of phone?['ios','android']:['desktop']){
  113 |   await page.addInitScript(value=>localStorage.setItem('theme',value==='ios'?'dark':'light'),os);
  114 |   await page.addInitScript(value=>Object.defineProperty(navigator,'userAgent',{configurable:true,value:value==='ios'?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)':'Mozilla/5.0 (Linux; Android 15)'}),os);
> 115 |   await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').press('Enter');await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
      |                                                                                          ^ Error: locator.click: Test timeout of 45000ms exceeded.
  116 |   const card=page.locator('[data-lime-map-selected-post]');await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();
  117 |   const menu=page.locator('.lime-post-options');await expect(menu).toBeVisible();
  118 |   if(phone)await expect(page.locator('.lime-post-options-backdrop')).toHaveCSS('background-color','rgba(0, 0, 0, 0.18)');
  119 |   await expect(menu.locator('button').first()).toHaveCSS('flex-direction',os==='ios'?'row-reverse':'row');
  120 |   await page.screenshot({path:info.outputPath(`context-${os}.png`),animations:'disabled'});
  121 |   await page.locator('.lime-post-options-backdrop').click({position:{x:2,y:2}});await expect(menu).toHaveCount(0);
  122 |   await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').press('Enter');await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
  123 |   await card.getByRole('button',{name:'リポスト',exact:true}).click();
  124 |   if(phone){
  125 |    const sheet=page.getByRole('dialog',{name:'リポストの操作'});await expect(sheet).toBeVisible();
  126 |    const box=(await sheet.boundingBox())!;expect(box.y+box.height).toBeCloseTo(page.viewportSize()!.height,0);
  127 |    await expect(sheet.getByRole('button',{name:'リポストする',exact:true})).toBeVisible();await expect(sheet.getByRole('button',{name:'引用リポスト',exact:true})).toBeVisible();
  128 |    await page.screenshot({path:info.outputPath(`repost-${os}.png`),animations:'disabled'});
  129 |    await sheet.getByRole('button',{name:'引用リポスト',exact:true}).click();await expect(sheet).toHaveCount(0);await expect(page.getByRole('dialog')).toContainText('ポスト');
  130 |   }else{await expect(page.getByRole('dialog',{name:'リポストの操作'})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'引用リポスト'})).toBeVisible();}
  131 |  }
  132 | });
  133 | 
```