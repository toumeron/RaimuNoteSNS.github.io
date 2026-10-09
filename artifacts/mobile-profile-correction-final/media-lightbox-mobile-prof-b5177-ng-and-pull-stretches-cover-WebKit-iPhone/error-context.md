# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media-lightbox.spec.ts >> mobile profile cover reaches the top, header stays when scrolling, and pull stretches cover
- Location: tests/media-lightbox/media-lightbox.spec.ts:306:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 1
Received:   1

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e4]:
    - region "Notifications (F8)":
      - list
    - region "Notifications alt+T"
    - main [ref=e6]:
      - generic [ref=e7]:
        - generic [ref=e8]:
          - button "Lime Noteのヘッダー画像を拡大表示" [ref=e10] [cursor=pointer]
          - generic [ref=e11]:
            - generic [ref=e12]:
              - button "Lime Noteのプロフィール画像を拡大表示" [ref=e13] [cursor=pointer]:
                - generic [ref=e14]: L
              - button "プロフィールを編集" [ref=e17] [cursor=pointer]
            - generic [ref=e19]:
              - heading "Lime Note" [level=1] [ref=e21]
              - paragraph [ref=e22]: "@lime"
            - paragraph [ref=e23]: プロフィールの自己紹介
            - generic [ref=e24]:
              - link "2026年10月 から参加" [ref=e25]:
                - /url: /RaimuNoteSNS.github.io/u/lime/about
              - generic [ref=e29]: 東京都
            - generic [ref=e34]:
              - link "0 フォロー中" [ref=e35]:
                - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=following
                - generic [ref=e36]: "0"
                - generic [ref=e37]: フォロー中
              - link "0 フォロワー" [ref=e38]:
                - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=followers
                - generic [ref=e39]: "0"
                - generic [ref=e40]: フォロワー
              - generic [ref=e41]:
                - generic [ref=e42]: "3"
                - generic [ref=e43]: 投稿
        - generic [ref=e44]:
          - tablist [ref=e46]:
            - tab "ポスト" [selected] [ref=e47] [cursor=pointer]
            - tab "メディア" [ref=e49] [cursor=pointer]
            - tab "いいね" [ref=e51] [cursor=pointer]
            - tab "リアクション" [ref=e53] [cursor=pointer]
          - generic [ref=e55]:
            - article [ref=e59] [cursor=pointer]:
              - generic [ref=e60]:
                - link "L" [ref=e61]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e64]:
                  - generic [ref=e65]:
                    - generic [ref=e66]:
                      - link "Lime Note" [ref=e67]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e70]: "@lime"
                      - generic [ref=e71]: ·
                      - generic [ref=e72]: 8日前
                    - button "ポストのメニュー" [ref=e75]
                  - paragraph [ref=e82]: 写真の投稿
                  - generic [ref=e87]:
                    - button [ref=e89]
                    - button "リポスト" [ref=e91]
                    - link "返信" [ref=e92]:
                      - /url: /RaimuNoteSNS.github.io/post/native
                    - button "リアクションを追加" [ref=e96]
                    - generic [ref=e98]:
                      - button "ブックマークに追加" [ref=e99]
                      - button "ポストを共有" [ref=e102]
            - article [ref=e109] [cursor=pointer]:
              - generic [ref=e110]:
                - link "L" [ref=e111]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e114]:
                  - generic [ref=e115]:
                    - generic [ref=e116]:
                      - link "Lime Note" [ref=e117]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e120]: "@lime"
                      - generic [ref=e121]: ·
                      - generic [ref=e122]: 8日前
                    - generic [ref=e123]:
                      - generic [ref=e124]: 限定
                      - button "ポストのメニュー" [ref=e126]
                  - paragraph [ref=e133]:
                    - text: 二つのリンク
                    - link "https://preview.example/a" [ref=e134]:
                      - /url: https://preview.example/a
                    - link "https://preview.example/b" [ref=e135]:
                      - /url: https://preview.example/b
                  - generic [ref=e140]:
                    - button [ref=e142]
                    - button "リポスト" [ref=e144]
                    - link "返信" [ref=e145]:
                      - /url: /RaimuNoteSNS.github.io/post/private
                    - button "リアクションを追加" [ref=e149]
                    - generic [ref=e151]:
                      - button "ブックマークに追加" [ref=e152]
                      - button "ポストを共有" [ref=e155]
            - article [ref=e162] [cursor=pointer]:
              - generic [ref=e163]:
                - link "L" [ref=e164]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e167]:
                  - generic [ref=e168]:
                    - generic [ref=e169]:
                      - link "Lime Note" [ref=e170]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e173]: "@lime"
                      - generic [ref=e174]: ·
                      - generic [ref=e175]: 8日前
                    - button "ポストのメニュー" [ref=e178]
                  - generic [ref=e183]:
                    - paragraph [ref=e185]:
                      - text: プレビューなし
                      - link "https://preview.example/none" [ref=e186]:
                        - /url: https://preview.example/none
                    - generic [ref=e187]: Bluesky
                  - generic [ref=e196]:
                    - button "いいね" [ref=e198]
                    - button "リポスト" [ref=e200]
                    - button [ref=e201]
                    - generic [ref=e204]:
                      - button "ブックマークに追加" [ref=e205]
                      - button "ポストを共有" [ref=e208]
            - article [ref=e215] [cursor=pointer]:
              - generic [ref=e216]:
                - link "L" [ref=e218]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e222]:
                  - generic [ref=e223]:
                    - link "Lime Note" [ref=e224]:
                      - /url: /RaimuNoteSNS.github.io/u/lime
                    - generic [ref=e227]: "@lime"
                    - generic [ref=e228]: ·
                    - generic [ref=e229]: 8日前
                  - paragraph [ref=e230]: 写真の投稿
                  - generic [ref=e235]:
                    - button [ref=e237]
                    - button "リポスト" [ref=e239]
                    - button "返信を表示" [ref=e240]
                    - button "リアクションを追加" [ref=e244]
                    - generic [ref=e246]:
                      - button "ブックマークに追加" [ref=e247]
                      - button "共有" [ref=e251]
              - generic [ref=e255]:
                - link "L" [ref=e257]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e260]:
                  - generic [ref=e261]:
                    - generic [ref=e262]:
                      - link "Lime Note" [ref=e263]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e266]: "@lime"
                      - generic [ref=e267]: ·
                      - generic [ref=e268]: 8日前
                    - button "コメントのメニュー" [ref=e269]
                  - paragraph [ref=e274]:
                    - text: 返信のリンク
                    - link "https://preview.example/reply" [ref=e275]:
                      - /url: https://preview.example/reply
                  - link "9月日記 | プレビュー確認" [ref=e276]:
                    - /url: https://preview.example/reply
                    - generic [ref=e277]:
                      - generic [ref=e278]: preview.example
                      - generic [ref=e279]: 9月日記 | プレビュー確認
                  - button "画像を拡大表示" [ref=e281]:
                    - img "投稿画像" [ref=e282]
                  - generic [ref=e283]:
                    - button [ref=e285]
                    - button "リポスト" [ref=e287]
                    - button "返信を表示" [ref=e288]
                    - button "リアクションを追加" [ref=e292]
                    - generic [ref=e294]:
                      - button "ブックマークに追加" [ref=e295]
                      - button "返信を共有" [ref=e298]
            - article [ref=e305] [cursor=pointer]:
              - generic [ref=e306]:
                - link "L" [ref=e307]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e310]:
                  - generic [ref=e311]:
                    - generic [ref=e312]:
                      - link "Lime Note" [ref=e313]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e316]: "@lime"
                      - generic [ref=e317]: ·
                      - generic [ref=e318]: 7年前
                    - button "ポストのメニュー" [ref=e321]
                  - paragraph [ref=e328]: 古い固定対象
                  - generic [ref=e333]:
                    - button [ref=e335]
                    - button "リポスト" [ref=e337]
                    - link "返信" [ref=e338]:
                      - /url: /RaimuNoteSNS.github.io/post/old
                    - button "リアクションを追加" [ref=e342]
                    - generic [ref=e344]:
                      - button "ブックマークに追加" [ref=e345]
                      - button "ポストを共有" [ref=e348]
            - paragraph [ref=e353]: すべての表示が完了しました
  - banner [ref=e354]:
    - generic [ref=e356]:
      - button "戻る" [ref=e357] [cursor=pointer]
      - generic [ref=e360]:
        - generic [ref=e361]: Lime Note
        - generic [ref=e362]: 3件のポスト
      - link "プロフィールを検索" [ref=e363]:
        - /url: /RaimuNoteSNS.github.io/search?q=%40lime
      - button "プロフィールのその他のメニュー" [active] [ref=e367] [cursor=pointer]
  - button "新規投稿" [ref=e372] [cursor=pointer]
  - navigation [ref=e376]:
    - list [ref=e377]:
      - listitem [ref=e378]:
        - link [ref=e379]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=e384]:
        - link [ref=e385]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=e390]:
        - link [ref=e391]:
          - /url: /RaimuNoteSNS.github.io/u/lime
      - listitem [ref=e396]:
        - link [ref=e397]:
          - /url: /RaimuNoteSNS.github.io/notifications
      - listitem [ref=e402]:
        - link [ref=e403]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=e407]:
        - link [ref=e408]:
          - /url: /RaimuNoteSNS.github.io/settings
