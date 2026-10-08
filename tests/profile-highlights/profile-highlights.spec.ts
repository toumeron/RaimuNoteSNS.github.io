import { test, expect, type Page, type Locator } from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const profile={id:user.id,username:user.username,display_name:user.displayName,avatar_url:'',created_at:user.createdAt};
const base={userId:user.id,createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:user};
const posts=[{...base,id:'native',content:'9月の日記を更新しました https://preview.example/diary'},{...base,id:'private',visibility:'following',content:'二つのリンク https://preview.example/a https://preview.example/b'},{...base,id:'bsky:at://did:plc:test/app.bsky.feed.post/demo',source:'bluesky',content:'プレビューなし https://preview.example/none'}];
posts.push({...base,id:'old',content:'古い固定対象',createdAt:'2020-01-01T00:00:00Z'});
const reply={...base,id:'reply:child',replyId:'child',replyPostId:'native',replyToUsername:'lime',content:'返信のリンク https://preview.example/reply'};
async function press(page:Page,locator:Locator){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click();}
async function setup(page:Page,standalone:boolean){
  const state={rows:[] as Record<string,string>[],extraPosts:[] as (typeof posts)[number][],denyPrivate:false,failWrite:false,pin:null as string|null, highlights:[] as string[]};
  if(standalone)await page.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{get:()=>true});});
  await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(user)},loading:false,session:null,logout:async()=>{},accounts:[${JSON.stringify({...user,needsLogin:false})},{id:'other',username:'other',displayName:'Other',avatarUrl:'',needsLogin:false}],switching:false,switchAccount:async()=>{},forgetAccount:()=>{}});export const AuthProvider=({children})=>children;`}));
  await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${user.id}';`}));
  await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const posts=${JSON.stringify(posts)};
    export const getFeed=async()=>posts,getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;
    export const getHighlightedPosts=async (_user,page=0,limit=10)=>(await fetch('/__highlights-fixture?offset='+page*limit+'&limit='+limit)).json();export const getPostById=async id=>(await fetch('/__bookmark-fixture/post/'+encodeURIComponent(id))).json();export const createPost=async()=>posts[0],toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[];`}));
  await page.route('**/__bookmark-fixture/post/**',route=>{const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/post/')[1]);const post=id===reply.id?reply:[...posts,...state.extraPosts].find(post=>post.id===id);return route.fulfill({contentType:'application/json',body:JSON.stringify(id==='private'&&state.denyPrivate?null:post??null)});});
  await page.route('**/*.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS,HEAD','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
    if(url.pathname.endsWith('/profile_highlights')){
      if(req.method()==='POST'){
        if(state.failWrite)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"write failed"}'});
        const id=req.postDataJSON().post_id;if(!state.highlights.includes(id))state.highlights.unshift(id);
        return route.fulfill({status:201,body:''});
      }
      const id=url.searchParams.get('post_id')?.slice(3);
      if(req.method()==='DELETE'){state.highlights=state.highlights.filter(postId=>postId!==id);return route.fulfill({status:204,body:''});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(state.highlights.includes(id??'')?{post_id:id}:null)});
    }
    if(url.pathname.endsWith('/profile_pins')){
      if(req.method()==='POST'){state.pin=JSON.parse(req.postData()!).post_id;return route.fulfill({status:201,body:''});}
      if(req.method()==='DELETE'){state.pin=null;return route.fulfill({status:204,body:''});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(state.pin?{post_id:state.pin}:null)});
    }
    if(url.pathname.endsWith('/functions/v1/link-preview')){
      const target=JSON.parse(req.postData()??'{}').url;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({preview:target.endsWith('/none')?null:{url:target,domain:'preview.example',title:'9月日記 | プレビュー確認',image:'https://preview.example/cover.svg'}})});
    }
    if(url.pathname.endsWith('/bookmarks')){
      if(req.method()==='POST'){
        if(state.failWrite)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"fixture write failed"}'});
        state.rows.push({...req.postDataJSON(),id:`bookmark-${state.rows.length}`,created_at:new Date().toISOString()});return route.fulfill({status:201,body:''});
      }
      const filters=[...url.searchParams.entries()].filter(([key,value])=>['user_id','post_id','comment_id','external_id'].includes(key)&&value.startsWith('eq.'));
      const matches=(row:Record<string,string>)=>filters.every(([key,value])=>row[key]===value.slice(3));
      if(req.method()==='DELETE'){state.rows=state.rows.filter(row=>!matches(row));return route.fulfill({status:204,body:''});}
      const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(state.rows.filter(matches).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(offset,offset+limit))});
    }
    const single=(req.headers().accept??'').includes('vnd.pgrst.object');let data:unknown=single?null:[];
    if(url.pathname.endsWith('/profiles')) {
      if (req.method()==='PATCH') state.pin=req.postDataJSON().pinned_post_id;
      const row={...profile,pinned_post_id:state.pin};
      data=single?row:[row];
    }
    if(url.pathname.endsWith('/comments')){
      const parent=url.searchParams.get('parent_comment_id');
      data=parent?.startsWith('eq.')?[]:[{id:'child',post_id:'native',parent_comment_id:null,user_id:user.id,content:reply.content,created_at:user.createdAt,image_urls:[],likes_count:0,profiles:profile}];
    }
    if(url.pathname.includes('get_profile_activity_count'))data=3;
    if(url.pathname.includes('get-trends'))data=[];
    return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:req.method()==='HEAD'?'':JSON.stringify(data)});
  });
  await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'}));
  await page.route('**/__highlights-fixture?*',route=>{
    const url=new URL(route.request().url()),offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
    return route.fulfill({contentType:'application/json',body:JSON.stringify(state.highlights.map(id=>posts.find(post=>post.id===id)).filter(Boolean).slice(offset,offset+limit))});
  });
  return state;
}

test('failed addition leaves the highlights tab hidden',async({page})=>{
  const state=await setup(page,false);state.failWrite=true;
  await page.goto('u/lime');
  const card=page.locator('[data-lime-post-card]').first();
  await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
  await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  await expect(page.getByText('ハイライトを変更できませんでした')).toBeVisible();
  expect(state.highlights).toEqual([]);
  await expect(page.getByRole('tab',{name:'ハイライト',exact:true})).toHaveCount(0);
});

test('post detail offers highlighting for an own post',async({page})=>{
  const state=await setup(page,false);await page.goto('post/native');
  await press(page,page.getByRole('button',{name:'その他のメニュー'}).filter({visible:true}));
  await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  await expect.poll(()=>state.highlights).toEqual(['native']);
});

test('highlight tabs stay in one row above pinned posts at every width',async({page},info)=>{
  const state=await setup(page,false);state.highlights=['native'];state.pin='old';
  await page.goto('u/lime');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  const widths=info.project.use.isMobile ? [320,390] : [1440,1000,640,320];
  for(const width of widths){
    await page.setViewportSize({width,height:900});
    const tabs=page.getByRole('tablist').filter({visible:true});
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveCount(5);
    await expect(tabs.getByRole('tab',{name:'ハイライト',exact:true})).toBeVisible();
    await expect(page.locator('[data-lime-pinned-label]')).toBeVisible();
    const layout=await tabs.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return {display:getComputedStyle(el).display,top:box.top,bottom:box.bottom,
        tabs:[...el.querySelectorAll('[role=tab]')].map(tab=>{const rect=tab.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom};})};
    });
    await page.screenshot({path:info.outputPath(`highlight-tabs-${width}.png`),animations:'disabled'});
    expect(['flex','grid']).toContain(layout.display);
    // The existing 640px desktop-style tabs have inner padding; compare
    // tab positions with each other while checking container boundaries.
    expect(layout.tabs.every(tab=>Math.abs(tab.top-layout.tabs[0].top)<1&&tab.top>=layout.top-1&&tab.bottom<=layout.bottom+1)).toBe(true);
    const postBox=await page.locator('[data-lime-post-card]').first().boundingBox();
    expect(postBox!.y).toBeGreaterThanOrEqual(layout.bottom-1);
  }
});

test('own posts can be added, read after reload, and removed from the highlight tab',async({page},info)=>{
  const state=await setup(page,false);await page.goto('u/lime');
  const tabs=page.locator('[data-lime-profile-mobile-tabs]');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  const originalFont=await tabs.getByRole('tab').first().evaluate(el=>getComputedStyle(el).fontSize);
  for(const content of ['9月の日記を更新しました','古い固定対象']){
    const card=page.locator('[data-lime-post-card]').filter({hasText:content}).first();
    await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
    await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  }
  await expect.poll(()=>state.highlights.length).toBe(2);
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  expect(await tabs.getByRole('tab').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe(originalFont);
  await press(page,tabs.getByRole('tab',{name:'ハイライト',exact:true}));
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
  await expect(page.locator('[data-lime-post-card]').first()).toContainText('古い固定対象');
  await page.reload();
  await press(page,tabs.getByRole('tab',{name:'ハイライト',exact:true}));
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
  await page.screenshot({path:info.outputPath('highlights-restored.png'),animations:'disabled'});
  for(let remaining=1;remaining>=0;remaining--){
    await press(page,page.locator('[data-lime-post-card]').first().getByRole('button',{name:'ポストのメニュー'}));
    await press(page,page.getByRole('button',{name:'ハイライトから解除',exact:true}));
    await expect.poll(()=>state.highlights.length).toBe(remaining);
    if(remaining)await expect(page.locator('[data-lime-post-card]')).toHaveCount(remaining);
  }
  await expect(tabs.getByRole('tab',{name:'ハイライト',exact:true})).toHaveCount(0);
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tabs.getByRole('tab',{name:'ポスト',exact:true})).toHaveAttribute('data-state','active');
});

test('highlight tabs preserve the original profile typography and underline design',async({page},info)=>{
  const state=await setup(page,false);state.pin='old';
  await page.goto('u/lime');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  const tabs=page.locator('[data-lime-profile-mobile-tabs]');
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  const design=()=>tabs.evaluate(el=>{
    const active=el.querySelector<HTMLElement>('[role=tab][data-state=active]')!;
    const inactive=el.querySelector<HTMLElement>('[role=tab][data-state=inactive]')!;
    const line=el.querySelector<HTMLElement>('.profile-tabs-underline')!;
    const activeStyle=getComputedStyle(active),inactiveStyle=getComputedStyle(inactive),lineStyle=getComputedStyle(line);
    return {
      activeFont:activeStyle.fontSize,activeWeight:activeStyle.fontWeight,activeColor:activeStyle.color,
      inactiveFont:inactiveStyle.fontSize,inactiveWeight:inactiveStyle.fontWeight,inactiveColor:inactiveStyle.color,
      width:lineStyle.width,height:lineStyle.height,bottom:lineStyle.bottom,color:lineStyle.backgroundColor,
      radius:lineStyle.borderRadius,transition:lineStyle.transition,
    };
  });
  const original=await design();
  const viewportWidth=page.viewportSize()!.width;
  expect(original.activeFont).toBe(viewportWidth>=640 || viewportWidth<390 ? '14px' : '12px');
  expect(original.inactiveFont).toBe(original.activeFont);
  const card=page.locator('[data-lime-post-card]').filter({hasText:'9月の日記を更新しました'}).first();
  await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
  await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  await expect.poll(()=>state.highlights).toEqual(['native']);
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  expect(await design()).toEqual(original);
  const line=tabs.locator('.profile-tabs-underline');
  for(const label of ['ポスト','ハイライト','メディア','いいね','リアクション']){
    const tab=tabs.getByRole('tab',{name:label,exact:true});
    await tab.scrollIntoViewIfNeeded();
    await press(page,tab);
    await expect(tab).toHaveAttribute('data-state','active');
    await expect.poll(async()=>{
      const marker=(await line.boundingBox())!,selected=(await tab.boundingBox())!;
      return Math.abs(marker.x+marker.width/2-selected.x-selected.width/2);
    }).toBeLessThan(1);
    expect(await design()).toEqual(original);
    const divider=page.locator('[data-lime-profile-tabs-divider]');
    const markerBox=(await line.boundingBox())!,dividerBox=(await divider.boundingBox())!;
    expect(markerBox.y+markerBox.height).toBeLessThanOrEqual(dividerBox.y+1);
  }
  const highlight=tabs.getByRole('tab',{name:'ハイライト',exact:true});
  await highlight.scrollIntoViewIfNeeded();await press(page,highlight);
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('profile-design-preserved.png'),animations:'disabled'});
  await page.locator('[data-lime-profile-tabs-header]').screenshot({path:info.outputPath('tabs-design-preserved.png'),animations:'disabled'});
});

test('nested profile URLs use the root manifest and external profiles do not query UUID follows',async({page})=>{
  await setup(page,false);
  const invalidFollowRequests:string[]=[];
  page.on('request',req=>{if(req.url().includes('/follows?')&&req.url().includes('misskey-user'))invalidFollowRequests.push(req.url());});
  await page.route('**/*.supabase.co/rest/v1/profiles?*',route=>{
    const username=new URL(route.request().url()).searchParams.get('username');
    return route.fulfill({contentType:'application/json',body:JSON.stringify(username==='eq.cat@misskey.io'?[]:[profile])});
  });
  await page.route('https://misskey.io/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/users/show')?{id:'local-cat',username:'cat',name:'Misskey Cat',notesCount:0}:[])}));
  await page.goto('u/cat@misskey.io');
  await expect(page.getByRole('heading',{name:'Misskey Cat',exact:true})).toBeVisible();
  const manifests=await page.locator('link[rel=manifest]').evaluateAll(elements=>elements.map(el=>(el as HTMLLinkElement).href));
  expect(manifests.length).toBeGreaterThan(0);
  expect(manifests).toHaveLength(1);
  expect(new URL(manifests[0]).pathname).toMatch(/^\/RaimuNoteSNS\.github\.io\/manifest(?:\.dev)?\.webmanifest$/);
  expect((await page.request.get(manifests[0])).status()).toBe(200);
  expect(invalidFollowRequests).toEqual([]);
});

test('touching a profile and navigating from the mobile sidebar emits no passive or aria-hidden warnings',async({page})=>{
  test.skip(!page.context().browser()?.browserType() || !((page.viewportSize()?.width??0)<640),'Mobile interaction regression');
  const messages:string[]=[];
  page.on('console',message=>{if(/passive event listener|Blocked aria-hidden/.test(message.text()))messages.push(message.text());});
  await setup(page,false);await page.goto('./');
  const avatar=page.locator('[data-lime-post-avatar]').first();
  await expect(avatar).toBeVisible();
  await avatar.dispatchEvent('touchstart',{bubbles:true,cancelable:true});
  await press(page,page.getByRole('button',{name:'メニューを開く',exact:true}));
  const sidebar=page.locator('[data-lime-mobile-sidebar]');
  await expect(sidebar).toBeVisible();
  await press(page,sidebar.getByRole('button',{name:'プロフィール',exact:true}));
  await expect(page).toHaveURL(/\/u\/lime$/);
  await expect(sidebar).toHaveAttribute('inert','');
  expect(await sidebar.evaluate(el=>el.contains(document.activeElement))).toBe(false);
  expect(messages).toEqual([]);
});

async function mockAccountAbout(page:Page, value:unknown) {
  await page.route('**/rest/v1/profiles*',route => {
    if (!new URL(route.request().url()).searchParams.get('select')?.includes('country_code')) return route.fallback();
    return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  });
}

test('join-date link opens account information, reloads, and returns without changing tabs', async ({ page }, info) => {
  const state = await setup(page, false); state.highlights = ['native'];
  await mockAccountAbout(page, {
    user_id: user.id, country_code: 'JP', connection_source: 'LimeNote for iPhone',
    connection_updated_at: '2026-10-08T00:00:00Z', username_change_count: 2,
    last_username_change_at: '2026-10-05T00:00:00Z', tracking_since: '2026-10-01T00:00:00Z',
  });
  await page.goto('u/lime');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const link = page.locator('[data-lime-account-about-link]');
  await expect(link).toHaveText('2026年10月 から参加');
  await expect(link.locator('svg.lucide-calendar-days')).toBeVisible();
  await press(page, link);
  await expect(page).toHaveURL(/\/u\/lime\/about$/);
  const about = page.locator('[data-lime-account-about]');
  await expect(page.locator('[data-lime-app-header]').getByRole('heading', { name: 'アカウントについて' })).toBeVisible();
  await expect(about.locator('header')).toHaveCount(0);
  await expect(page.locator('[data-lime-app-header]')).toHaveCount(1);
  await expect(about.getByText('@lime', { exact: true })).toBeVisible();
  await expect(about.getByText('日本', { exact: true })).toBeVisible();
  await expect(about.getByText('ユーザー名の変更2回')).toBeVisible();
  await expect(about.getByText('前回の変更: 2026年10月')).toBeVisible();
  await expect(about.getByText('LimeNote for iPhone')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('account-about.png'), animations: 'disabled', fullPage: true });
  await page.reload();
  await expect(about.getByText('日本', { exact: true })).toBeVisible();
  await press(page, page.locator('[data-lime-app-header]').getByRole('link', { name: 'プロフィールに戻る' }));
  await expect(page).toHaveURL(/\/u\/lime$/);
  await expect(page.locator('[data-lime-profile-mobile-tabs]').getByRole('tab')).toHaveCount(5);
});

test('account information shows uncollected values without inventing country or history', async ({ page }) => {
  await setup(page, false);
  await mockAccountAbout(page, null);
  await page.goto('u/lime/about');
  const about = page.locator('[data-lime-account-about]');
  await expect(about.getByText('未取得', { exact: true })).toHaveCount(3);
  await expect(about.getByText('ユーザー名の変更', { exact: true })).toBeVisible();
  await expect(about.getByText('ユーザー名の変更0回')).toHaveCount(0);
});

test('account information shows the profile verification badge and omits tracking notices', async ({ page }) => {
  await setup(page, false);
  await page.route('**/rest/v1/profiles*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ ...profile, is_official: true }]) }));
  await mockAccountAbout(page, {
    user_id: user.id, country_code: null, connection_source: null, connection_updated_at: null,
    username_change_count: 0, last_username_change_at: null, tracking_since: '2026-10-01T00:00:00Z',
  });
  await page.goto('u/lime/about');
  const about = page.locator('[data-lime-account-about]');
  const badge = about.getByRole('img', { name: 'Official' });
  await expect(badge).toBeVisible();
  expect(await badge.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(about.getByText('ユーザー名の変更0回')).toBeVisible();
  await expect(about.getByText(/記録開始以降|以降の記録/)).toHaveCount(0);
});

test('added Bluesky and Misskey users persist in cloud across separate browsers and failed writes do not toggle', async ({ page, browser }) => {
  const cloud = { rows: [] as {user_id:string;provider:string;handle:string}[], imported: false, fail: false };
  const external = [
    { handle:'cat.bsky.social', name:'Bluesky Cat', provider:'bluesky' },
    { handle:'cat@misskey.io', name:'Misskey Cat', provider:'misskey' },
  ];
  const moduleUrls = new Map<Page,string>();
  async function prepare(target: Page) {
    target.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('/src/lib/externalAccounts.ts')) moduleUrls.set(target, request.url());
    });
    await setup(target,false);
    await target.route('**/rest/v1/profiles?*',route => {
      const handle=new URL(route.request().url()).searchParams.get('username')?.slice(3);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(external.some(row=>row.handle===handle)?[]:[profile])});
    });
    await target.route('**/rest/v1/rpc/import_external_account_users',route=>{
      if(!cloud.imported){cloud.imported=true;cloud.rows.push(...(route.request().postDataJSON().legacy??[]).map((row:object)=>({...row,user_id:user.id})));}
      return route.fulfill({status:204,body:''});
    });
    await target.route('**/rest/v1/external_account_users*',route=>{
      const request=route.request();
      if(request.method()==='POST'){
        if(cloud.fail)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"fixture write failed"}'});
        const row=request.postDataJSON();if(!cloud.rows.some(existing=>existing.provider===row.provider&&existing.handle===row.handle))cloud.rows.push(row);
        return route.fulfill({status:201,body:''});
      }
      if(request.method()==='DELETE'){
        const url=new URL(request.url()),provider=url.searchParams.get('provider')?.slice(3),handle=url.searchParams.get('handle')?.slice(3);
        cloud.rows=cloud.rows.filter(row=>row.provider!==provider||row.handle!==handle);
        return route.fulfill({status:204,body:''});
      }
      return route.fulfill({contentType:'application/json',body:JSON.stringify(cloud.rows.map(({provider,handle})=>({provider,handle})))});
    });
    await target.route('**/public.api.bsky.app/**',route=>{
      if(route.request().url().includes('getProfile'))return route.fulfill({contentType:'application/json',body:JSON.stringify({did:'did:plc:fixture-cat',handle:'cat.bsky.social',displayName:'Bluesky Cat',createdAt:user.createdAt,followersCount:0,followsCount:0,postsCount:0})});
      return route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'});
    });
    await target.route('https://misskey.io/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/users/show')?{id:'local-cat',username:'cat',name:'Misskey Cat',notesCount:0}:[])}));
  }
  async function loadCloud(target:Page) {
    await expect.poll(() => moduleUrls.has(target)).toBe(true);
    await target.evaluate(async ({id,url})=>{
      // Use the app's exact module URL, including Vite's HMR version, so the
      // fixture activates the same store that the real profile buttons use.
      const module=await import(url);
      module.setExternalAccountOwner(id);await module.initialiseExternalAccounts();
    },{id:user.id,url:moduleUrls.get(target)!});
  }
  await prepare(page);
  for(const row of external){
    await page.goto(`u/${row.handle}`);await loadCloud(page);
    await expect(page.getByRole('heading',{name:row.name,exact:true})).toBeVisible();
    await press(page,page.getByRole('button',{name:'追加する',exact:true}));
    await expect(page.getByRole('button',{name:'追加済み',exact:true})).toBeVisible();
  }
  expect(cloud.rows).toHaveLength(2);
  expect(await page.evaluate(()=>['lime_bluesky_author_handles','lime_misskey_author_handles'].map(key=>localStorage.getItem(key)))).toEqual([null,null]);
  const secondContext=await browser.newContext({baseURL:'http://127.0.0.1:8080/RaimuNoteSNS.github.io/',serviceWorkers:'block'});
  try {
    const second=await secondContext.newPage();await prepare(second);
    for(const row of external){
      await second.goto(`u/${row.handle}`);await loadCloud(second);
      await expect(second.getByRole('button',{name:'追加済み',exact:true})).toBeVisible();
      await second.getByRole('button',{name:'追加済み',exact:true}).click();
      await expect(second.getByRole('button',{name:'追加する',exact:true})).toBeVisible();
    }
    expect(cloud.rows).toHaveLength(0);
    await page.goto('u/cat.bsky.social');await loadCloud(page);
    await expect(page.getByRole('button',{name:'追加する',exact:true})).toBeVisible();
    cloud.fail=true;
    await press(page,page.getByRole('button',{name:'追加する',exact:true}));
    await expect(page.getByText('追加済みユーザーを保存できませんでした。もう一度お試しください。')).toBeVisible();
    await expect(page.getByRole('button',{name:'追加する',exact:true})).toBeVisible();
    expect(cloud.rows).toHaveLength(0);
  } finally {await secondContext.close();}
});

test('own post pin is read and updated through profiles and survives reload', async ({ page }) => {
  const state=await setup(page,false);
  const legacyRequests:string[]=[];
  page.on('request',request=>{if(request.url().includes('/rest/v1/profile_pins'))legacyRequests.push(request.url());});
  await page.goto('u/lime');
  let card=page.locator('[data-lime-post-card]').filter({hasText:'9月の日記を更新しました'}).first();
  await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
  await press(page,page.getByRole('button',{name:'プロフィールに固定',exact:true}));
  await expect.poll(()=>state.pin).toBe('native');
  await expect(page.locator('[data-lime-pinned-label]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-lime-pinned-label]')).toBeVisible();
  card=page.locator('[data-lime-post-card]').filter({hasText:'9月の日記を更新しました'}).first();
  await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
  await press(page,page.getByRole('button',{name:'プロフィールから固定を解除',exact:true}));
  await expect.poll(()=>state.pin).toBeNull();
  await expect(page.locator('[data-lime-pinned-label]')).toHaveCount(0);
  expect(legacyRequests).toEqual([]);
});

test('notification header contains animated tabs, full-width rows and no settings button',async({page})=>{
 await setup(page,false);
 const notifications=[
  {id:'like-1',user_id:user.id,actor_id:'actor-a',actor_name:'Alice',actor_username:'alice',actor_is_official:true,type:'like',post_id:'native',image_urls:['data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="pink"/%3E%3C/svg%3E'],is_read:false,created_at:'2026-10-08T10:00:00Z'},
  {id:'like-2',user_id:user.id,actor_id:'actor-b',actor_name:'Bob',type:'like',post_id:'native',is_read:false,created_at:'2026-10-08T09:00:00Z'},
  {id:'mention',user_id:user.id,actor_id:'actor-b',actor_name:'Bob',type:'mention',post_id:'native',content_preview:'こんにちは @lime',is_read:false,created_at:'2026-10-08T08:00:00Z'},
  {id:'follow',user_id:user.id,actor_id:'actor-c',actor_name:'Carol',actor_username:'carol',type:'follow',post_id:null,is_read:true,created_at:'2026-10-07T08:00:00Z'},
 ];const readIds:string[]=[];
 await page.route('**/rest/v1/notifications*',route=>{if(route.request().method()==='PATCH'){readIds.push(new URL(route.request().url()).searchParams.get('id')??'');return route.fulfill({status:204,body:''});}return route.fulfill({contentType:'application/json',body:JSON.stringify(notifications)});});
 await page.goto('notifications');
 await expect(page.locator('[data-lime-header-row]').getByRole('heading',{name:'通知',exact:true})).toBeVisible();
 await expect(page.locator('[data-notification-type="like"]')).toHaveCount(1);
 await expect(page.getByText('さんと他1人があなたのポストをいいねしました',{exact:false})).toBeVisible();
 await expect(page.getByRole('img',{name:'通知対象のポストの画像'})).toBeVisible();
 expect(await page.locator('[data-notification-type="follow"]').getAttribute('href')).toContain('/u/carol');
 await press(page,page.getByRole('tab',{name:'メンション',exact:true}));
 await expect(page.locator('[data-notification-type="like"]')).toHaveCount(0);
 await expect(page.getByText('こんにちは @lime')).toBeVisible();
 await expect.poll(()=>readIds.length).toBeGreaterThan(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await press(page,page.getByRole('tab',{name:'すべて',exact:true}));
 await page.screenshot({path:`artifacts/notifications-${test.info().project.name}.png`,fullPage:false});
 await expect(page.locator('[data-lime-app-header]').getByRole('link',{name:'通知設定',exact:true})).toHaveCount(0);
 expect(await page.locator('[data-lime-notification-tabs]').evaluate(el=>!!el.closest('[data-lime-app-header]'))).toBe(true);
 const widths=await page.evaluate(()=>{const row=document.querySelector('[data-notification-type]')!.getBoundingClientRect();const header=document.querySelector('[data-lime-app-header]')!.getBoundingClientRect();return {row:row.width,header:header.width};});expect(Math.abs(widths.row-widths.header)).toBeLessThan(2);
});

test('notification preferences persist and subscribed actors can be disabled without changing other settings',async({page})=>{
 await setup(page,false);const preferences:Record<string,boolean>={};let failed=false;
 let subscriptions=[{id:'native-target',subscriber_id:user.id,provider:'limenote',target_user_id:'other',external_actor:null,profiles:{username:'native',display_name:'Native User'}},{id:'external-target',subscriber_id:user.id,provider:'bluesky',target_user_id:null,external_actor:'cat.bsky.social',target_name:'Bluesky Cat',profiles:null}];
 await page.route('**/rest/v1/profile_private_settings*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({notification_preferences:preferences})}));
 await page.route('**/rest/v1/rpc/set_notification_preference',route=>{if(failed)return route.fulfill({status:500,body:'{"message":"failed"}'});const {kind,enabled}=route.request().postDataJSON();preferences[kind]=enabled;return route.fulfill({status:204,body:''});});
 await page.route('**/rest/v1/post_notification_subscriptions*',route=>{if(route.request().method()==='DELETE'){const id=new URL(route.request().url()).searchParams.get('id')?.slice(3);subscriptions=subscriptions.filter(row=>row.id!==id);return route.fulfill({status:204,body:''});}return route.fulfill({contentType:'application/json',body:JSON.stringify(subscriptions)});});
 await page.goto('settings#notifications');const section=page.locator('#notifications');await section.scrollIntoViewIfNeeded();
 const card=await section.evaluate(el=>({radius:getComputedStyle(el).borderRadius,border:getComputedStyle(el).borderTopWidth}));expect(parseFloat(card.radius)).toBeGreaterThan(0);expect(parseFloat(card.border)).toBeGreaterThan(0);
 await expect(section.getByRole('switch',{name:'いいね',exact:true})).toBeChecked();
 await press(page,section.getByRole('switch',{name:'いいね',exact:true}));await expect(section.getByRole('switch',{name:'いいね',exact:true})).not.toBeChecked();
 await page.reload();await section.scrollIntoViewIfNeeded();await expect(section.getByRole('switch',{name:'いいね',exact:true})).not.toBeChecked();
 failed=true;await press(page,section.getByRole('switch',{name:'返信',exact:true}));await expect(page.getByText('通知設定を保存できませんでした')).toBeVisible();await expect(section.getByRole('switch',{name:'返信',exact:true})).toBeChecked();
 await expect(section.getByText('Bluesky Cat',{exact:true})).toBeVisible();const externalOff=section.getByRole('button',{name:'通知をOFF'}).last();await externalOff.scrollIntoViewIfNeeded();await press(page,externalOff);await expect(section.getByText('Bluesky Cat',{exact:true})).toHaveCount(0);await expect(section.getByText('Native User',{exact:true})).toBeVisible();
 await section.scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/notification-settings-${test.info().project.name}.png`,fullPage:false});
 const sections=await page.evaluate(()=>{const h=Array.from(document.querySelectorAll('h2'));return ['LimePro','通知設定','背景'].map(name=>h.findIndex(item=>item.textContent===name));});expect(sections[0]).toBeLessThan(sections[1]);expect(sections[1]).toBeLessThan(sections[2]);
});

