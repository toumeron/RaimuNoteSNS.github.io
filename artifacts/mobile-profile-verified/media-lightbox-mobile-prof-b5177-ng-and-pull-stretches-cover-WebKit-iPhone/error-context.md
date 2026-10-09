# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media-lightbox.spec.ts >> mobile profile cover reaches the top, header stays when scrolling, and pull stretches cover
- Location: tests/media-lightbox/media-lightbox.spec.ts:306:1

# Error details

```
Error: locator.evaluate: TypeError: Illegal constructor
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - region "Notifications (F8)":
      - list
    - region "Notifications alt+T"
    - generic [ref=e5]:
      - banner [ref=e6]:
        - generic [ref=e8]:
          - button "戻る" [ref=e10] [cursor=pointer]
          - generic [ref=e13]:
            - generic [ref=e14]: Lime Note
            - generic [ref=e15]: 3件のポスト
          - link "プロフィールを検索" [ref=e16]:
            - /url: /RaimuNoteSNS.github.io/search?q=%40lime
          - button "プロフィールのその他のメニュー" [ref=e20] [cursor=pointer]
      - main [ref=e25]:
        - generic [ref=e26]:
          - generic [ref=e27]:
            - button "Lime Noteのヘッダー画像を拡大表示" [ref=e29] [cursor=pointer]
            - generic [ref=e31]:
              - generic [ref=e32]:
                - button "Lime Noteのプロフィール画像を拡大表示" [ref=e33] [cursor=pointer]:
                  - generic [ref=e34]: L
                - button "プロフィールを編集" [ref=e37] [cursor=pointer]
              - generic [ref=e39]:
                - heading "Lime Note" [level=1] [ref=e41]
                - paragraph [ref=e42]: "@lime"
              - link "2026年10月 から参加" [ref=e44]:
                - /url: /RaimuNoteSNS.github.io/u/lime/about
              - generic [ref=e48]:
                - link "0 フォロー中" [ref=e49]:
                  - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=following
                  - generic [ref=e50]: "0"
                  - generic [ref=e51]: フォロー中
                - link "0 フォロワー" [ref=e52]:
                  - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=followers
                  - generic [ref=e53]: "0"
                  - generic [ref=e54]: フォロワー
                - generic [ref=e55]:
                  - generic [ref=e56]: "3"
                  - generic [ref=e57]: 投稿
          - generic [ref=e58]:
            - tablist [ref=e60]:
              - tab "ポスト" [selected] [ref=e61] [cursor=pointer]
              - tab "メディア" [ref=e63] [cursor=pointer]
              - tab "いいね" [ref=e65] [cursor=pointer]
              - tab "リアクション" [ref=e67] [cursor=pointer]
            - generic [ref=e69]:
              - article [ref=e73] [cursor=pointer]:
                - generic [ref=e74]:
                  - link "L" [ref=e75]:
                    - /url: /RaimuNoteSNS.github.io/u/lime
                  - generic [ref=e78]:
                    - generic [ref=e79]:
                      - generic [ref=e80]:
                        - link "Lime Note" [ref=e81]:
                          - /url: /RaimuNoteSNS.github.io/u/lime
                        - generic [ref=e84]: "@lime"
                        - generic [ref=e85]: ·
                        - generic [ref=e86]: 8日前
                      - button "ポストのメニュー" [ref=e89]
                    - paragraph [ref=e96]: 写真の投稿
                    - generic [ref=e101]:
                      - button [ref=e103]
                      - button "リポスト" [ref=e105]
                      - link "返信" [ref=e106]:
                        - /url: /RaimuNoteSNS.github.io/post/native
                      - button "リアクションを追加" [ref=e110]
                      - generic [ref=e112]:
                        - button "ブックマークに追加" [ref=e113]
                        - button "ポストを共有" [ref=e116]
              - article [ref=e123] [cursor=pointer]:
                - generic [ref=e124]:
                  - link "L" [ref=e125]:
                    - /url: /RaimuNoteSNS.github.io/u/lime
                  - generic [ref=e128]:
                    - generic [ref=e129]:
                      - generic [ref=e130]:
                        - link "Lime Note" [ref=e131]:
                          - /url: /RaimuNoteSNS.github.io/u/lime
                        - generic [ref=e134]: "@lime"
                        - generic [ref=e135]: ·
                        - generic [ref=e136]: 8日前
                      - generic [ref=e137]:
                        - generic [ref=e138]: 限定
                        - button "ポストのメニュー" [ref=e140]
                    - paragraph [ref=e147]:
                      - text: 二つのリンク
                      - link "https://preview.example/a" [ref=e148]:
                        - /url: https://preview.example/a
                      - link "https://preview.example/b" [ref=e149]:
                        - /url: https://preview.example/b
                    - generic [ref=e154]:
                      - button [ref=e156]
                      - button "リポスト" [ref=e158]
                      - link "返信" [ref=e159]:
                        - /url: /RaimuNoteSNS.github.io/post/private
                      - button "リアクションを追加" [ref=e163]
                      - generic [ref=e165]:
                        - button "ブックマークに追加" [ref=e166]
                        - button "ポストを共有" [ref=e169]
              - article [ref=e176] [cursor=pointer]:
                - generic [ref=e177]:
                  - link "L" [ref=e178]:
                    - /url: /RaimuNoteSNS.github.io/u/lime
                  - generic [ref=e181]:
                    - generic [ref=e182]:
                      - generic [ref=e183]:
                        - link "Lime Note" [ref=e184]:
                          - /url: /RaimuNoteSNS.github.io/u/lime
                        - generic [ref=e187]: "@lime"
                        - generic [ref=e188]: ·
                        - generic [ref=e189]: 8日前
                      - button "ポストのメニュー" [ref=e192]
                    - generic [ref=e197]:
                      - paragraph [ref=e199]:
                        - text: プレビューなし
                        - link "https://preview.example/none" [ref=e200]:
                          - /url: https://preview.example/none
                      - generic [ref=e201]: Bluesky
                    - generic [ref=e210]:
                      - button "いいね" [ref=e212]
                      - button "リポスト" [ref=e214]
                      - button [ref=e215]
                      - generic [ref=e218]:
                        - button "ブックマークに追加" [ref=e219]
                        - button "ポストを共有" [ref=e222]
              - article [ref=e229] [cursor=pointer]:
                - generic [ref=e230]:
                  - link "L" [ref=e232]:
                    - /url: /RaimuNoteSNS.github.io/u/lime
                  - generic [ref=e236]:
                    - generic [ref=e237]:
                      - link "Lime Note" [ref=e238]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e241]: "@lime"
                      - generic [ref=e242]: ·
                      - generic [ref=e243]: 8日前
                    - paragraph [ref=e244]: 写真の投稿
                    - generic [ref=e249]:
                      - button [ref=e251]
                      - button "リポスト" [ref=e253]
                      - button "返信を表示" [ref=e254]
                      - button "リアクションを追加" [ref=e258]
                      - generic [ref=e260]:
                        - button "ブックマークに追加" [ref=e261]
                        - button "共有" [ref=e265]
                - generic [ref=e269]:
                  - link "L" [ref=e271]:
                    - /url: /RaimuNoteSNS.github.io/u/lime
                  - generic [ref=e274]:
                    - generic [ref=e275]:
                      - generic [ref=e276]:
                        - link "Lime Note" [ref=e277]:
                          - /url: /RaimuNoteSNS.github.io/u/lime
                        - generic [ref=e280]: "@lime"
                        - generic [ref=e281]: ·
                        - generic [ref=e282]: 8日前
                      - button "コメントのメニュー" [ref=e283]
                    - paragraph [ref=e288]:
                      - text: 返信のリンク
                      - link "https://preview.example/reply" [ref=e289]:
                        - /url: https://preview.example/reply
                    - link "9月日記 | プレビュー確認" [ref=e290]:
                      - /url: https://preview.example/reply
                      - generic [ref=e291]:
                        - generic [ref=e292]: preview.example
                        - generic [ref=e293]: 9月日記 | プレビュー確認
                    - button "画像を拡大表示" [ref=e295]:
                      - img "投稿画像" [ref=e296]
                    - generic [ref=e297]:
                      - button [ref=e299]
                      - button "リポスト" [ref=e301]
                      - button "返信を表示" [ref=e302]
                      - button "リアクションを追加" [ref=e306]
                      - generic [ref=e308]:
                        - button "ブックマークに追加" [ref=e309]
                        - button "返信を共有" [ref=e312]
              - article [ref=e319] [cursor=pointer]:
                - generic [ref=e320]:
                  - link "L" [ref=e321]:
                    - /url: /RaimuNoteSNS.github.io/u/lime
                  - generic [ref=e324]:
                    - generic [ref=e325]:
                      - generic [ref=e326]:
                        - link "Lime Note" [ref=e327]:
                          - /url: /RaimuNoteSNS.github.io/u/lime
                        - generic [ref=e330]: "@lime"
                        - generic [ref=e331]: ·
                        - generic [ref=e332]: 7年前
                      - button "ポストのメニュー" [ref=e335]
                    - paragraph [ref=e342]: 古い固定対象
                    - generic [ref=e347]:
                      - button [ref=e349]
                      - button "リポスト" [ref=e351]
                      - link "返信" [ref=e352]:
                        - /url: /RaimuNoteSNS.github.io/post/old
                      - button "リアクションを追加" [ref=e356]
                      - generic [ref=e358]:
                        - button "ブックマークに追加" [ref=e359]
                        - button "ポストを共有" [ref=e362]
              - paragraph [ref=e367]: すべての表示が完了しました
  - button "新規投稿" [ref=e368] [cursor=pointer]
  - navigation [ref=e372]:
    - list [ref=e373]:
      - listitem [ref=e374]:
        - link [ref=e375]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=e380]:
        - link [ref=e381]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=e386]:
        - link [ref=e387]:
          - /url: /RaimuNoteSNS.github.io/u/lime
      - listitem [ref=e392]:
        - link [ref=e393]:
          - /url: /RaimuNoteSNS.github.io/notifications
      - listitem [ref=e398]:
        - link [ref=e399]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=e403]:
        - link [ref=e404]:
          - /url: /RaimuNoteSNS.github.io/settings
```

