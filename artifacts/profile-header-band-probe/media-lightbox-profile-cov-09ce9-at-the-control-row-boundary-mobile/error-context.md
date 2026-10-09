# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media-lightbox.spec.ts >> profile cover has no horizontal band at the control row boundary
- Location: tests/media-lightbox/media-lightbox.spec.ts:381:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 4
+ Received  + 4

  Array [
-   true,
-   true,
-   true,
-   true,
+   false,
+   false,
+   false,
+   false,
    true,
  ]
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
            - link "2026年10月 から参加" [ref=e24] [cursor=pointer]:
              - /url: /RaimuNoteSNS.github.io/u/lime/about
            - generic [ref=e28]:
              - link "0 フォロー中" [ref=e29] [cursor=pointer]:
                - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=following
                - generic [ref=e30]: "0"
                - generic [ref=e31]: フォロー中
              - link "0 フォロワー" [ref=e32] [cursor=pointer]:
                - /url: /RaimuNoteSNS.github.io/u/lime/followers_following?tab=followers
                - generic [ref=e33]: "0"
                - generic [ref=e34]: フォロワー
              - generic [ref=e35]:
                - generic [ref=e36]: "3"
                - generic [ref=e37]: 投稿
        - generic [ref=e38]:
          - tablist [ref=e40]:
            - tab "ポスト" [selected] [ref=e41] [cursor=pointer]
            - tab "メディア" [ref=e43] [cursor=pointer]
            - tab "いいね" [ref=e45] [cursor=pointer]
            - tab "リアクション" [ref=e47] [cursor=pointer]
          - generic [ref=e49]:
            - article [ref=e53] [cursor=pointer]:
              - generic [ref=e54]:
                - link "L" [ref=e55]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e58]:
                  - generic [ref=e59]:
                    - generic [ref=e60]:
                      - link "Lime Note" [ref=e61]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e64]: "@lime"
                      - generic [ref=e65]: ·
                      - generic [ref=e66]: 9日前
                    - button "ポストのメニュー" [ref=e69]
                  - paragraph [ref=e76]: 写真の投稿
                  - generic [ref=e81]:
                    - button [ref=e83]
                    - button "リポスト" [ref=e85]
                    - link "返信" [ref=e86]:
                      - /url: /RaimuNoteSNS.github.io/post/native
                    - button "リアクションを追加" [ref=e90]
                    - generic [ref=e92]:
                      - button "ブックマークに追加" [ref=e93]
                      - button "ポストを共有" [ref=e96]
            - article [ref=e103] [cursor=pointer]:
              - generic [ref=e104]:
                - link "L" [ref=e105]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e108]:
                  - generic [ref=e109]:
                    - generic [ref=e110]:
                      - link "Lime Note" [ref=e111]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e114]: "@lime"
                      - generic [ref=e115]: ·
                      - generic [ref=e116]: 9日前
                    - generic [ref=e117]:
                      - generic [ref=e118]: 限定
                      - button "ポストのメニュー" [ref=e120]
                  - paragraph [ref=e127]:
                    - text: 二つのリンク
                    - link "https://preview.example/a" [ref=e128]:
                      - /url: https://preview.example/a
                    - link "https://preview.example/b" [ref=e129]:
                      - /url: https://preview.example/b
                  - generic [ref=e134]:
                    - button [ref=e136]
                    - button "リポスト" [ref=e138]
                    - link "返信" [ref=e139]:
                      - /url: /RaimuNoteSNS.github.io/post/private
                    - button "リアクションを追加" [ref=e143]
                    - generic [ref=e145]:
                      - button "ブックマークに追加" [ref=e146]
                      - button "ポストを共有" [ref=e149]
            - article [ref=e156] [cursor=pointer]:
              - generic [ref=e157]:
                - link "L" [ref=e158]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e161]:
                  - generic [ref=e162]:
                    - generic [ref=e163]:
                      - link "Lime Note" [ref=e164]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e167]: "@lime"
                      - generic [ref=e168]: ·
                      - generic [ref=e169]: 9日前
                    - button "ポストのメニュー" [ref=e172]
                  - generic [ref=e177]:
                    - paragraph [ref=e179]:
                      - text: プレビューなし
                      - link "https://preview.example/none" [ref=e180]:
                        - /url: https://preview.example/none
                    - generic [ref=e181]: Bluesky
                  - generic [ref=e190]:
                    - button "いいね" [ref=e192]
                    - button "リポスト" [ref=e194]
                    - button [ref=e195]
                    - generic [ref=e198]:
                      - button "ブックマークに追加" [ref=e199]
                      - button "ポストを共有" [ref=e202]
            - article [ref=e209] [cursor=pointer]:
              - generic [ref=e210]:
                - link "L" [ref=e212]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e216]:
                  - generic [ref=e217]:
                    - link "Lime Note" [ref=e218]:
                      - /url: /RaimuNoteSNS.github.io/u/lime
                    - generic [ref=e221]: "@lime"
                    - generic [ref=e222]: ·
                    - generic [ref=e223]: 9日前
                  - paragraph [ref=e224]: 写真の投稿
                  - generic [ref=e229]:
                    - button [ref=e231]
                    - button "リポスト" [ref=e233]
                    - button "返信を表示" [ref=e234]
                    - button "リアクションを追加" [ref=e238]
                    - generic [ref=e240]:
                      - button "ブックマークに追加" [ref=e241]
                      - button "共有" [ref=e245]
              - generic [ref=e249]:
                - link "L" [ref=e251]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e254]:
                  - generic [ref=e255]:
                    - generic [ref=e256]:
                      - link "Lime Note" [ref=e257]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e260]: "@lime"
                      - generic [ref=e261]: ·
                      - generic [ref=e262]: 9日前
                    - button "コメントのメニュー" [ref=e263]
                  - paragraph [ref=e268]:
                    - text: 返信のリンク
                    - link "https://preview.example/reply" [ref=e269]:
                      - /url: https://preview.example/reply
                  - link "9月日記 | プレビュー確認" [ref=e270]:
                    - /url: https://preview.example/reply
                    - generic [ref=e271]:
                      - generic [ref=e272]: preview.example
                      - generic [ref=e273]: 9月日記 | プレビュー確認
                  - button "画像を拡大表示" [ref=e275]:
                    - img "投稿画像" [ref=e276]
                  - generic [ref=e277]:
                    - button [ref=e279]
                    - button "リポスト" [ref=e281]
                    - button "返信を表示" [ref=e282]
                    - button "リアクションを追加" [ref=e286]
                    - generic [ref=e288]:
                      - button "ブックマークに追加" [ref=e289]
                      - button "返信を共有" [ref=e292]
            - article [ref=e299] [cursor=pointer]:
              - generic [ref=e300]:
                - link "L" [ref=e301]:
                  - /url: /RaimuNoteSNS.github.io/u/lime
                - generic [ref=e304]:
                  - generic [ref=e305]:
                    - generic [ref=e306]:
                      - link "Lime Note" [ref=e307]:
                        - /url: /RaimuNoteSNS.github.io/u/lime
                      - generic [ref=e310]: "@lime"
                      - generic [ref=e311]: ·
                      - generic [ref=e312]: 7年前
                    - button "ポストのメニュー" [ref=e315]
                  - paragraph [ref=e322]: 古い固定対象
                  - generic [ref=e327]:
                    - button [ref=e329]
                    - button "リポスト" [ref=e331]
                    - link "返信" [ref=e332]:
                      - /url: /RaimuNoteSNS.github.io/post/old
                    - button "リアクションを追加" [ref=e336]
                    - generic [ref=e338]:
                      - button "ブックマークに追加" [ref=e339]
                      - button "ポストを共有" [ref=e342]
            - paragraph [ref=e347]: すべての表示が完了しました
  - banner:
    - generic [ref=e348]:
      - button "戻る" [ref=e349] [cursor=pointer]
      - generic [ref=e352]:
        - generic [ref=e353]: Lime Note
        - generic [ref=e354]: 3件のポスト
      - link "プロフィールを検索" [ref=e355] [cursor=pointer]:
        - /url: /RaimuNoteSNS.github.io/search?q=%40lime
      - button "プロフィールのその他のメニュー" [ref=e359] [cursor=pointer]
  - button "新規投稿" [ref=e364] [cursor=pointer]
  - navigation [ref=e368]:
    - list [ref=e369]:
      - listitem [ref=e370]:
        - link [ref=e371] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/
      - listitem [ref=e376]:
        - link [ref=e377] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/search
      - listitem [ref=e382]:
        - link [ref=e383] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/u/lime
      - listitem [ref=e388]:
        - link [ref=e389] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/notifications
      - listitem [ref=e394]:
        - link [ref=e395] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/chat
      - listitem [ref=e399]:
        - link [ref=e400] [cursor=pointer]:
          - /url: /RaimuNoteSNS.github.io/settings
```

# Test source

```ts
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
  393 |  console.log(await page.evaluate(y=>[100,200,300,400,500].map(x=>{const el=document.elementFromPoint(x,y);return {tag:el?.tagName,cls:el?.className};}),row!.y+row!.height+1));
> 394 |  expect(points).toEqual([true,true,true,true,true]);
      |                 ^ Error: expect(received).toEqual(expected) // deep equality
  395 | });
  396 | 
```