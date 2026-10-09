# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media-lightbox.spec.ts >> reply dock expands when idle and retains its input through keyboard viewport changes
- Location: tests/media-lightbox/media-lightbox.spec.ts:198:1

# Error details

```
TypeError: Cannot read properties of null (reading 'width')
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - region "Notifications (F8)":
      - list
    - region "Notifications alt+T"
    - main [ref=e6]:
      - generic [ref=e8]:
        - button "戻る" [ref=e9] [cursor=pointer]
        - generic: ポスト
        - button "その他のメニュー" [ref=e12] [cursor=pointer]
  - navigation [ref=e33]:
    - generic [ref=e36]:
      - link "自分のプロフィールを開く" [ref=e37]:
        - /url: /RaimuNoteSNS.github.io/u/lime
        - generic [ref=e38]: L
      - textbox "返信をポスト" [ref=e42]
      - button "コメントを送信" [disabled]
    - list [ref=e43]:
      - listitem [ref=e44]:
        - link [ref=e45]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=e50]:
        - link [ref=e51]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=e56]:
        - link [ref=e57]:
          - /url: /RaimuNoteSNS.github.io/u/lime
      - listitem [ref=e62]:
        - link [ref=e63]:
          - /url: /RaimuNoteSNS.github.io/notifications
      - listitem [ref=e68]:
        - link [ref=e69]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=e73]:
        - link [ref=e74]:
          - /url: /RaimuNoteSNS.github.io/settings
```

# Test source

