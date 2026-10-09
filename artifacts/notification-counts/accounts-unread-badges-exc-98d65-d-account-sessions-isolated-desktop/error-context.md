# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accounts.spec.ts >> unread badges exclude viewed notifications and keep saved-account sessions isolated
- Location: tests/account-switching/accounts.spec.ts:162:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('a[href$="/notifications"]').visible().first().locator('[data-lime-unread-count="2"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('a[href$="/notifications"]').visible().first().locator('[data-lime-unread-count="2"]') with timeout 5000ms
  - waiting for locator('a[href$="/notifications"]').visible().first().locator('[data-lime-unread-count="2"]')

```

```yaml
- region "Notifications (F8)":
  - list
- region "Notifications alt+T"
- complementary:
  - link "Lime Note":
    - /url: /RaimuNoteSNS.github.io/
  - navigation:
    - button "ホーム":
      - img
      - text: ホーム
    - button "プロフィール":
      - img
      - text: プロフィール
    - button "検索":
      - img
      - text: 検索
    - button "通知":
      - img
      - text: 2 通知
    - button "LimeAI":
      - img
      - text: LimeAI
    - button "設定":
      - img
      - text: 設定
    - button "もっと見る":
      - img
      - text: もっと見る
    - button "ポストする"
  - 'button "ログイン中のアカウント: Alice（アカウント切り替え）"':
    - text: A Alice
    - img "Official"
    - text: "@alice"
- banner:
  - tablist:
    - tab "最新" [selected]
    - tab "フォロー中"
    - tab "おすすめ"
    - tab "トレンド"
- main:
  - link "↗︎ 公式サイト":
    - /url: https://toumeron.github.io/LimeNoteJP/
  - link "↗︎ お問い合わせ":
    - /url: https://forms.gle/1FUHzrWL38iVbUju5
  - heading "タイムライン" [level=1]
  - img
  - text: LimeNote 2.7.4
  - link "Aliceのプロフィールを開く":
    - /url: /RaimuNoteSNS.github.io/u/alice
    - text: A
  - text: いまどうしてる？
  - textbox
  - button "画像":
    - img
    - text: 画像
  - button "全員":
    - img
    - text: 全員
  - button "スタンプを選ぶ":
    - img
    - text: スタンプ
  - text: "500"
  - button "ポスト" [disabled]:
    - img
    - text: ポスト
  - article:
    - link "A":
      - /url: /RaimuNoteSNS.github.io/u/alice
    - link "Alice":
      - /url: /RaimuNoteSNS.github.io/u/alice
    - text: "@alice · 数秒前 限定"
    - button "ポストのメニュー":
      - img
    - paragraph: aliceのみの投稿
    - button:
      - img
    - button "リポスト"
    - link "返信":
      - /url: /RaimuNoteSNS.github.io/post/post-11111111-1111-1111-1111-111111111111
      - img
    - button "リアクションを追加":
      - img
    - button "ブックマークに追加":
      - img
    - button "ポストを共有":
      - img
  - paragraph: すべての投稿を読み込みました
- complementary "トレンド":
  - img
  - heading "トレンド" [level=2]
  - text: 現在、トレンドを取得できません
```

# Test source

```ts
  85  |   await page.getByRole('link',{name:'戻る',exact:true}).click();await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  86  |   await openAccounts(page);await press(page,page.getByRole('button',{name:'既存のアカウントを追加',exact:true}));
  87  |   await page.getByLabel('メールアドレス',{exact:true}).fill('clara@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill('fixture-password');await press(page,page.getByRole('button',{name:'ログインする',exact:true}));
  88  |   await expect(page.getByText('claraのみの投稿',{exact:true})).toBeVisible();
  89  |   const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),savedKey);expect(saved.map((row:any)=>row.username)).toEqual(['alice','bob','clara']);
  90  | });
  91  | test('expired saved sessions refresh and persist the rotated token',async({page},info)=>{
  92  |   await setup(page,info.project.name.includes('PWA'),{expired:true});await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  93  |   await openAccounts(page);await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  94  |   await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  95  |   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]').find((row:any)=>row.username==='bob')?.refreshToken,savedKey)).toBe('rotated-bob-refresh');
  96  |   await page.reload();await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  97  | });
  98  | test('invalid target sessions restore the original account',async({page},info)=>{
  99  |   await setup(page,info.project.name.includes('PWA'),{expired:true,revoked:true});await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  100 |   await openAccounts(page);await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));
  101 |   await expect(page.getByText('このアカウントは再ログインが必要です',{exact:true})).toBeVisible();
  102 |   await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  103 |   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
  104 | });
  105 | test('logs out only the active account and allows a saved account to sign in again',async({page},info)=>{
  106 |   await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  107 |   await openAccounts(page);await press(page,page.getByRole('button',{name:'@aliceからログアウト',exact:true}));
  108 |   await expect(page.getByRole('button',{name:'ログインする',exact:true})).toBeVisible();
  109 |   const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),savedKey);expect(saved.map((row:any)=>row.username)).toEqual(['bob']);
  110 |   await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}));await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  111 | });
  112 | test('mobile sheet editing removes only the selected inactive account',async({page},info)=>{
  113 |   test.skip((page.viewportSize()?.width??0)>=768,'Editing is provided only in the mobile sheet');
  114 |   await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  115 |   await openAccounts(page);await press(page,page.getByRole('button',{name:'編集',exact:true}));
  116 |   await press(page,page.getByRole('button',{name:'@bobをこの端末の保存から削除',exact:true}));
  117 |   await expect(page.getByRole('button',{name:'Bob @bobに切り替える',exact:true})).toHaveCount(0);
  118 |   await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true})).toContainText('@alice');
  119 |   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
  120 | });
  121 | test('account list remains scrollable with many accounts and preserves its actions',async({page},info)=>{
  122 |   await page.emulateMedia({colorScheme:'dark'});
  123 |   await setup(page,info.project.name.includes('PWA'));
  124 |   await page.addInitScript(key=>{
  125 |     localStorage.setItem('theme','dark');
  126 |     const accounts=JSON.parse(localStorage.getItem(key)??'[]');
  127 |     if(accounts.length>2)return;
  128 |     for(let i=1;i<=15;i++)accounts.push({id:`extra-${i}`,username:`account${i}`,displayName:`Account ${i}`,avatarUrl:'',accessToken:'fixture',refreshToken:'fixture'});
  129 |     localStorage.setItem(key,JSON.stringify(accounts));
  130 |   },savedKey);
  131 |   await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  132 |   await openAccounts(page);
  133 |   const list=page.locator('[data-lime-account-list]');
  134 |   if((page.viewportSize()?.width??0)<768)await expect.poll(()=>page.evaluate(()=>{
  135 |     const sheet=document.querySelector('[data-lime-mobile-account-sheet]')!;
  136 |     return sheet.contains(document.elementFromPoint(innerWidth-45,innerHeight-125));
  137 |   })).toBe(true);
  138 |   expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  139 |   await list.getByRole('button',{name:'Account 15 @account15に切り替える',exact:true}).scrollIntoViewIfNeeded();
  140 |   await expect(list.getByText('@account15',{exact:true})).toBeVisible();
  141 |   await expect(page.getByRole('button',{name:'既存のアカウントを追加',exact:true})).toBeVisible();
  142 |   await list.evaluate(el=>{el.scrollTop=0;});
  143 |   await expect(list.getByAltText('認証済み')).toBeVisible();
  144 |   await page.screenshot({path:info.outputPath('account-list-dark.png'),animations:'disabled'});
  145 | });
  146 | 
  147 | // Drawer gestures must not capture the nested avatar/name that receives a tap.
  148 | test('mobile account controls preserve touch targets for switching and adding',async({page},info)=>{
  149 |  test.skip((page.viewportSize()?.width??0)>=768,'Touch sheet controls');
  150 |  await setup(page,info.project.name.includes('PWA'));await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  151 |  await openAccounts(page);
  152 |  await page.evaluate(()=>{const original=Element.prototype.setPointerCapture;window.__accountCaptures=0;Element.prototype.setPointerCapture=function(id){if(this.closest('[data-lime-mobile-account-sheet]'))window.__accountCaptures++;return original.call(this,id);};});
  153 |  await press(page,page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}).getByText('Bob',{exact:true}));
  154 |  await expect(page.getByText('bobのみの投稿',{exact:true})).toBeVisible();
  155 |  expect(await page.evaluate(()=>window.__accountCaptures)).toBe(0);
  156 |  await openAccounts(page);await press(page,page.getByRole('button',{name:'既存のアカウントを追加',exact:true}).locator('svg'));
  157 |  await expect(page.getByRole('heading',{name:'アカウントを追加',exact:true})).toBeVisible();
  158 |  expect(await page.evaluate(()=>window.__accountCaptures)).toBe(0);
  159 |  await page.getByLabel('メールアドレス',{exact:true}).tap();await expect(page.getByLabel('メールアドレス',{exact:true})).toBeFocused();
  160 | });
  161 | 
  162 | test('unread badges exclude viewed notifications and keep saved-account sessions isolated',async({page},info)=>{
  163 |  await setup(page,info.project.name.includes('PWA'));
  164 |  const rows=Array.from({length:4},(_,index)=>({id:`notification-${index}`,user_id:index===3?ids[1]:ids[0],actor_id:ids[1],post_id:null,type:'follow',actor_name:'Bob',actor_username:'bob',actor_avatar_url:'',content_preview:null,is_read:index===2,created_at:new Date().toISOString()}));
  165 |  const identities:string[]=[];
  166 |  await page.route('**/*.supabase.co/rest/v1/notifications*',async route=>{
  167 |   const req=route.request(),url=new URL(req.url());
  168 |   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,HEAD,PATCH,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
  169 |   const userId=url.searchParams.get('user_id')?.replace(/^eq\./,'');
  170 |   const jwt=req.headers().authorization?.replace(/^Bearer /,'')??'';
  171 |   const identity=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString()).sub;
  172 |   identities.push(identity);expect(identity).toBe(userId);
  173 |   if(req.method()==='PATCH'){
  174 |    const filter=url.searchParams.get('id')??'';
  175 |    rows.filter(row=>row.user_id===userId&&filter.includes(row.id)).forEach(row=>{row.is_read=true;});
  176 |    return route.fulfill({status:204,body:''});
  177 |   }
  178 |   const result=rows.filter(row=>row.user_id===userId&&(url.searchParams.get('is_read')!=='eq.false'||!row.is_read));
  179 |   return route.fulfill({contentType:'application/json',headers:{'content-range':`0-0/${result.length}`,'access-control-expose-headers':'content-range'},body:req.method()==='HEAD'?'':JSON.stringify(result)});
  180 |  });
  181 |  await page.goto('./');await expect(page.getByText('aliceのみの投稿',{exact:true})).toBeVisible();
  182 |  const nav=(page.viewportSize()?.width??0)>=768?page.locator('[data-lime-desktop-sidebar]'):page.locator('[data-lime-bottom-nav-root]');
  183 |  // Use the visible notification link so compact sidebar and mobile labels both work.
  184 |  const notification=page.locator('a[href$="/notifications"]').filter({visible:true}).first();
> 185 |  await expect(notification.locator('[data-lime-unread-count="2"]')).toBeVisible();
      |                                                                     ^ Error: expect(locator).toBeVisible() failed
  186 |  await openAccounts(page);
  187 |  await expect(page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}).locator('[data-lime-unread-count="1"]')).toBeVisible();
  188 |  await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true}).locator('[data-lime-unread-count="2"]')).toBeVisible();
  189 |  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{}').user?.id,authKey)).toBe(ids[0]);
  190 |  expect(identities).toContain(ids[1]);
  191 |  await page.screenshot({path:info.outputPath('unread-account-counts.png')});
  192 |  await page.goto('notifications');
  193 |  await expect.poll(()=>rows.filter(row=>row.user_id===ids[0]&&!row.is_read).length).toBe(0);
  194 |  await expect(page.locator('a[href$="/notifications"]').filter({visible:true}).first().locator('[data-lime-unread-count]')).toHaveCount(0);
  195 |  await page.screenshot({path:info.outputPath('notifications-read.png')});
  196 |  await openAccounts(page);
  197 |  await expect(page.getByRole('button',{name:'Bob @bobに切り替える',exact:true}).locator('[data-lime-unread-count="1"]')).toBeVisible();
  198 |  await expect(page.locator('[data-lime-account-list]').getByRole('button',{pressed:true}).locator('[data-lime-unread-count]')).toHaveCount(0);
  199 | });
  200 | 
```