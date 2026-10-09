# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media-lightbox.spec.ts >> mobile profile cover reaches the top, header stays when scrolling, and pull stretches cover
- Location: tests/media-lightbox/media-lightbox.spec.ts:306:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('header[data-lime-mobile-profile-header-hidden=true]')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" locator('header[data-lime-mobile-profile-header-hidden=true]') with timeout 5000ms
  - waiting for locator('header[data-lime-mobile-profile-header-hidden=true]')
    13 × locator resolved to <header data-lime-app-header="true" class="lime-profile-controls-host" data-lime-mobile-profile-header-hidden="true">…</header>
       - unexpected value "hidden"

```

```yaml
- region "Notifications (F8)":
  - list
- region "Notifications alt+T"
- main:
  - button "Lime Noteのヘッダー画像を拡大表示"
  - button "Lime Noteのプロフィール画像を拡大表示": L
  - button "プロフィールを編集"
  - heading "Lime Note" [level=1]
  - paragraph: "@lime"
  - paragraph: プロフィールの自己紹介
  - link "2026年10月 から参加":
    - /url: /RaimuNoteSNS.github.io/u/lime/about
    - img
    - text: 2026年10月 から参加
  - text: 東京都
  - link "0 フォロー中":
    - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=following
  - link "0 フォロワー":
    - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=followers
  - text: 3 投稿
  - tablist:
    - tab "ポスト" [selected]
    - tab "メディア"
    - tab "いいね"
    - tab "リアクション"
  - article:
    - link "L":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - link "Lime Note":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - text: "@lime · 9日前"
    - button "ポストのメニュー":
      - img
    - paragraph: 写真の投稿
    - button:
      - img
    - button "リポスト"
    - link "返信":
      - /url: /RaimuNoteSNS.github.io/post/native
      - img
    - button "リアクションを追加":
      - img
    - button "ブックマークに追加":
      - img
    - button "ポストを共有":
      - img
  - article:
    - link "L":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - link "Lime Note":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - text: "@lime · 9日前 限定"
    - button "ポストのメニュー":
      - img
    - paragraph:
      - text: 二つのリンク
      - link "https://preview.example/a":
        - /url: https://preview.example/a
      - link "https://preview.example/b":
        - /url: https://preview.example/b
    - button:
      - img
    - button "リポスト"
    - link "返信":
      - /url: /RaimuNoteSNS.github.io/post/private
      - img
    - button "リアクションを追加":
      - img
    - button "ブックマークに追加":
      - img
    - button "ポストを共有":
      - img
  - article:
    - link "L":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - link "Lime Note":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - text: "@lime · 9日前"
    - button "ポストのメニュー":
      - img
    - paragraph:
      - text: プレビューなし
      - link "https://preview.example/none":
        - /url: https://preview.example/none
    - img
    - text: Bluesky
    - button "いいね":
      - img
    - button "リポスト"
    - button:
      - img
    - button "ブックマークに追加":
      - img
    - button "ポストを共有":
      - img
  - article:
    - link "L":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - link "Lime Note":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - text: "@lime · 9日前"
    - paragraph: 写真の投稿
    - button:
      - img
    - button "リポスト"
    - button "返信を表示":
      - img
    - button "リアクションを追加":
      - img
    - button "ブックマークに追加":
      - img
    - button "共有":
      - img
    - link "L":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - link "Lime Note":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - text: "@lime · 9日前"
    - button "コメントのメニュー":
      - img
    - paragraph:
      - text: 返信のリンク
      - link "https://preview.example/reply":
        - /url: https://preview.example/reply
    - link "9月日記 | プレビュー確認":
      - /url: https://preview.example/reply
      - text: preview.example 9月日記 | プレビュー確認
    - button "画像を拡大表示":
      - img "投稿画像"
    - button:
      - img
    - button "リポスト"
    - button "返信を表示":
      - img
    - button "リアクションを追加":
      - img
    - button "ブックマークに追加":
      - img
    - button "返信を共有":
      - img
  - article:
    - link "L":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - link "Lime Note":
      - /url: /RaimuNoteSNS.github.io/u/lime
    - text: "@lime · 7年前"
    - button "ポストのメニュー":
      - img
    - paragraph: 古い固定対象
    - button:
      - img
    - button "リポスト"
    - link "返信":
      - /url: /RaimuNoteSNS.github.io/post/old
      - img
    - button "リアクションを追加":
      - img
    - button "ブックマークに追加":
      - img
    - button "ポストを共有":
      - img
  - paragraph: すべての表示が完了しました