# Test source

```ts
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
  308 |  page.on('pageerror',error=>console.log('PROFILE PAGE ERROR',error.message));
  309 |  await setup(page,false);
  310 |  await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.setProperty('--safe-top','44px')));
  311 |  await page.goto('u/lime');
  312 |  const cover=page.locator('.profile-header-cover-avatar-gap'),header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
  313 |  await expect(cover).toBeVisible();await expect(header).toBeVisible();
  314 |  if(info.project.name==='WebKit-iPhone')expect((await cover.boundingBox())!.y).toBe(0);
  315 |  await expect(header.getByText('Lime Note',{exact:true})).toHaveCount(1);
  316 |  await page.screenshot({path:info.outputPath('profile-top.png')});
  317 |  await page.evaluate(()=>window.scrollTo(0,250));await expect(header).toHaveAttribute('data-lime-profile-scrolled','true');await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
  318 |  await page.screenshot({path:info.outputPath('profile-scrolled.png')});
  319 |  await page.evaluate(()=>window.scrollTo(0,0));
  320 |  const initial=(await cover.boundingBox())!.height;
> 321 |  await cover.evaluate(el=>{
      |              ^ Error: locator.evaluate: TypeError: Illegal constructor
  322 |   const touch=(y:number)=>new Touch({identifier:1,target:el,clientX:150,clientY:y});
  323 |   el.dispatchEvent(new TouchEvent('touchstart',{touches:[touch(100)],bubbles:true}));
  324 |   el.dispatchEvent(new TouchEvent('touchmove',{touches:[touch(260)],bubbles:true,cancelable:true}));
  325 |  });
  326 |  await expect(page.locator('[data-lime-profile-page]')).toHaveAttribute('data-lime-profile-pulling','true');
  327 |  expect((await cover.boundingBox())!.height).toBeGreaterThan(initial+60);
  328 |  await expect(page.locator('[data-lime-profile-pull-indicator]')).toHaveCSS('opacity','1');
  329 |  await page.screenshot({path:info.outputPath('profile-pull.png')});
  330 |  await cover.evaluate(el=>el.dispatchEvent(new TouchEvent('touchend',{touches:[],bubbles:true})));
  331 |  await expect(page.locator('[data-lime-profile-page]')).not.toHaveAttribute('data-lime-profile-pulling','true');
  332 |  await expect.poll(async()=>(await cover.boundingBox())!.height).toBe(initial);
  333 |  await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
  334 | });
  335 | 
```