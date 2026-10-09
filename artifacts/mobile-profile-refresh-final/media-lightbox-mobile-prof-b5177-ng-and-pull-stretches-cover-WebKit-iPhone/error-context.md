# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media-lightbox.spec.ts >> mobile profile cover reaches the top, header stays when scrolling, and pull stretches cover
- Location: tests/media-lightbox/media-lightbox.spec.ts:306:1

# Error details

```
Error: expect(locator).toHaveCSS(expected) failed

Locator:  locator('body')
Expected: "44px"
Received: "0px"
Timeout:  5000ms

Call log:
  - Expect "toHaveCSS" locator('body') with timeout 5000ms
  - waiting for locator('body')
    14 × locator resolved to <body>…</body>
       - unexpected value "0px"

```

```yaml
- region "Notifications (F8)":
  - list
- region "Notifications alt+T"
- banner:
  - button "戻る"
  - heading "設定" [level=1]
  - text: "@lime"
- main:
  - navigation "設定項目"
- button "新規投稿":
  - img
- navigation:
  - list
```

# Test source

```ts
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
  297 |  await press(page,sheet.getByRole('button',{name:'リポストの操作を閉じる',exact:true}));await expect(sheet).toHaveCount(0);
  298 |  await press(page,trigger);await expect(sheet).toBeVisible();
  299 |  await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);
  300 |  await press(page,post.locator('[data-lime-post-body] img').first());
  301 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
  302 |  await press(page,viewer.locator('.lime-media-bottom [data-lime-post-action="repost"]'));await expect(sheet).toBeVisible();
  303 |  await press(page,sheet.getByRole('button',{name:'リポストの操作を閉じる',exact:true}));await expect(sheet).toHaveCount(0);await expect(viewer).toBeVisible();
  304 | });
  305 | 
  306 | test('mobile profile cover reaches the top, header stays when scrolling, and pull stretches cover',async({page},info)=>{
  307 |  test.skip((page.viewportSize()?.width??0)>=640,'Mobile profile');
  308 |  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  309 |  let profileReads=0;page.on('request',request=>{if(request.url().includes('/__bookmark-fixture/profile-posts?'))profileReads++;});
  310 |  await setup(page,false);
  311 |  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.setProperty('--safe-top','44px')));
  312 |  await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'11111111-1111-1111-1111-111111111111',username:'lime',display_name:'Lime Note',avatar_url:'',cover_url:'https://media.example/one.svg',created_at:'2026-10-01T00:00:00Z',bio:'プロフィールの自己紹介',location:'東京都'})}));
  313 |  await page.goto('u/lime');
  314 |  const cover=page.locator('.profile-header-cover-avatar-gap'),header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
  315 |  await expect(cover).toBeVisible();await expect(header).toBeVisible();
  316 |  if(info.project.name==='WebKit-iPhone')expect((await cover.boundingBox())!.y).toBe(0);
  317 |  await expect(header.getByText('Lime Note',{exact:true})).toHaveCount(1);
  318 |  await page.screenshot({path:info.outputPath('profile-top.png')});
  319 |  await page.evaluate(()=>window.scrollTo(0,250));await expect(header).toHaveAttribute('data-lime-profile-scrolled','true');await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
  320 |  expect((await header.boundingBox())!.y).toBe(0);
  321 |  await page.screenshot({path:info.outputPath('profile-scrolled.png')});
  322 |  await page.evaluate(()=>window.scrollTo(0,0));
  323 |  await expect(page.locator('[data-lime-profile-posts]').getByText('写真の投稿',{exact:true}).first()).toBeVisible();
  324 |  const readsBeforePull=profileReads;
  325 |  const initial=(await cover.boundingBox())!.height;
  326 |  await cover.evaluate(el=>{
  327 |   const target=el.querySelector('img') ?? el.querySelector('button') ?? el;
  328 |   const touch=(type:string,y:number)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:[{identifier:1,target,clientX:150,clientY:y}]});target.dispatchEvent(event);};
  329 |   touch('touchstart',100);touch('touchmove',260);
  330 |  });
  331 |  await expect(page.locator('[data-lime-profile-page]')).toHaveAttribute('data-lime-profile-pulling','true');
  332 |  expect((await cover.boundingBox())!.height).toBeGreaterThan(initial+60);
  333 |  await expect(page.locator('[data-lime-profile-pull-indicator]')).toHaveCSS('opacity','1');
  334 |  await page.screenshot({path:info.outputPath('profile-pull.png')});
  335 |  await cover.evaluate(el=>el.dispatchEvent(new Event('touchend',{bubbles:true})));
  336 |  await expect(page.locator('[data-lime-profile-page]')).not.toHaveAttribute('data-lime-profile-pulling','true');
  337 |  await expect.poll(async()=>(await cover.boundingBox())!.height).toBe(initial);
  338 |  await expect.poll(()=>profileReads).toBeGreaterThan(readsBeforePull);
  339 |  await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
  340 |  expect(errors).toEqual([]);
  341 |  await page.goto('settings');
> 342 |  if(info.project.name==='WebKit-iPhone')await expect(page.locator('body')).toHaveCSS('padding-top','44px');
      |                                                                            ^ Error: expect(locator).toHaveCSS(expected) failed
  343 |  await expect(page.locator('html')).not.toHaveAttribute('data-lime-iphone-profile','true');
  344 | });
  345 | 
```