- banner:
  - button "戻る":
    - img
  - text: Lime Note 3件のポスト
  - link "プロフィールを検索":
    - /url: /RaimuNoteSNS.github.io/search?q=%40lime
    - img
  - button "プロフィールのその他のメニュー":
    - img
- button "新規投稿":
  - img
- navigation:
  - list:
    - listitem:
      - link "ホーム":
        - /url: /RaimuNoteSNS.github.io/
        - img
        - text: ホーム
    - listitem:
      - link "検索":
        - /url: /RaimuNoteSNS.github.io/search
        - img
        - text: 検索
    - listitem:
      - link "プロフ":
        - /url: /RaimuNoteSNS.github.io/u/lime
        - img
        - text: プロフ
    - listitem:
      - link "通知":
        - /url: /RaimuNoteSNS.github.io/notifications
        - img
        - text: 通知
    - listitem:
      - link "チャット":
        - /url: /RaimuNoteSNS.github.io/chat
        - img
        - text: チャット
    - listitem:
      - link "設定":
        - /url: /RaimuNoteSNS.github.io/settings
        - img
        - text: 設定
```

# Test source

```ts
  215 |  test.skip((page.viewportSize()?.width??0)>=768,'Mobile touch controls');
  216 |  await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
  217 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'}),stage=viewer.locator('.lime-media-stage');
  218 |  await stage.dispatchEvent('pointerdown',{pointerId:70,pointerType:'touch',clientX:200,clientY:260});await stage.dispatchEvent('pointermove',{pointerId:70,pointerType:'touch',clientX:140,clientY:260});await stage.dispatchEvent('pointerup',{pointerId:70,pointerType:'touch',clientX:140,clientY:260});
  219 |  await expect(viewer.getByAltText('拡大画像 1')).toBeVisible();await expect(viewer.locator('.lime-media-image-track')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  220 |  await press(page,viewer.getByRole('button',{name:'返信を入力'}));const reply=page.getByRole('dialog',{name:'返信を作成',exact:true});
  221 |  await expect(reply.locator('[data-lime-embedded] [data-lime-post-body]')).toContainText('写真の投稿');await expect(reply.locator('[data-lime-embedded] [data-lime-post-body] img')).toHaveCount(2);
  222 |  const avatars=await reply.locator('[data-lime-thread-avatar]').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,width:r.width,height:r.height};}));expect(avatars).toHaveLength(2);expect(avatars[0].x).toBe(avatars[1].x);for(const a of avatars){expect(a.width).toBe(40);expect(a.height).toBe(40);}
  223 |  await expect(reply.locator('svg line')).toHaveCount(1);
  224 | });
  225 | 
  226 | test('mobile image action circles and glyphs align including the direct reply link',async({page},info)=>{
  227 |  test.skip((page.viewportSize()?.width??0)>=768,'Mobile action circles');await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
  228 |  const row=page.locator('.lime-media-bottom [data-lime-post-actions]');const circles=await row.evaluate(el=>Array.from(el.children).slice(0,4).map(el=>{const rect=el.getBoundingClientRect(),svg=el.querySelector('svg:not(.twitter-like-effects)')!.getBoundingClientRect();return{width:rect.width,height:rect.height,center:rect.y+rect.height/2,svgWidth:svg.width,svgHeight:svg.height,svgCenter:svg.y+svg.height/2};}));
  229 |  for(const circle of circles){expect(circle.width).toBe(40);expect(circle.height).toBe(40);expect(circle.center).toBe(circles[0].center);expect(circle.svgWidth).toBe(20);expect(circle.svgHeight).toBe(20);expect(circle.svgCenter).toBe(circle.center);}
  230 |  await page.screenshot({path:info.outputPath('uniform-actions.png')});
  231 | });
  232 | 
  233 | test('saved LimeAI model displays across pages, supports placement and persists settings',async({page},info)=>{
  234 |  test.skip(info.project.name==='small-mobile'||info.project.name==='WebKit-iPhone','Real WebGL verified in Chrome desktop and mobile');
  235 |  await setup(page,false);await page.goto('./');
  236 |  await expect(page.locator('[data-lime-page-companion]')).toHaveCount(0);
  237 |  await page.evaluate(async()=>{const response=await fetch('/RaimuNoteSNS.github.io/models/robot-expressive.glb');const blob=await response.blob();await new Promise<void>((resolve,reject)=>{const req=indexedDB.open('limeai-avatar',1);req.onupgradeneeded=()=>req.result.createObjectStore('models',{keyPath:'id'});req.onsuccess=()=>{const db=req.result,tx=db.transaction('models','readwrite');tx.objectStore('models').put({id:'companion-test',name:'保存済みロボット',blob,createdAt:Date.now(),format:'glb'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});});
  238 |  await page.goto('settings');const settings=page.locator('[data-lime-companion-settings]');await expect(settings).toBeVisible();
  239 |  await expect(settings.locator('select#companion-model option[value=companion-test]')).toHaveText('保存済みロボット');await settings.locator('#companion-model').selectOption('companion-test');await press(page,settings.getByRole('switch',{name:'全ページにキャラクターを表示'}));
  240 |  const widget=page.getByRole('complementary',{name:'LimeAI キャラクター',exact:true});await expect(widget.locator('canvas')).toBeVisible({timeout:30000});await expect(widget.getByRole('status')).toHaveCount(0,{timeout:30000});await expect(widget.getByRole('alert')).toHaveCount(0);
  241 |  expect(await widget.locator('canvas').evaluate(canvas=>(canvas as HTMLCanvasElement).width)).toBeGreaterThan(100);
  242 |  await page.screenshot({path:info.outputPath('companion-settings.png')});
  243 |  if(info.project.name==='desktop'){
  244 |   const before=await widget.boundingBox();const bounds=await widget.locator('canvas').boundingBox();
  245 |   await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);await page.mouse.down();await page.mouse.move(bounds!.x+bounds!.width/2-80,bounds!.y+bounds!.height/2-60,{steps:8});await page.mouse.up();
  246 |   await expect.poll(async()=>Math.round((await widget.boundingBox())!.x)).toBe(Math.round(before!.x-80));
  247 |  }
  248 | 
  249 |  if(info.project.name==='mobile'){
  250 |   const before=await widget.boundingBox(),bounds=await widget.locator('canvas').boundingBox(),cdp=await page.context().newCDPSession(page);
  251 |   const x=bounds!.x+bounds!.width/2,y=bounds!.y+bounds!.height/2;
  252 |   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  253 |   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y:y-40}]});
  254 |   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  255 |   await expect.poll(async()=>Math.round((await widget.boundingBox())!.x)).toBe(Math.round(before!.x-50));await cdp.detach();
  256 |  }
  257 | 
  258 |  const canvas=await widget.locator('canvas').elementHandle();await page.evaluate(()=>{(window as any).__companionCanvas=document.querySelector('[data-lime-page-companion] canvas');});
  259 |  if((page.viewportSize()?.width??0)>=768)await page.getByRole('button',{name:'検索',exact:true}).first().click();else await press(page,page.locator('a[href$="/search"]').first());await expect(page).toHaveURL(/search/);await expect(widget.locator('canvas')).toBeVisible();expect(await widget.locator('canvas').evaluate(el=>el===(window as any).__companionCanvas)).toBe(true);
  260 |  await expect(widget.getByRole('button',{name:'キャラクターを移動'})).toHaveCount(0);const handle=widget.locator('canvas');await handle.dispatchEvent('pointerdown',{pointerId:50,clientX:300,clientY:300});await handle.dispatchEvent('pointermove',{pointerId:50,clientX:-1500,clientY:200});await handle.dispatchEvent('pointerup',{pointerId:50,clientX:-1500,clientY:200});
  261 |  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('lime-companion:11111111-1111-1111-1111-111111111111')!).x)).toBeLessThan(0);
  262 |  await handle.dispatchEvent('pointerdown',{pointerId:51,clientX:0,clientY:0});await handle.dispatchEvent('pointerup',{pointerId:51,clientX:1800,clientY:100});
  263 |  await page.reload();await expect(widget.locator('canvas')).toBeVisible({timeout:30000});await widget.hover();await press(page,widget.getByRole('button',{name:'キャラクターを非表示'}));await expect(widget).toHaveCount(0);
  264 |  await canvas?.dispose();
  265 | });
  266 | 
  267 | test('native URL cards restore saved metadata and image after reloading',async({page})=>{
  268 |  const state=await setup(page,false);
  269 |  state.extraPosts.push({id:'preview-native',userId:'11111111-1111-1111-1111-111111111111',content:'保存するカード https://preview.example/cache',createdAt:'2026-10-01T00:00:00Z',imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,author:{id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:''}});
  270 |  await page.route('https://preview.example/cover.svg',route=>route.fulfill({contentType:'image/svg+xml',headers:{'access-control-allow-origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="pink"/></svg>'}));
  271 |  await page.goto('post/preview-native');const card=page.locator('[data-link-preview]').first();await expect(card).toBeVisible();
  272 |  await expect.poll(()=>page.evaluate(async()=>{const {savedPreviewImage}=await import('/RaimuNoteSNS.github.io/src/lib/linkPreviewCache.ts');return !!await savedPreviewImage('https://preview.example/cover.svg');})).toBe(true);
  273 |  const requests:string[]=[];page.on('request',request=>{if(request.url().includes('/functions/v1/link-preview')||request.url()==='https://preview.example/cover.svg')requests.push(request.url());});
  274 |  await page.reload();await expect(card).toBeVisible();await expect(card.locator('img')).toHaveAttribute('src',/^blob:/);
  275 |  expect(requests).toEqual([]);
  276 | });
  277 | 
  278 | 
  279 | test('reply options preserve activity navigation on all devices',async({page})=>{
  280 |  await setup(page,false);await page.goto('post/native');
  281 |  await press(page,page.getByRole('button',{name:'コメントのメニュー',exact:true}).first());await press(page,page.getByRole('button',{name:'ポストアクティビティ',exact:true}));
  282 |  await expect(page).toHaveURL(/activity\?reply=child$/);
  283 | });
  284 | 
  285 | test('mobile repost sheet floats over dimmed background without hiding navigation',async({page},info)=>{
  286 |  test.skip((page.viewportSize()?.width??0)>=640,'Phone action sheet');
  287 |  await setup(page,false);await page.addInitScript(()=>localStorage.setItem('theme','light'));await page.goto('./');
  288 |  const post=page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first();
  289 |  const trigger=post.locator('[data-lime-post-action="repost"]');
  290 |  await press(page,trigger);
  291 |  const sheet=page.locator('.lime-post-action-sheet'),backdrop=page.locator('.lime-post-action-sheet-backdrop');
  292 |  await expect(sheet).toBeVisible();await expect(backdrop).toHaveCSS('background-color','rgba(0, 0, 0, 0.35)');
  293 |  await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
  294 |  await expect(page.locator('[data-lime-app-header]')).toBeVisible();
  295 |  const box=await sheet.boundingBox();expect(Math.abs(box!.y+box!.height-(page.viewportSize()!.height-8))).toBeLessThan(2);expect(box!.x).toBe(8);
  296 |  await page.screenshot({path:info.outputPath('repost-sheet-light.png')});
  297 |  await expect(sheet.locator('.lime-post-sheet-close')).toHaveCount(0);await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);
  298 |  await press(page,trigger);await expect(sheet).toBeVisible();
  299 |  await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);
  300 |  await press(page,post.locator('[data-lime-post-body] img').first());
  301 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
  302 |  await press(page,viewer.locator('.lime-media-bottom [data-lime-post-action="repost"]'));await expect(sheet).toBeVisible();
  303 |  await expect(sheet.locator('.lime-post-sheet-close')).toHaveCount(0);await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);await expect(viewer).toBeVisible();
  304 | });
  305 | 
  306 | test('mobile profile cover reaches the top, header stays when scrolling, and pull stretches cover',async({page},info)=>{
  307 |  test.skip((page.viewportSize()?.width??0)>=640,'Mobile profile');
  308 |  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error' && message.text().includes('inert'))errors.push(message.text());});
  309 |  let profileReads=0;page.on('request',request=>{if(request.url().includes('/__bookmark-fixture/profile-posts?'))profileReads++;});
  310 |  await setup(page,false);
  311 |  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='body { padding-top: 44px !important; }';document.head.append(style);}));
  312 |  await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'11111111-1111-1111-1111-111111111111',username:'lime',display_name:'Lime Note',avatar_url:'',cover_url:'https://media.example/one.svg',created_at:'2026-10-01T00:00:00Z',bio:'プロフィールの自己紹介',location:'東京都'})}));
  313 |  await page.goto('u/lime');
  314 |  const cover=page.locator('.profile-header-cover-avatar-gap'),header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
