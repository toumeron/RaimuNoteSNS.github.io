# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media-lightbox.spec.ts >> mobile profile without a cover uses a grey borderless header and restores the follow transition (dark)
- Location: tests/media-lightbox/media-lightbox.spec.ts:353:39

# Error details

```
Error: expect(locator).toHaveCSS(expected) failed

Locator:  locator('header[data-lime-mobile-profile-header-hidden=true]')
Expected: "none"
Received: ""
Timeout:  5000ms

Call log:
  - Expect "toHaveCSS" locator('header[data-lime-mobile-profile-header-hidden=true]') with timeout 5000ms
  - waiting for locator('header[data-lime-mobile-profile-header-hidden=true]')
    14 × locator resolved to <header data-lime-app-header="true" data-lime-profile-no-cover="true" data-lime-profile-scrolled="true" data-lime-profile-title-visible="true" data-lime-mobile-profile-header-hidden="true" class="sticky top-0 border-0 transition-transform duration-300 ease-out sm:translate-y-0 translate-y-0 z-50 border-border/40 bg-background/80">…</header>
       - unexpected value ""

```

```yaml
- banner:
  - button "戻る"
  - text: User 3件のポスト
  - button "プロフィールのその他のメニュー"
  - button "フォロー中"
```

# Test source

```ts
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
  315 |  await expect(cover).toBeVisible();await expect(header).toBeVisible();
  316 |  if(info.project.name==='WebKit-iPhone')expect((await cover.boundingBox())!.y).toBe(0);
  317 |  await expect(header.getByText('Lime Note',{exact:true})).toHaveCount(1);
  318 |  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(56);
  319 |  await expect(page.locator('[data-lime-profile-tabs-header]')).toHaveCSS('height','44px');
  320 |  await press(page,header.getByRole('button',{name:'プロフィールのその他のメニュー'}));
  321 |  const copy=page.getByRole('menuitem',{name:'リンクをコピー',exact:true});await expect(copy).toBeVisible();
  322 |  expect(await copy.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  323 |  await page.keyboard.press('Escape');
  324 |  await page.screenshot({path:info.outputPath('profile-top.png')});
  325 |  await page.evaluate(()=>window.scrollTo(0,280));await expect(header).toHaveAttribute('data-lime-profile-scrolled','true');await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
  326 |  await expect(header.locator('.lime-profile-bar-background')).toHaveCSS('opacity','1');
  327 |  expect((await header.boundingBox())!.y).toBe(0);
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
> 368 |  await expect(header).toHaveCSS('-webkit-backdrop-filter','none');
      |                       ^ Error: expect(locator).toHaveCSS(expected) failed
  369 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('width','124px');
  370 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('transition-duration','0.18s, 0.18s, 0.18s');
  371 |  await expect(header.locator('.lime-profile-bar-follow')).not.toHaveAttribute('inert','');
  372 |  await expect(page.locator('[data-lime-profile-tabs-header]')).toHaveCSS('height','44px');
  373 |  await page.screenshot({path:info.outputPath('no-cover-scrolled.png')});
  374 |  await page.evaluate(()=>window.scrollTo(0,0));await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','0');
  375 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('width','0px');
  376 |  await expect(header.locator('.lime-profile-bar-follow')).toHaveAttribute('inert','');
  377 |  expect(errors).toEqual([]);
  378 | });
  379 | 
```