test('Bluesky and Misskey notification bells persist provider subscriptions and handle write failures',async({page})=>{
 await setup(page,false);let subscriptions:Record<string,unknown>[]=[];let fail=false;
 await page.route('**/rest/v1/profiles?*',route=>route.fulfill({contentType:'application/json',body:'[]'}));
 await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().includes('getProfile')?{did:'did:plc:fixture-cat',handle:'cat.bsky.social',displayName:'Bluesky Cat',createdAt:user.createdAt}:{feed:[],posts:[],actors:[]})}));
 await page.route('https://misskey.io/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/users/show')?{id:'local-cat',username:'cat',name:'Misskey Cat',notesCount:0}:[])}));
 await page.route('**/rest/v1/post_notification_subscriptions*',route=>{const req=route.request();const url=new URL(req.url());if(req.method()==='POST'){if(fail)return route.fulfill({status:500,body:'{"message":"failed"}'});subscriptions.push({...req.postDataJSON(),id:'subscription-'+subscriptions.length});return route.fulfill({status:201,body:''});}const actor=url.searchParams.get('external_actor')?.slice(3);if(req.method()==='DELETE'){subscriptions=subscriptions.filter(row=>row.external_actor!==actor);return route.fulfill({status:204,body:''});}return route.fulfill({contentType:'application/json',body:JSON.stringify(subscriptions.find(row=>row.external_actor===actor)??null)});});
 for(const [handle,provider] of [['cat.bsky.social','bluesky'],['cat@misskey.io','misskey']]){
  await page.goto(`u/${handle}`);await press(page,page.getByRole('button',{name:'新しい投稿を通知する',exact:true}));await expect(page.getByRole('button',{name:'新しい投稿の通知をオフにする',exact:true})).toBeVisible();
  expect(subscriptions.at(-1)).toMatchObject({provider,external_actor:handle});expect(subscriptions.at(-1)?.target_user_id).toBeUndefined();
  await page.reload();await expect(page.getByRole('button',{name:'新しい投稿の通知をオフにする',exact:true})).toBeVisible();
  await press(page,page.getByRole('button',{name:'新しい投稿の通知をオフにする',exact:true}));await expect(page.getByRole('button',{name:'新しい投稿を通知する',exact:true})).toBeVisible();
 }
 fail=true;await press(page,page.getByRole('button',{name:'新しい投稿を通知する',exact:true}));await expect(page.getByText('投稿通知の切り替えに失敗しました。もう一度お試しください。')).toBeVisible();await expect(page.getByRole('button',{name:'新しい投稿を通知する',exact:true})).toBeVisible();expect(subscriptions).toEqual([]);
});