> 315 |  await expect(cover).toBeVisible();await expect(header).toBeVisible();
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  316 |  if(info.project.name==='WebKit-iPhone')expect((await cover.boundingBox())!.y).toBe(0);
  317 |  await expect(header.getByText('Lime Note',{exact:true})).toHaveCount(1);
  318 |  expect((await header.locator('[data-lime-header-row]').boundingBox())!.height).toBeLessThanOrEqual(56);
  319 |  await expect(page.locator('[data-lime-profile-tabs-header]')).toHaveCSS('height','44px');
  320 |  await press(page,header.getByRole('button',{name:'プロフィールのその他のメニュー'}));
  321 |  const copy=page.getByRole('menuitem',{name:'リンクをコピー',exact:true});await expect(copy).toBeVisible();
  322 |  expect(await copy.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  323 |  await page.keyboard.press('Escape');
  324 |  await page.screenshot({path:info.outputPath('profile-top.png')});
  325 |  await page.evaluate(()=>window.scrollTo(0,280));await expect(header).toHaveAttribute('data-lime-profile-scrolled','true');await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
  326 |  await expect(header.locator('.lime-profile-bar-background')).toHaveCSS('opacity','1');
  327 |  expect((await header.locator('[data-lime-header-row]').boundingBox())!.y).toBe(0);
  328 |  await page.screenshot({path:info.outputPath('profile-scrolled.png'),animations:'disabled'});
  329 |  await page.evaluate(()=>window.scrollTo(0,0));
  330 |  await expect(page.locator('[data-lime-profile-posts]').getByText('写真の投稿',{exact:true}).first()).toBeVisible();
  331 |  const readsBeforePull=profileReads;
  332 |  const initial=(await cover.boundingBox())!.height;
  333 |  await cover.evaluate(el=>{
  334 |   const target=el.querySelector('img') ?? el.querySelector('button') ?? el;
  335 |   const touch=(type:string,y:number)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:[{identifier:1,target,clientX:150,clientY:y}]});target.dispatchEvent(event);};
  336 |   touch('touchstart',100);touch('touchmove',260);
  337 |  });
  338 |  await expect(page.locator('[data-lime-profile-page]')).toHaveAttribute('data-lime-profile-pulling','true');
  339 |  expect((await cover.boundingBox())!.height).toBeGreaterThan(initial+60);
  340 |  await expect(page.locator('[data-lime-profile-pull-indicator]')).toHaveCSS('opacity','1');
  341 |  await page.screenshot({path:info.outputPath('profile-pull.png')});
  342 |  await cover.evaluate(el=>el.dispatchEvent(new Event('touchend',{bubbles:true})));
  343 |  await expect(page.locator('[data-lime-profile-page]')).not.toHaveAttribute('data-lime-profile-pulling','true');
  344 |  await expect.poll(async()=>(await cover.boundingBox())!.height).toBe(initial);
  345 |  await expect.poll(()=>profileReads).toBeGreaterThan(readsBeforePull);
  346 |  await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
  347 |  expect(errors).toEqual([]);
  348 |  await page.goto('settings');
  349 |  if(info.project.name==='WebKit-iPhone')await expect(page.locator('body')).toHaveCSS('padding-top','44px');
  350 |  await expect(page.locator('html')).not.toHaveAttribute('data-lime-iphone-profile','true');
  351 | });
  352 | 
  353 | for (const theme of ['light','dark']) test(`mobile profile without a cover uses a grey borderless header and restores the follow transition (${theme})`,async({page},info)=>{
  354 |  test.skip((page.viewportSize()?.width??0)>=640,'Phone profile');
  355 |  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Warning:'))errors.push(m.text());});
  356 |  await setup(page,false);await page.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  357 |  await page.route('**/src/api/follows.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const getFollowStats=async()=>({following:22,followers:86,followedByMe:true});export const toggleFollow=async()=>({following:false});export const getFollowing=async()=>[];export const getFollowers=async()=>[];'}));
  358 |  await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'22222222-2222-2222-2222-222222222222',username:'other',display_name:'User',avatar_url:'',cover_url:null,created_at:'2026-10-01T00:00:00Z'})}));
  359 |  await page.goto('u/other');
  360 |  const header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
  361 |  await expect(header).toHaveAttribute('data-lime-profile-no-cover','true');
  362 |  await expect(header.locator('.lime-profile-bar-background')).toHaveCSS('background-color',theme==='light'?'rgb(180, 178, 178)':'rgb(100, 98, 98)');
  363 |  await page.screenshot({path:info.outputPath('no-cover-top.png')});
  364 |  await page.evaluate(()=>window.scrollTo(0,600));
  365 |  await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
  366 |  await expect(header).toHaveCSS('border-bottom-width','0px');
  367 |  await expect(header).toHaveCSS('box-shadow','none');
  368 |  await expect(header).toHaveCSS('backdrop-filter','none');
  369 |  if(info.project.name==='WebKit-iPhone')await expect(header).toHaveCSS('-webkit-backdrop-filter','none');
  370 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('width','124px');
  371 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('transition-duration','0.18s, 0.18s, 0.18s');
  372 |  await expect(header.locator('.lime-profile-bar-follow')).not.toHaveAttribute('inert','');
  373 |  await expect(page.locator('[data-lime-profile-tabs-header]')).toHaveCSS('height','44px');
  374 |  await page.screenshot({path:info.outputPath('no-cover-scrolled.png')});
  375 |  await page.evaluate(()=>window.scrollTo(0,0));await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','0');
  376 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('width','0px');
  377 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveAttribute('inert','');
  378 |  expect(errors).toEqual([]);
  379 | });
  380 | 
  381 | test('profile cover has no horizontal band at the control row boundary',async({page},info)=>{
  382 |  test.skip(info.project.name!=='mobile','Reproduce the supplied width');
  383 |  await page.setViewportSize({width:556,height:994});await setup(page,false);
  384 |  await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'11111111-1111-1111-1111-111111111111',username:'lime',display_name:'Lime Note',avatar_url:'',cover_url:'https://media.example/one.svg',created_at:'2026-10-01T00:00:00Z'})}));
  385 |  await page.goto('u/lime');await expect(page.locator('.profile-header-cover-avatar-gap img')).toBeVisible();
  386 |  await page.screenshot({path:info.outputPath('cover-boundary.png')});
  387 |  const header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
  388 |  await expect(header).toHaveCSS('display','contents');
  389 |  await expect(header.locator('[data-lime-header-row]')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  390 |  await expect(header.locator('[data-lime-header-row]')).toHaveCSS('border-bottom-width','0px');
  391 |  const row=await header.locator('[data-lime-header-row]').boundingBox();
  392 |  const points=await page.evaluate(y=>[100,200,300,400,500].map(x=>{const el=document.elementFromPoint(x,y);return !!el?.closest('.profile-header-cover-avatar-gap');}),row!.y+row!.height+1);
  393 |  expect(points).toEqual([true,true,true,true,true]);
  394 | });
  395 | 
```