```ts
  102 |  expect(await stage.evaluate(el=>!el.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:1000,clientX:20,clientY:20,bubbles:true,cancelable:true})))).toBe(true);
  103 |  await expect(image).toHaveCSS('transform',/matrix\(1, 0, 0, 1, 0, 0\)/);
  104 |  expect(await stage.evaluate(el=>!el.dispatchEvent(new Event('gesturestart',{bubbles:true,cancelable:true})))).toBe(true);
  105 |  await stage.dispatchEvent('pointerdown',{pointerId:12,pointerType:'touch',clientX:rect.x+5,clientY:rect.y+5});
  106 |  await stage.dispatchEvent('pointerup',{pointerId:12,pointerType:'touch',clientX:rect.x+5,clientY:rect.y+5});
  107 |  await expect(viewer).toHaveCount(0);
  108 |  expect(await page.evaluate(()=>window.visualViewport?.scale)).toBe(1);
  109 | });
  110 | 
  111 |  test('quote from the viewer opens the actual composer without trapping it behind the image',async({page})=>{
  112 |  await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
  113 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await press(page,viewer.locator('.lime-media-bottom [data-lime-post-action=repost]'));await press(page,page.getByRole('menuitem',{name:'引用リポスト',exact:true}));
  114 |  await expect(viewer).toHaveCount(0);const composer=page.getByRole('dialog',{name:'引用リポスト',exact:true});await expect(composer).toBeVisible();await expect(composer.getByText('写真の投稿',{exact:true})).toBeVisible();await expect(composer.locator('textarea')).toBeEditable();
  115 |  });
  116 | 
  117 | test('reference reply layout keeps the mobile launcher plain and opens a multiline reply screen',async({page},info)=>{
  118 |  const state=await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
  119 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
  120 |  if((page.viewportSize()?.width??0)<768){
  121 |   await expect(viewer.locator('.lime-media-mobile-reply .reply-submit')).toHaveCount(0);
  122 |   await expect(viewer.getByRole('button',{name:'返信を入力'})).toBeVisible();
  123 |   await press(page,viewer.getByRole('button',{name:'返信を入力'}));
  124 |   const reply=page.getByRole('dialog',{name:'返信を作成',exact:true});await expect(reply).toBeVisible();
  125 |   const input=reply.getByPlaceholder('返信をポスト');await expect(input).toHaveJSProperty('tagName','TEXTAREA');await expect(input).toBeFocused();
  126 |   await expect(reply.locator('.lime-media-reply-source')).toContainText('写真の投稿');
  127 |   await input.fill('1行目\n2行目');await page.screenshot({path:info.outputPath('reply-editing.png'),animations:'disabled'});
  128 |   await press(page,reply.getByRole('button',{name:'返信入力を閉じる'}));await expect(reply).toHaveCount(0);await expect(viewer).toBeVisible();
  129 |   await press(page,viewer.getByRole('button',{name:'返信を入力'}));await expect(input).toHaveValue('1行目\n2行目');
  130 |   await press(page,reply.getByRole('button',{name:'コメントを送信',exact:true}));await expect.poll(()=>state.writes.some(write=>write.table==='comments'&&write.body?.content==='1行目\n2行目')).toBe(true);await expect(reply).toHaveCount(0);await expect(viewer).toBeVisible();
  131 |  }else{
  132 |   const composer=viewer.locator('[data-variant=mediaViewer]');const input=composer.getByPlaceholder('返信をポスト'),submit=composer.getByRole('button',{name:'コメントを送信'});await expect(submit).toHaveText('返信');
  133 |   const buttonBefore=await submit.boundingBox();await input.fill('1行目\n2行目');await expect(composer.getByRole('button',{name:'返信に画像を添付'})).toBeVisible();
  134 |   const buttonAfter=await submit.boundingBox();expect(buttonAfter!.x).toBeCloseTo(buttonBefore!.x,1);expect(buttonAfter!.y).toBeCloseTo(buttonBefore!.y,1);
  135 |   await page.screenshot({path:info.outputPath('reply-editing.png'),animations:'disabled'});await composer.screenshot({path:info.outputPath('desktop-reply.png'),animations:'disabled'});
  136 |   await press(page,submit);await expect.poll(()=>state.writes.some(write=>write.table==='comments'&&write.body?.content==='1行目\n2行目')).toBe(true);
  137 |  }
  138 | });
  139 | 
  140 | test('image swipe animates the adjacent image before changing its selected dot',async({page})=>{
  141 |  await setup(page,false);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
  142 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'}),stage=viewer.locator('.lime-media-stage');
  143 |  await viewer.locator('.lime-media-adjacent').evaluate(el=>{(window as any).__nextMediaImage=el;});
  144 |  const rect=(await stage.boundingBox())!,cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
  145 |  await stage.dispatchEvent('pointerdown',{pointerId:31,pointerType:'touch',clientX:cx+50,clientY:cy});await stage.dispatchEvent('pointermove',{pointerId:31,pointerType:'touch',clientX:cx-70,clientY:cy});
  146 |  await expect(viewer.locator('.lime-media-image-track')).toHaveCSS('transform',/matrix\(1, 0, 0, 1, -120, 0\)/);
  147 |  await expect(viewer.locator('.lime-media-adjacent')).toHaveAttribute('src','https://media.example/two.svg');
  148 |  await stage.dispatchEvent('pointerup',{pointerId:31,pointerType:'touch',clientX:cx-70,clientY:cy});
  149 |  await expect.poll(()=>viewer.locator('.lime-media-image-track').evaluate(el=>el.getAnimations().length)).toBeGreaterThan(0);
  150 |  await expect(viewer.getByAltText('拡大画像 2')).toBeVisible();await expect(viewer.getByRole('button',{name:'画像 2',exact:true})).toHaveAttribute('aria-current','true');
  151 |  expect(await viewer.getByAltText('拡大画像 2').evaluate(el=>el===(window as any).__nextMediaImage)).toBe(true);
  152 |  await expect(viewer.locator('.lime-media-image-track')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  153 | });
  154 | 
  155 |  test('image three-dot menu preserves navigation and a transparent mobile backdrop',async({page})=>{
  156 |  await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
  157 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
  158 |  await press(page,viewer.getByRole('button',{name:'ポストのメニュー'}).filter({visible:true}));
  159 |  await expect(page.locator('[data-lime-media-sheet=menu]')).toBeVisible();
  160 |  if((page.viewportSize()?.width??0)<640)await expect(page.locator('.lime-post-options-backdrop')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  161 |  await press(page,page.getByRole('button',{name:'ポストに移動',exact:true}));
  162 |  await expect(page).toHaveURL(/post\/native$/);await expect(viewer).toHaveCount(0);
  163 |  });
  164 | 
  165 | 
  166 | test('viewer keeps follow labels intact on mobile and uses full-width themed desktop rules',async({page},info)=>{
  167 |  await setup(page,false);
  168 |  await page.addInitScript(()=>localStorage.setItem('theme','light'));
  169 |  await page.route('**/rest/v1/follows?**',route=>route.fulfill({contentType:'application/json',body:route.request().method()==='HEAD'?'':JSON.stringify({follower_id:'11111111-1111-1111-1111-111111111111'})}));
  170 |  await page.route('https://media.example/portrait.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><rect width="400" height="900" fill="#e8bfd3"/></svg>'}));
  171 |  await page.goto('./');await expect(page.locator('[data-lime-post-card]').first()).toBeVisible();
  172 |  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('lime-open-media-viewer',{detail:{url:'https://media.example/portrait.svg',post:{id:'other-photo',userId:'22222222-2222-2222-2222-222222222222',author:{id:'22222222-2222-2222-2222-222222222222',username:'other',displayName:'最強マンDXねこちゃんと長い名前',avatarUrl:'',isOfficial:true},content:'写真の投稿',createdAt:'2026-10-01T00:00:00Z',likesCount:2,imageUrls:['https://media.example/portrait.svg'],visibility:'public'}}})));
  173 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await expect(viewer.getByAltText('拡大画像 1')).toBeVisible();
  174 |  await expect(viewer.locator('.lime-media-download,.lime-media-stats')).toHaveCount(0);
  175 |  if(page.viewportSize()!.width<768){
  176 |   const follow=viewer.locator('.lime-media-mobile-summary .lime-media-follow button');await expect(follow).toHaveAttribute('aria-busy','false');
  177 |   expect((await follow.boundingBox())!.width).toBeGreaterThan(65);expect((await follow.boundingBox())!.height).toBe(32);
  178 |   await expect(follow).toContainText('フォロー中');
  179 |   await expect(viewer.locator('.lime-media-reply-launcher')).toHaveCSS('backdrop-filter','blur(18px)');
  180 |   const like=viewer.locator('.lime-media-bottom [data-lime-post-action=like]');expect(await like.evaluate(el=>getComputedStyle(el).backdropFilter==='blur(18px)'||getComputedStyle(el.parentElement!).backdropFilter==='blur(18px)')).toBe(true);
  181 |  }else{
  182 |   await expect(viewer.locator('.lime-media-follow').filter({visible:true})).toHaveCount(0);
  183 |   await expect(viewer.locator('.lime-media-detail')).toHaveCSS('background-color','rgb(255, 255, 255)');
  184 |   await expect(viewer.locator('.lime-media-detail .lime-media-display-name')).toHaveCSS('white-space','nowrap');
  185 |   const panel=(await viewer.locator('.lime-media-detail').boundingBox())!, actions=(await viewer.locator('.lime-media-detail>.lime-media-actions').boundingBox())!;
  186 |   expect(actions.x-panel.x).toBeCloseTo(1,0);expect(actions.width).toBeCloseTo(panel.width-1,0);
  187 |   const comment=(await viewer.locator('[data-lime-comment-card]').first().boundingBox())!;expect(comment.width).toBeCloseTo(panel.width-1,0);
  188 |   await page.evaluate(()=>document.documentElement.classList.add('dark'));await expect(viewer.locator('.lime-media-detail')).toHaveCSS('background-color','rgb(0, 0, 0)');
  189 |   await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  190 |  }
  191 |  await page.screenshot({path:info.outputPath('targeted-viewer.png'),animations:'disabled'});
  192 |  if(page.viewportSize()!.width<768){await viewer.locator('.lime-media-stage').dblclick();await expect(viewer).toHaveClass(/lime-media-zoomed/);await page.screenshot({path:info.outputPath('zoomed-viewer.png'),animations:'disabled'});await viewer.locator('.lime-media-stage').dblclick();}
  193 |  const stage=viewer.locator('.lime-media-stage'), rect=(await stage.boundingBox())!;
  194 |  await expect.poll(()=>viewer.getByAltText('拡大画像 1').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(400);
  195 |  await page.mouse.click(rect.x+5,rect.y+rect.height/2);await expect(viewer).toHaveCount(0);
  196 | });
  197 | 
  198 | test('reply dock expands when idle and retains its input through keyboard viewport changes',async({page})=>{
  199 |  test.skip((page.viewportSize()?.width??0)>=640,'Mobile reply dock');
  200 |  await setup(page,false);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('post/native');
  201 |  const composer=page.locator('[data-variant=bottomNav]'),input=composer.getByPlaceholder('返信をポスト');await expect(input).toBeVisible();
> 202 |  const idleWidth=(await input.boundingBox())!.width;
      |                                               ^ TypeError: Cannot read properties of null (reading 'width')
  203 |  expect(await composer.evaluate(el=>getComputedStyle(el).transitionProperty)).toContain('grid-template-columns');
  204 |  await input.evaluate(el=>{(window as any).__replyInput=el;});await input.focus();await input.fill('入力を維持');
  205 |  await expect.poll(async()=> (await input.boundingBox())!.width).toBeLessThan(idleWidth-60);
  206 |  const sizes=await composer.locator('[data-lime-attachment-tool] svg').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
  207 |  expect(sizes.length).toBe(2);for(const size of sizes)expect(size).toEqual({width:20,height:20});
  208 |  await page.evaluate(()=>{const viewport=window.visualViewport!;Object.defineProperty(viewport,'height',{configurable:true,value:window.innerHeight-280});viewport.dispatchEvent(new Event('resize'));});
  209 |  await expect(input).toBeFocused();await expect(input).toHaveValue('入力を維持');expect(await input.evaluate(el=>el===(window as any).__replyInput)).toBe(true);
  210 |  await expect.poll(()=>composer.evaluate(el=>getComputedStyle(el.closest('nav')!).bottom)).toBe('280px');
  211 |  await input.evaluate(el=>(el as HTMLTextAreaElement).blur());await expect.poll(async()=> (await input.boundingBox())!.width).toBeGreaterThan(idleWidth-2);
  212 | });
  213 | 
  214 | test('short touch swipes do not switch images and reply source shares the post card and avatar line',async({page})=>{
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
  297 |  await press(page,sheet.getByRole('button',{name:'リポストの操作を閉じる',exact:true}));await expect(sheet).toHaveCount(0);
  298 |  await press(page,trigger);await expect(sheet).toBeVisible();
  299 |  await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);
  300 |  await press(page,post.locator('[data-lime-post-body] img').first());
  301 |  const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
  302 |  await press(page,viewer.locator('.lime-media-bottom [data-lime-post-action="repost"]'));await expect(sheet).toBeVisible();
```