```

# Test source

```ts
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
  308 |  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  309 |  let profileReads=0;page.on('request',request=>{if(request.url().includes('/__bookmark-fixture/profile-posts?'))profileReads++;});
  310 |  await setup(page,false);
  311 |  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='body { padding-top: 44px !important; }';document.head.append(style);}));
  312 |  await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'11111111-1111-1111-1111-111111111111',username:'lime',display_name:'Lime Note',avatar_url:'',cover_url:'https://media.example/one.svg',created_at:'2026-10-01T00:00:00Z',bio:'プロフィールの自己紹介',location:'東京都'})}));
  313 |  await page.goto('u/lime');
  314 |  const cover=page.locator('.profile-header-cover-avatar-gap'),header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
  315 |  await expect(cover).toBeVisible();await expect(header).toBeVisible();
  316 |  if(info.project.name==='WebKit-iPhone')expect((await cover.boundingBox())!.y).toBe(0);
  317 |  await expect(header.getByText('Lime Note',{exact:true})).toHaveCount(1);
  318 |  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(48);
  319 |  await press(page,header.getByRole('button',{name:'プロフィールのその他のメニュー'}));
  320 |  const copy=page.getByRole('menuitem',{name:'リンクをコピー',exact:true});await expect(copy).toBeVisible();
  321 |  expect(await copy.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  322 |  await page.keyboard.press('Escape');
  323 |  await page.screenshot({path:info.outputPath('profile-top.png')});
  324 |  await page.evaluate(()=>window.scrollTo(0,250));await expect(header).toHaveAttribute('data-lime-profile-scrolled','true');await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
  325 |  await expect(header.locator('.lime-profile-bar-background')).toHaveCSS('opacity','1');
  326 |  expect((await header.boundingBox())!.y).toBe(0);
  327 |  await page.screenshot({path:info.outputPath('profile-scrolled.png'),animations:'disabled'});
  328 |  await page.evaluate(()=>window.scrollTo(0,0));
  329 |  await expect(page.locator('[data-lime-profile-posts]').getByText('写真の投稿',{exact:true}).first()).toBeVisible();
  330 |  const readsBeforePull=profileReads;
  331 |  const initial=(await cover.boundingBox())!.height;
  332 |  await cover.evaluate(el=>{
  333 |   const target=el.querySelector('img') ?? el.querySelector('button') ?? el;
  334 |   const touch=(type:string,y:number)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:[{identifier:1,target,clientX:150,clientY:y}]});target.dispatchEvent(event);};
  335 |   touch('touchstart',100);touch('touchmove',260);
  336 |  });
  337 |  await expect(page.locator('[data-lime-profile-page]')).toHaveAttribute('data-lime-profile-pulling','true');
  338 |  expect((await cover.boundingBox())!.height).toBeGreaterThan(initial+60);
  339 |  await expect(page.locator('[data-lime-profile-pull-indicator]')).toHaveCSS('opacity','1');
  340 |  await page.screenshot({path:info.outputPath('profile-pull.png')});
  341 |  await cover.evaluate(el=>el.dispatchEvent(new Event('touchend',{bubbles:true})));
  342 |  await expect(page.locator('[data-lime-profile-page]')).not.toHaveAttribute('data-lime-profile-pulling','true');
  343 |  await expect.poll(async()=>(await cover.boundingBox())!.height).toBe(initial);
> 344 |  await expect.poll(()=>profileReads).toBeGreaterThan(readsBeforePull);
      |                                      ^ Error: expect(received).toBeGreaterThan(expected)
  345 |  await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
  346 |  expect(errors).toEqual([]);
  347 |  await page.goto('settings');
  348 |  if(info.project.name==='WebKit-iPhone')await expect(page.locator('body')).toHaveCSS('padding-top','44px');
  349 |  await expect(page.locator('html')).not.toHaveAttribute('data-lime-iphone-profile','true');
  350 | });
  351 | 
```