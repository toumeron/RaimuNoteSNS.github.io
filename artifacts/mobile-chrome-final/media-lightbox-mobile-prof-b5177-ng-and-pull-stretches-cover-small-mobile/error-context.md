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

Expected: > 210
Received:   150
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
              - link "2026年10月 から参加" [ref=e25] [cursor=pointer]:
                - /url: /RaimuNoteSNS.github.io/u/lime/about
              - generic [ref=e29]: 東京都
            - generic [ref=e34]:
              - link "0 フォロー中" [ref=e35] [cursor=pointer]:
                - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=following
                - generic [ref=e36]: "0"
                - generic [ref=e37]: フォロー中
              - link "0 フォロワー" [ref=e38] [cursor=pointer]:
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
                      - generic [ref=e72]: 9日前
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
                      - generic [ref=e122]: 9日前
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
                      - generic [ref=e175]: 9日前
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
                    - generic [ref=e229]: 9日前
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
                      - generic [ref=e268]: 9日前
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
  - banner:
    - generic [ref=e354]:
      - button "戻る" [ref=e355] [cursor=pointer]
      - generic:
        - generic: Lime Note
        - generic: 3件のポスト
      - link "プロフィールを検索" [ref=e358] [cursor=pointer]:
        - /url: /RaimuNoteSNS.github.io/search?q=%40lime
      - button "プロフィールのその他のメニュー" [expanded] [ref=e362] [cursor=pointer]
  - navigation [ref=e367]:
    - list [ref=e368]:
      - listitem [ref=e369]:
        - link "ホーム" [ref=e370] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=e375]:
        - link "検索" [ref=e376] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=e381]:
        - link "プロフ" [ref=e382] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/u/lime
      - listitem [ref=e387]:
        - link "通知" [ref=e388] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/notifications
      - listitem [ref=e393]:
        - link "チャット" [ref=e394] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=e398]:
        - link "設定" [ref=e399] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/settings
  - menu "プロフィールのその他のメニュー" [active] [ref=e405]:
    - menuitem "リンクをコピー" [ref=e406]
    - menuitem "プロフィールを共有" [ref=e407]
```

# Test source

```ts
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
  315 |  await expect(cover).toBeVisible();await expect(header.locator("[data-lime-header-row]")).toBeVisible();
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
> 339 |  expect((await cover.boundingBox())!.height).toBeGreaterThan(initial+60);
      |                                              ^ Error: expect(received).toBeGreaterThan(expected)
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