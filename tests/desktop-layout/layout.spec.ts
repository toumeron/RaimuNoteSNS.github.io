import { test, expect } from '@playwright/test';
import {loadMisskey} from '../../supabase/functions/link-preview/load';

const user = { id: '11111111-1111-1111-1111-111111111111', username: 'lime', displayName: 'Lime Note', avatarUrl: '', bio: '', coverUrl: '', createdAt: '2026-10-01T00:00:00Z' };
const profile = { id: user.id, username: user.username, display_name: user.displayName, avatar_url: '', bio: '', cover_url: '', created_at: user.createdAt };
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="lightgreen"/></svg>');
const posts = [0, 1].map(i => ({ id: `post-${i}`, userId: user.id, content: i ? 'フォロー中の投稿' : '画像付きの投稿', imageUrls: i ? [] : [image], createdAt: user.createdAt, likesCount: 0, commentsCount: 0, repostsCount: 0, likedByMe: false, repostedByMe: false, author: user }));

test.beforeEach(async ({ page }) => {
  await page.route('**/src/hooks/useAuth.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({user:${JSON.stringify(user)},loading:false,session:null,accounts:[],logout:async()=>{}});export const AuthProvider=({children})=>children;` }));
  await page.route('**/src/lib/currentUser.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const getCurrentUserId=async()=> '${user.id}';` }));
  await page.route('**/src/api/posts.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `const posts=${JSON.stringify(posts)};
    export const getHighlightedPosts=async()=>[]; export const getMapPosts=async()=>[]; export const setPostMapLocation=async()=>{};
    export const getFeed=async()=>posts; export const getFollowingFeed=async()=>[posts[1]];
    export const getPostsByUser=async()=>posts; export const getProfilePosts=async()=>posts.map(post=>post.repostedByMe?{...post,profileRepostedBy:post.userId,profileRepostedAt:"2026-10-03T00:00:00Z"}:post); export const getLikedPostsByUser=async()=>posts;
    export const searchPosts=async()=>posts; export const getPostById=async()=>posts[0];
    export const createPost=async(input)=>{window.__lastCreatedPost=input;return posts[0];}; export const toggleLike=async()=>({liked:true,likesCount:1});
    export const toggleRepost=async(id)=>{window.__repostRequests=[...(window.__repostRequests??[]),id];const post=posts.find(p=>p.id===id);post.repostedByMe=!post.repostedByMe;post.repostsCount=post.repostedByMe?1:0;return {reposted:post.repostedByMe,repostsCount:post.repostsCount};}; export const deletePost=async()=>{}; export const getPostLikers=async()=>[];` }));
  await page.route('**/*.supabase.co/**', route => {
    const url = new URL(route.request().url());
    const single = (route.request().headers().accept ?? '').includes('vnd.pgrst.object');
    let data: unknown = single ? null : [];
    if (url.pathname.includes('/profiles')) data = single ? profile : [profile];
    if (url.pathname.includes('/posts')) {
      const rows = posts.map(post => ({ ...post, user_id: user.id, image_urls: post.imageUrls, created_at: post.createdAt, likes_count: 0, comments_count: 0, profiles: profile }));
      data = single ? rows[0] : rows;
    }
    if (url.pathname.includes('/rpc/get_account_follow_state')) data={followed:false,requested:false,canView:true};
    if (url.pathname.includes('get-trends')) data = [{ title: 'テストのトレンド', traffic: '10' }];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('https://misskey.io/api/**', route => route.fulfill({contentType:'application/json',body:'[]'}));
  await page.route('**/public.api.bsky.app/**', route => route.fulfill({ contentType: 'application/json', body: '{"feed":[],"posts":[],"actors":[]}' }));
});

const routes = ['', 'search', 'notifications', 'chat', 'media', 'media/lime', 'news', 'u/lime', 'u/lime/followers_following', 'post/post-0', 'post/post-0/activity', 'settings', 'share', 'spaces/room', 'limepro'];

for (const width of [390,1440]) {
  test(`Misskey posts work across home search profile media and bookmarks at ${width}px`,async({page})=>{
    const note={id:'misskeynote1',text:'Misskeyからの猫の写真 @friend@misskey.io @nearby',createdAt:new Date().toISOString(),visibility:'public',user:{id:'misskeyauthor',username:'misskeycat',name:'Misskey Cat',avatarUrl:image},files:[{type:'image/png',url:image}],reactions:{'❤️':5},repliesCount:1};
    const noteId='misskey:https://misskey.io/notes/misskeynote1';
    await page.addInitScript(()=>localStorage.setItem('lime_misskey_author_handles','["misskeycat@misskey.io"]'));
    let stored:Record<string,unknown>|null=null;
    await page.route('https://misskey.io/api/**',route=>{
      const endpoint=new URL(route.request().url()).pathname;
      const data=endpoint.endsWith('/users/show') ? {...note.user,notesCount:1} : endpoint.endsWith('/notes/show') ? note : endpoint.endsWith('/users/search') ? [note.user] : endpoint.endsWith('/notes/children') ? [{...note,id:'replynote1',text:'Misskeyからの返信',files:[]}] : [note];
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.route('**/*.supabase.co/rest/v1/bookmarks*',async route=>{
      if (route.request().method()==='POST') {stored={id:'saved-note',created_at:new Date().toISOString(),...route.request().postDataJSON()};return route.fulfill({status:201,body:''});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(stored ? [stored]:[])});
    });
    await page.setViewportSize({width,height:900});await page.goto('./');
    const card=page.locator('[data-lime-post-card]').filter({hasText:note.text}).first();
    await expect(card).toBeVisible();await expect(card).toContainText('Misskey');
    await expect(card.getByRole('link',{name:'@friend@misskey.io',exact:true})).toHaveAttribute('href',/u\/friend@misskey\.io$/);
    await expect(card.getByRole('link',{name:'@nearby',exact:true})).toHaveAttribute('href',/u\/nearby@misskey\.io$/);
    await card.getByRole('button',{name:'ブックマークに追加',exact:true}).click();
    await expect.poll(()=>stored?.external_id).toBe(noteId);
    expect(stored?.post_id).toBeUndefined();
    await card.getByAltText('投稿画像').click();
    const media=page.getByRole('dialog',{name:'メディアを拡大表示'});
    await expect(media).toBeVisible();await expect(media).toContainText(note.text);
    await media.getByRole('button',{name:'画像を閉じる'}).click();await expect(media).toBeHidden();
    await page.goto('bookmarks');
    await expect(page.locator('[data-lime-post-card]').filter({hasText:note.text})).toBeVisible();
    await page.goto('search?q=猫');
    await expect(page.locator('[data-lime-post-card]').filter({hasText:note.text}).first()).toBeVisible();
    await page.goto('post/'+encodeURIComponent(noteId));
    await expect(page.getByText('Misskeyからの返信',{exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'@friend@misskey.io',exact:true}).first()).toHaveAttribute('href',/u\/friend@misskey\.io$/);
    await page.route('**/*.supabase.co/rest/v1/profiles*',route=>{
      const url=new URL(route.request().url());
      if (url.searchParams.get('username')?.includes('misskeycat')) return route.fulfill({contentType:'application/json',body:'null'});
      return route.fallback();
    });
    await page.goto('u/misskeycat%40misskey.io');
    await expect(page.locator('[data-lime-post-card]').filter({hasText:note.text}).first()).toBeVisible();
    await page.screenshot({path:test.info().outputPath(`misskey-profile-${width}.png`),animations:'disabled'});
  });
}

test('latest and following never request the server-wide Misskey timeline',async({page})=>{
  const endpoints:string[]=[];
  await page.route('https://misskey.io/api/**',route=>{
    endpoints.push(new URL(route.request().url()).pathname);
    return route.fulfill({contentType:'application/json',body:'[]'});
  });
  await page.goto('./');
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
  await page.getByRole('tab',{name:'フォロー中',exact:true}).click();
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(1);
  expect(endpoints).toEqual([]);
});

test('search publishes LimeNote Bluesky and Misskey in one batch',async({page})=>{
  const note={uri:'at://did:plc:cat/app.bsky.feed.post/photo',cid:'photo',author:{did:'did:plc:cat',handle:'cat.bsky.social',displayName:'Bluesky Cat'},record:{$type:'app.bsky.feed.post',text:'Blueskyの画像付きの投稿',createdAt:new Date().toISOString()},likeCount:5};
  await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({posts:[note],actors:[]})}));
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('https://misskey.io/api/**',async route=>{await pending;await route.fulfill({contentType:'application/json',body:'[]'});});
  await page.goto('search?q=画像');
  await expect.poll(()=>page.locator('[data-lime-post-card]').count()).toBe(0);
  release();
  await expect(page.locator('[data-lime-post-card]').filter({hasText:'Blueskyの画像付きの投稿'})).toBeVisible();
  await expect(page.locator('[data-lime-post-card]').filter({hasText:posts[0].content}).first()).toBeVisible();
});

for(const width of [390,1440]){
  test(`search suggestions include LimeNote Bluesky and Misskey and open the right profile at ${width}px`,async({page})=>{
    const actor={id:'suggestauthor',username:'lime_suggest',name:'Lime Misskey Suggest',avatarUrl:image,description:'Misskeyのプロフィール'};
    await page.route('https://misskey.io/api/**',route=>{
      const path=new URL(route.request().url()).pathname;
      return route.fulfill({contentType:'application/json',body:JSON.stringify(path.endsWith('/users/show')?actor:path.endsWith('/users/search')?[actor]:[])});
    });
    await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({actors:[{did:'did:plc:suggest',handle:'lime.bsky.social',displayName:'Lime Bluesky Suggest'}],posts:[]})}));
    await page.route('**/*.supabase.co/rest/v1/profiles*',route=>{
      if(new URL(route.request().url()).searchParams.get('username')?.includes('lime_suggest'))return route.fulfill({contentType:'application/json',body:'null'});
      return route.fallback();
    });
    await page.setViewportSize({width,height:900});await page.goto('search');
    const input=page.locator('input[placeholder="検索"]:visible').first();await input.fill('lime');
    await expect(page.getByRole('button',{name:/Lime Misskey Suggest/})).toBeVisible();
    await expect(page.getByRole('button',{name:/Lime Bluesky Suggest/})).toBeVisible();
    await expect(page.getByRole('button',{name:/Lime Note @lime/})).toBeVisible();
    await page.getByRole('button',{name:/Lime Misskey Suggest/}).click();
    await expect.poll(()=>decodeURIComponent(page.url())).toContain('/u/lime_suggest@misskey.io');
    await expect(page.getByText('Misskeyのプロフィール',{exact:true})).toBeVisible();
    await page.evaluate(()=>localStorage.setItem('lime_search_exclude_bluesky','true'));
    await page.goto('search');await page.locator('input[placeholder="検索"]:visible').first().fill('lime');
    await expect(page.getByRole('button',{name:/Lime Misskey Suggest/})).toBeVisible();
    await expect(page.getByRole('button',{name:/Lime Bluesky Suggest/})).toHaveCount(0);
  });
}

test('search appends one combined page without inserting delayed providers above existing posts',async({page})=>{
  const created=(index:number,source:number)=>new Date(Date.UTC(2026,9,7,12,0)-((index*3)+source)*60000).toISOString();
  const native=Array.from({length:40},(_,i)=>({id:`batch-native-${i}`,user_id:user.id,content:`batchsearchlime-${i}`,image_urls:[],created_at:created(i,0),likes_count:0,visibility:'public'}));
  const blue=Array.from({length:30},(_,i)=>({uri:`at://did:plc:batch/app.bsky.feed.post/${i}`,cid:String(i),author:{did:'did:plc:batch',handle:'batch.bsky.social'},record:{text:`batchsearchbsky-${i}`,createdAt:created(i,1)},likeCount:0}));
  const misskey=Array.from({length:30},(_,i)=>({id:`batchmisskey${i}`,text:`batchsearchmisskey-${i}`,createdAt:created(i,2),visibility:'public',user:{id:'batchauthor',username:'batchauthor',name:'Batch author'},files:[],reactions:{}}));
  await page.addInitScript(()=>localStorage.setItem('lime_search_page_tab','latest'));
  await page.route('**/*.supabase.co/rest/v1/posts*',route=>{
    const params=new URL(route.request().url()).searchParams;
    const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||20);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(native.slice(offset,offset+limit))});
  });
  await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({posts:blue,actors:[]})}));
  await page.route('https://misskey.io/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('notes/search') ? misskey:[])}));
  await page.setViewportSize({width:1440,height:900});await page.goto('search?q=batchsearch');
  const cards=page.locator('[data-lime-post-card]');
  const texts=async()=> (await cards.allTextContents()).map(text=>text.match(/batchsearch(?:lime|bsky|misskey)-\d+/)?.[0]);
  await expect(cards).toHaveCount(20);
  const first=await texts();
  expect(first.slice(0,3)).toEqual(['batchsearchlime-0','batchsearchbsky-0','batchsearchmisskey-0']);
  for(const count of [40,60,80,100]) {
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    await expect(cards).toHaveCount(count);
    expect((await texts()).slice(0,20)).toEqual(first);
  }
  expect(new Set(await texts()).size).toBe(100);
});

test('external accounts share one registration list without a Misskey login',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('lime_misskey_enabled','false');localStorage.setItem('lime_misskey_author_handles','["cat@misskey.io","other@misskey.io"]');});
  await page.route('https://misskey.io/api/users/show',route=>{const {username}=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify({id:username,username,name:username})});});
  await page.goto('settings');
  await expect(page.getByRole('heading',{name:'Bluesky・Misskey'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Misskey連携'})).toHaveCount(0);
  await expect(page.getByLabel('アクセストークン',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'@cat@misskey.ioを削除',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('lime_misskey_author_handles')!))).toEqual(['other@misskey.io']);
  await page.getByLabel('追加する外部アカウント').fill('@support@misskey.io');
  await page.getByRole('button',{name:'追加',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('lime_misskey_author_handles')!))).toEqual(['other@misskey.io','support@misskey.io']);
});

test('Misskey live public data reaches the browser through the reader when CORS blocks direct fetch',async({page})=>{
  test.skip(process.env.MISSKEY_LIVE!=='1','Opt-in live read only API check');
  const featured=await loadMisskey('notes/featured',{limit:10}) as {user:{username:string;host?:string|null}}[];
  const author=featured[0].user;
  await page.addInitScript(handle=>localStorage.setItem('lime_misskey_author_handles',JSON.stringify([handle])),`${author.username}@${author.host || 'misskey.io'}`);
  // The UI test uses a fixture account; exercise the production server reader
  // against real public data without creating or using a real user's session.
  await page.route('https://misskey.io/api/**',route=>route.abort('failed'));
  await page.route('**/*.supabase.co/functions/v1/link-preview',async route=>{
    const input=route.request().postDataJSON();
    if(input.mode!=='misskey')return route.fallback();
    const data=await loadMisskey(input.endpoint,input.params);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
  });
  await page.setViewportSize({width:1440,height:900});
  await page.goto('./');
  const cards=page.locator('[data-lime-post-card]').filter({has:page.getByText('Misskey',{exact:true})});
  await expect(cards.first()).toBeVisible({timeout:20000});
  expect(await cards.count()).toBeGreaterThan(0);
});

for(const width of [390,1440]) {
  test(`Misskey live exact official account appears in suggestions and search at ${width}px`,async({page})=>{
    test.skip(process.env.MISSKEY_LIVE!=='1','Real public API check');
    await page.route('https://misskey.io/api/**',route=>route.abort('failed'));
    await page.route('**/*.supabase.co/functions/v1/link-preview',async route=>{
      const input=route.request().postDataJSON();
      if(input.mode!=='misskey')return route.fallback();
      try {
        const data=await loadMisskey(input.endpoint,input.params);
        return route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
      } catch {return route.fulfill({status:502,contentType:'application/json',body:'{"error":"Misskey API failed"}'});}
    });
    await page.route('**/*.supabase.co/rest/v1/profiles*',route=>{
      const params=new URL(route.request().url()).searchParams;
      if(params.get('username')?.includes('system.proxy'))return route.fulfill({contentType:'application/json',body:'null'});
      return route.fallback();
    });
    await page.setViewportSize({width,height:900});await page.goto('search');
    await page.locator('input[placeholder="検索"]:visible').first().fill('Misskey.io');
    await expect(page.getByRole('button',{name:/Misskey.io @system.proxy@misskey.io/})).toBeVisible({timeout:25000});
    await page.locator('input[placeholder="検索"]:visible').first().press('Enter');
    await page.getByRole(width<768 ? 'button':'tab',{name:'ユーザー',exact:true}).click();
    await expect(page.getByText('@system.proxy@misskey.io',{exact:true}).first()).toBeVisible({timeout:25000});
  });
}

test('Misskey failures retain the native timeline and local search results',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('lime_misskey_author_handles','["misskeycat@misskey.io"]'));
  await page.route('https://misskey.io/api/**',route=>route.abort('failed'));
  await page.route('**/*.supabase.co/functions/v1/link-preview',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
  await page.goto('./');
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
  await page.goto('search?q=画像');
  await expect(page.locator('[data-lime-post-card]').filter({hasText:posts[0].content}).first()).toBeVisible();
});

test('iPad keeps trends and expands content using the compact sidebar in both orientations',async({page},info)=>{
  test.skip(!info.project.name.startsWith('iPad'),'Touch iPad projects only');
  await page.goto('./');
  for(const width of [700,744,768,820,1024,1180,1366,1376]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(true);
    await expect(page.locator('[data-lime-sidebar-logo]')).toBeHidden();
    await expect(page.locator('.lime-desktop-discover')).toBeVisible();
    await expect.poll(async()=> (await page.locator('.lime-desktop-menu').boundingBox())!.width).toBe(72);
    const column=(await page.locator('.lime-desktop-column').boundingBox())!;
    const right=(await page.locator('.lime-desktop-discover').boundingBox())!;
    expect(column.width).toBeCloseTo(width-72-right.width,0);
    expect(column.x).toBe(72);expect(right.x+right.width).toBeCloseTo(width,0);
    expect((await page.locator('[data-lime-post-card]').first().boundingBox())!.width).toBeCloseTo(column.width-2,0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(width===820||width===1180)await page.screenshot({path:info.outputPath(`ipad-${width}.png`),animations:'disabled'});
  }
  await page.locator('[data-lime-desktop-sidebar]').getByRole('button',{name:'もっと見る',exact:true}).click();
  await expect(page.locator('[data-lime-sidebar-more]')).toBeVisible();
});
for (const width of [768, 1440]) {
  test(`desktop settings precedes more and photo opens from its menu at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});await page.goto('./');
    const sidebar=page.locator('[data-lime-desktop-sidebar]');
    await expect(sidebar.getByRole('button',{name:'フォト',exact:true})).toHaveCount(0);
    const settings=sidebar.getByRole('button',{name:'設定',exact:true});
    const more=sidebar.getByRole('button',{name:'もっと見る',exact:true});
    await expect(settings).toBeVisible();await expect(more).toBeVisible();
    expect((await settings.boundingBox())!.y).toBeLessThan((await more.boundingBox())!.y);
    await expect(more.locator('svg')).toHaveClass(/lucide-circle-ellipsis/);
    await more.click();
    const menu=page.locator('[data-lime-sidebar-more]');
    await expect(menu).toBeVisible();await expect(menu).toHaveCSS('border-top-width','0px');
    await page.screenshot({path:test.info().outputPath('desktop-more.png'),animations:'disabled'});
    await menu.getByRole('menuitem',{name:'フォト',exact:true}).click();
    await expect(page).toHaveURL(/\/media$/);
    await expect(menu).toBeHidden();
  });
}
test('mobile sidebar retains its existing photo and settings items',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('./');
  await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
  const sidebar=page.locator('[data-lime-mobile-sidebar="true"]');
  await expect(sidebar.getByRole('button',{name:'フォト',exact:true})).toBeVisible();
  await expect(sidebar.getByRole('button',{name:'設定',exact:true})).toBeVisible();
  await expect(sidebar.getByRole('button',{name:'もっと見る',exact:true})).toHaveCount(0);
  await expect(sidebar.locator('[data-lime-mobile-nav-path="/settings"]')).toHaveCSS('border-top-width','0px');
  await expect(sidebar.locator('[data-lime-sidebar-divider]')).toHaveCount(0);
  await expect(page.locator('[data-lime-bottom-nav-root] a').first()).toHaveAttribute('aria-label','ホーム');
  expect(await page.locator('[data-lime-bottom-nav-root] ul').innerText()).not.toContain('ホーム');
  await expect(page.locator('[data-lime-mobile-sidebar-overlay]')).toHaveCSS('border-top-left-radius','42px');
  await expect(page.locator('[data-lime-mobile-sidebar-overlay]')).not.toHaveCSS('box-shadow','none');
  await page.screenshot({path:test.info().outputPath('mobile-sidebar.png')});
});
for (const width of [768, 1024, 1440]) {
  test(`every app page keeps its menu stable and required sidebars visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let menuX: number | undefined;
    let rightX: number | undefined;
    for (const path of routes) {
      await page.goto(path || './');
      // Space deep links intentionally open a modal. Close it before asserting
      // that the underlying page navigation is available to pointer input.
      if(path==='spaces/room')await page.getByRole('dialog').getByRole('button',{name:'閉じる',exact:true}).click();
      const sidebar = page.locator('[data-lime-desktop-sidebar]');
      await expect(sidebar).toBeVisible();
      const position = (await sidebar.boundingBox())!.x;
      if (menuX !== undefined) expect(position).toBe(menuX);
      menuX = position;
      const hideHeader = /^(u\/|media)/.test(path) || ['search', 'notifications', 'settings', 'chat', 'post/post-0'].includes(path);
      if (hideHeader) await expect(page.locator('[data-lime-app-header]')).toBeHidden();
      else await expect(page.locator('[data-lime-app-header]')).toBeVisible();
      const right = page.locator('.lime-desktop-discover');
      if (['chat', 'settings'].includes(path)) await expect(right).toHaveCount(0);
      else {
        await expect(right).toBeVisible();
        const position = (await right.boundingBox())!.x;
        if (rightX !== undefined) expect(position).toBe(rightX);
        rightX = position;
      }
      expect(await sidebar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      await expect.poll(() => page.evaluate(() => {
        const menu = document.querySelector<HTMLElement>('[data-lime-desktop-sidebar] button')!;
        const rect = menu.getBoundingClientRect();
        const column = document.querySelector('.lime-desktop-column')!.getBoundingClientRect();
        const headerElement = document.querySelector<HTMLElement>('[data-lime-app-header]')!;
        const header = headerElement.getBoundingClientRect();
        const headerHidden = getComputedStyle(headerElement).display === 'none';
        const workspace = document.querySelector('.vpop-root, [data-lime-media-viewport]')?.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth
          && menu.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
          && (headerHidden || (header.x >= column.x && header.right <= column.right))
          && (!workspace || (workspace.x >= column.x && workspace.right <= column.right && workspace.top >= header.bottom - 1 && workspace.bottom <= innerHeight + 1));
      }), { message: `layout bounds for /${path}` }).toBe(true);
      // An actual click catches overlays that cover the menu on full-height pages.
      await sidebar.getByRole('button', { name: 'ホーム', exact: true }).click();
      await expect(page.locator('[data-lime-feed-root]')).toBeVisible();
    }
  });
}

test('existing mobile feed tabs change the desktop feed content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
  await page.getByRole('tab', { name: 'フォロー中', exact: true }).click();
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(1);
  await expect(page.locator('[data-lime-post-card]')).toContainText('フォロー中の投稿');
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
});

test('iPad sidebar and desktop icons remain visible in LimeAI after history toggles and navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: info.project.name === 'iPad-WebKit' ? 820 : 1440, height: 900 });
  await page.goto('./');
  const sidebar = page.locator('[data-lime-desktop-sidebar]');
  const checkIcons = async () => {
    for (const label of ['ホーム', 'プロフィール', '検索', '通知', 'LimeAI', '設定']) {
      const button = sidebar.getByRole('button', { name: label, exact: true });
      const icon = button.locator('svg').first();
      await expect(icon).toBeVisible();
      await expect(icon).toBeInViewport();
      await expect.poll(() => button.evaluate(el => {
        const icon = el.querySelector('svg')!;
        const rect = icon.getBoundingClientRect();
        return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
  };
  await sidebar.getByRole('button', { name: 'LimeAI', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await checkIcons();
  const history = page.locator('#chat-sidebar');
  const opener = page.getByRole('button', { name: 'チャットメニューを開く', exact: true });
  if (await history.getAttribute('data-open') === 'true') {
    await history.getByRole('button', { name: 'サイドバーを閉じる', exact: true }).filter({ visible: true }).click();
  }
  await opener.click();
  await expect(history).toHaveAttribute('data-open', 'true');
  await checkIcons();
  await history.getByRole('button', { name: 'サイドバーを閉じる', exact: true }).filter({ visible: true }).click();
  await expect(history).toHaveAttribute('data-open', 'false');
  await checkIcons();
  await page.reload();
  await checkIcons();
  await page.setViewportSize({ width: 768, height: 900 });
  await checkIcons();
  await sidebar.getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(page.locator('[data-lime-feed-root]')).toBeVisible();
  await checkIcons();
});

test('LimeAI history and input stay in the content column', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('chat');
  const opener = page.getByRole('button', { name: 'チャットメニューを開く', exact: true });
  if (await opener.count()) await opener.click();
  await expect(page.locator('#chat-sidebar')).toHaveAttribute('data-open', 'true');
  const input = page.locator('.vpop-root textarea').first();
  await input.fill('入力欄の確認');
  await expect(input).toHaveValue('入力欄の確認');
  await expect.poll(() => input.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const column = document.querySelector('.lime-desktop-column')!.getBoundingClientRect();
    return rect.width > 100 && rect.x >= column.x && rect.right <= column.right && rect.bottom <= innerHeight;
  })).toBe(true);
  await page.locator('[data-lime-desktop-sidebar]').getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(page.locator('[data-lime-feed-root]')).toBeVisible();
});

test('populated photo viewer and existing post link remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('media');
  await expect(page.locator('[data-lime-media-viewport] img').first()).toBeVisible();
  await page.getByRole('button', { name: '投稿を開く', exact: true }).click();
  await expect(page).toHaveURL(/\/post\/post-0$/);
  await expect(page.locator('[data-lime-post-detail-card]')).toBeVisible();
});

test('returning to mobile removes the desktop shell and keeps the original bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator('.lime-app-shell')).toHaveCount(0);
  await expect(page.locator('[data-lime-desktop-sidebar]')).toHaveCount(0);
  await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
  await expect(page.locator('[data-lime-mobile-sidebar]')).toBeHidden();
  await expect(page.locator('[data-lime-feed-tab-row]')).toBeVisible();
});


test('post hover stays shadowless and profile card keeps its original animation after switching tabs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByRole('tab', { name: 'フォロー中', exact: true }).click();
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  const post = page.locator('[data-lime-post-card]').first();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const left = page.locator('[data-lime-desktop-sidebar]');
  const menu = left.getByRole('button', { name: 'ホーム', exact: true });
  await menu.hover();
  expect(await menu.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await left.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('.lime-desktop-discover > div > div').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await post.hover();
  expect(await post.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
  await post.locator('a[href$="/u/lime"]').first().hover();
  const card = page.locator('[data-lime-profile-hover-card]').first();
  await expect(card).toBeVisible();
  expect(await card.evaluate(el => getComputedStyle(el).animationName)).not.toBe('none');
  await page.goto('search');
  await expect(page.locator('.lime-desktop-main input').first()).toBeVisible();
  await expect(page.getByRole('tab').first()).toBeVisible();
});


test('profile mobile tabs and posts, search sticky tabs, and native post detail work on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('u/lime');
  await expect(page.locator('[data-lime-desktop-sidebar] button[aria-current="page"]')).toHaveText('プロフィール');
  expect(await page.locator('.lime-desktop-column').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const tabs = page.locator('[data-lime-profile-mobile-tabs]');
  const active = tabs.locator('[data-state="active"]');
  await expect(tabs.locator('.profile-tabs-underline')).toBeVisible();
  await tabs.getByRole('tab', { name: 'いいね', exact: true }).click();
  await expect(active).toHaveText('いいね');
  await expect(tabs.locator('.profile-tabs-underline')).toHaveCSS('width', '64px');
  await tabs.getByRole('tab', { name: 'ポスト', exact: true }).click();
  const post = page.locator('[data-lime-post-card]').first();
  await expect(post).toBeVisible();
  expect(await post.evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px');
  expect(await post.evaluate(el => el.classList.contains('rounded-3xl'))).toBe(false);
  await page.goto('search');
  await page.evaluate(() => {
    const filler = document.createElement('div'); filler.style.height = '1800px';
    document.querySelector('.lime-desktop-main > div')!.append(filler);
    window.scrollTo(0, 400);
  });
  await expect.poll(() => page.locator('[data-lime-search-home-tabs]').evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(64);
  await expect(page.locator('.lime-desktop-main input').first()).toBeVisible();
  await expect(page.locator('[data-lime-search-home-tabs]')).toBeVisible();
  await expect(page.locator('[data-lime-desktop-sidebar] button[aria-current="page"]')).toHaveText('検索');
  await page.goto('post/post-0');
  await expect(page.locator('.post-detail-mobile-topbar')).toBeVisible();
  await expect(page.locator('.post-detail-mobile-article')).toBeVisible();
  await expect(page.locator('.post-detail-mobile-content')).toHaveCSS('font-size', '18px');
  await expect(page.locator('.post-detail-mobile-action-row')).toBeVisible();
  await expect(page.locator('.comment-form-desktop-reply-input')).toBeVisible();
  await page.locator('.comment-form-desktop-reply-input').fill('返信欄の確認');
});


for (const width of [768, 820, 1024, 1180, 1376, 1440, 1920]) {
  test(`desktop uses available width, sidebar logo, and visible tab underlines at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    await expect(page.locator('[data-lime-header-row]')).toBeHidden();
    await expect(page.locator('[data-lime-sidebar-logo]')).toBeVisible();
    await expect(page.locator('[data-lime-sidebar-profile]')).toBeHidden();
    const leftWidth = (await page.locator('.lime-desktop-menu').boundingBox())!.width;
    const rightWidth = (await page.locator('.lime-desktop-discover').boundingBox())!.width;
    expect(leftWidth).toBeGreaterThanOrEqual(210);
    expect(rightWidth).toBeGreaterThanOrEqual(210);
    if (width >= 1440) { expect(leftWidth).toBeGreaterThanOrEqual(320); expect(rightWidth).toBeGreaterThanOrEqual(360); }
    await expect(page.locator('[data-lime-feed-tab-row]')).toBeVisible();
    expect(await page.locator('.lime-app-shell').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width);
    const post = page.locator('[data-lime-post-card]').first();
    await expect(post).toBeVisible();
    const column = (await page.locator('.lime-desktop-column').boundingBox())!;
    expect((await post.boundingBox())!.width).toBeCloseTo(column.width - 2, 0);
    const border = await page.locator('.lime-desktop-column').evaluate(el => getComputedStyle(el).borderLeftWidth);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    expect(await page.locator('.lime-desktop-column').evaluate(el => getComputedStyle(el).borderLeftColor)).toBe('rgb(47, 51, 54)');
    expect(await page.locator('.lime-desktop-column').evaluate(el => getComputedStyle(el).borderLeftWidth)).toBe(border);
    await page.goto('search');
    await page.evaluate(() => {
      const filler = document.createElement('div'); filler.style.height = '1800px';
      document.querySelector('.lime-desktop-main > div')!.append(filler);
      window.scrollTo(0, 400);
    });
    await expect(page.locator('[data-lime-search-bar]')).toHaveCSS('border-bottom-width', '0px');
    await expect.poll(() => page.locator('[data-lime-search-home-tabs]').evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(64);
    await page.goto('u/lime');
    const tabs = page.locator('[data-lime-profile-mobile-tabs]');
    await page.evaluate(() => {
      const filler = document.createElement('div'); filler.style.height = '1800px';
      document.querySelector('[data-lime-profile-posts]')!.append(filler);
    });
    await tabs.scrollIntoViewIfNeeded();
    for (const label of ['ポスト', 'メディア', 'いいね', 'リアクション']) {
      await tabs.getByRole('tab', { name: label, exact: true }).click();
      const active = tabs.locator('[data-state="active"]');
      await expect(active).toHaveText(label);
      const underline = tabs.locator('.profile-tabs-underline');
      await expect(underline).toBeVisible();
      await expect(underline).toHaveCSS('height', '4px');
      await expect(underline).toHaveCSS('background-color', 'rgb(236, 72, 153)');
      await expect.poll(async () => {
        const line = (await underline.boundingBox())!;
        const tab = (await active.boundingBox())!;
        return Math.abs(line.x + line.width / 2 - (tab.x + tab.width / 2));
      }).toBeLessThan(1);

    }
  });
}


test('desktop sticky surfaces reuse mobile blur and reply composer matches the reference', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('search');
  await expect(page.locator('[data-lime-search-header]')).toHaveCSS('backdrop-filter', 'blur(12px)');
  await expect(page.locator('[data-lime-search-bar]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[data-lime-search-home-tabs]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[data-lime-search-header] > [data-lime-search-bar]')).toBeVisible();
  await expect(page.locator('[data-lime-search-header] > [data-lime-search-home-tabs]')).toBeVisible();
  await page.goto('u/lime');
  await expect(page.locator('[data-lime-post-card]').first()).toBeVisible();
  await page.evaluate(() => {
    const filler = document.createElement('div'); filler.style.height = '1800px';
    document.querySelector('[data-lime-profile-posts]')!.append(filler); window.scrollTo(0, 600);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await expect(page.locator('[data-lime-profile-tabs-header]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[data-lime-profile-tabs-backdrop]')).toHaveCSS('backdrop-filter', 'blur(12px)');
  await page.goto('post/post-0');
  await expect(page.locator('.comment-form-desktop-reply')).toHaveCSS('border-radius', '0px');
  await expect(page.locator('.comment-form-desktop-reply-input')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const button = page.locator('.comment-form-desktop-reply-submit');
  await expect(button).toHaveText('返信'); await expect(button).toBeDisabled();
  await page.locator('.comment-form-desktop-reply-input').fill('返信欄の表示確認');
  await expect(button).toBeEnabled();
});

test('dark post composer keeps a visible surface and readable input on mobile and desktop', async ({page}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto('./');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const composer=page.locator('[data-lime-post-composer]').first();
    await expect(composer).toBeVisible();
    await expect.poll(() => composer.evaluate(el => {
      const color=getComputedStyle(el).backgroundColor;
      return color !== 'rgb(0, 0, 0)' && color !== 'rgba(0, 0, 0, 0)';
    })).toBe(true);
    await composer.locator('textarea').fill('ダークモードの投稿欄');
    const renderedText=composer.locator('div').filter({hasText:/^ダークモードの投稿欄$/}).last();
    await expect(renderedText).toBeVisible();
    await expect(renderedText).toHaveCSS('color','rgb(249, 250, 251)');
    await composer.screenshot({path:test.info().outputPath(`dark-composer-${width}.png`),animations:'disabled'});
  }
});


test('LimeAI uses a compact rail and profile reuses mobile cover controls and account footer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('chat');
  await expect(page.locator('[data-lime-sidebar-logo]')).toBeHidden();
  await expect(page.locator('[data-lime-app-header]')).toBeHidden();
  await expect(page.locator('[data-lime-desktop-sidebar] [data-lime-sidebar-item-label]').first()).toBeHidden();
  expect((await page.locator('.lime-desktop-menu').boundingBox())!.width).toBe(72);
  expect((await page.locator('.vpop-root').boundingBox())!.width).toBeGreaterThan(1300);
  const home = page.locator('[data-lime-desktop-sidebar]').getByRole('button', { name: 'ホーム', exact: true });
  await home.click(); await expect(page.locator('[data-lime-feed-root]')).toBeVisible();
  const logo = await page.locator('[data-lime-sidebar-logo] a').boundingBox();
  const icon = await home.locator('svg').boundingBox();
  expect(logo!.x).toBe(icon!.x);
  await expect(page.locator('[data-lime-sidebar-account]')).toContainText('@lime');
  expect((await page.locator('[data-lime-sidebar-account]').boundingBox())!.y).toBeGreaterThan(800);
  await page.goto('u/lime');
  await expect(page.locator('[data-lime-profile-cover-controls]').getByRole('button', { name: '戻る', exact: true })).toBeVisible();
  await expect(page.locator('[data-lime-profile-cover-controls]').getByRole('link', { name: '検索', exact: true })).toBeVisible();
});

test('verified account footer uses the profile badge in normal and compact sidebars', async ({ page }) => {
  await page.route('**/*.supabase.co/rest/v1/profiles*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...profile, is_official: true }) }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.locator('[data-lime-account-info] img[alt="Official"]')).toBeVisible();
  await page.goto('chat');
  await expect(page.locator('[data-lime-account-avatar-badge]')).toBeVisible();
});


test('desktop profile cover starts at the top without hidden element spacing', async ({ page }) => {
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('u/lime');
    const cover = page.locator('[data-lime-profile-header]');
    await expect(cover).toBeVisible();
    await expect.poll(async () => (await cover.boundingBox())!.y).toBe(0);
  }
});


test('desktop sidebar opens the existing App post overlay and submits a post', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/src/api/posts.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const createPost=async(args)=>{window.__submittedPost=args;return ${JSON.stringify(posts[0])}};
    export const getFeed=async()=>[];export const getFollowingFeed=async()=>[];
    export const getPostsByUser=async()=>[];export const getProfilePosts=async()=>[];export const getLikedPostsByUser=async()=>[];
    export const searchPosts=async()=>[];export const getPostById=async()=>(${JSON.stringify(posts[0])});
    export const toggleLike=async()=>({});export const toggleRepost=async()=>({});export const deletePost=async()=>{};export const getPostLikers=async()=>[];
  ` }));
  for (const path of ['search', 'chat', 'u/lime']) {
    await page.goto(path);
    await expect(page.locator('[data-lime-sidebar-compose]')).toBeVisible();
    await page.getByRole('button', { name: 'ポストする', exact: true }).click();
    const overlay = page.getByRole('dialog', { name: '新規ポスト' });
    await expect(overlay).toBeVisible();
    await overlay.locator('textarea').fill('サイドバーからの投稿');
    await overlay.getByRole('button', { name: 'ポスト', exact: true }).click();
    await expect(overlay).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __submittedPost?: { content: string } }).__submittedPost?.content)).toBe('サイドバーからの投稿');
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('./');
  await expect(page.locator('[data-lime-sidebar-compose]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新規投稿', exact: true })).toBeVisible();
});


for (const width of [390, 1440]) {
  test(`quote repost uses the existing composer in the correct overlay at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('./');
    const card = page.locator('[data-lime-post-card]').filter({ hasText: '画像付きの投稿' }).first();
    await card.getByRole('button', { name: 'リポスト', exact: true }).click();
    await page.getByRole('menuitem', { name: '引用リポスト', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '引用リポスト' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('textarea')).toBeVisible();
    await expect(dialog.getByText('画像付きの投稿', { exact: true })).toBeVisible();
    await expect(dialog.getByText('[画像あり]', {exact:true})).toHaveCount(0);
    const previewBox=(await dialog.locator('[data-lime-quote-preview]').boundingBox())!;
    expect(previewBox.height).toBeLessThan(300);
    await expect(dialog.locator('[data-lime-quoted-post] img[alt="投稿画像"]')).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    if (width < 768) {
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
      expect(bounds.width).toBe(width);
      expect(bounds.height).toBe(844);
    } else {
      const composer = (await dialog.locator('textarea').boundingBox())!;
      expect(composer.width).toBeLessThan(700);
      expect(composer.x).toBeGreaterThan(0);
    }
    await dialog.locator('textarea').fill('引用リポストのコメント');
    await dialog.getByRole('button', { name: '引用ポスト', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => (window as any).__lastCreatedPost)).toMatchObject({
      content: '引用リポストのコメント', parentId: 'post-0', isQuote: true,
    });
    await expect(card).toBeVisible();
  });
}


test('repost still works after visiting a profile with a nonzero activity count',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.route('**/rest/v1/rpc/get_profile_activity_count',route=>route.fulfill({contentType:'application/json',body:'3'}));
  await page.goto('u/lime');
  await expect(page.locator('[data-lime-profile-activity-count]')).toContainText('3');
  await page.locator('[data-lime-desktop-sidebar]').getByRole('button',{name:'ホーム',exact:true}).click();
  const card=page.locator('[data-lime-post-card]').filter({hasText:'画像付きの投稿'}).first();
  await card.getByRole('button',{name:'リポスト',exact:true}).click();
  await page.getByRole('menuitem',{name:'リポストする',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__repostRequests?.length)).toBe(1);
  await page.waitForLoadState('networkidle');
  await expect(card.getByRole('button',{name:'リポスト',exact:true})).toHaveText('1');
  await card.getByRole('button',{name:'リポスト',exact:true}).click();
  await page.getByRole('menuitem',{name:'リポストを取り消す',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__repostRequests?.length)).toBe(2);
  await expect(card.getByRole('button',{name:'リポスト',exact:true})).toHaveText('');
  await page.locator('[data-lime-desktop-sidebar]').getByRole('button',{name:'プロフィール',exact:true}).click();
  await expect(page.locator('[data-lime-profile-activity-count]')).toContainText('3');
});

test('normal repost appears only as a profile entry and can be undone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.evaluate(()=>{
    (window as any).__countAnimations=[];
    new MutationObserver(()=>document.querySelectorAll('.repost-count-old').forEach(el=>{const name=getComputedStyle(el).animationName;if(name!=='none')(window as any).__countAnimations.push(name);})).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  });
  const card = page.locator('[data-lime-post-card]').filter({ hasText: '画像付きの投稿' }).first();
  await card.getByRole('button', { name: 'リポスト', exact: true }).click();
  await page.getByRole('menuitem', { name: 'リポストする', exact: true }).click();
  await expect(card.getByRole('button', { name: 'リポスト', exact: true })).toHaveText('1');
  expect(await page.evaluate(()=>(window as any).__countAnimations)).toContain('repostCountOldUp');
  await expect(page.getByText('あなたがリポストしました', { exact: true })).toHaveCount(0);
  await page.locator('[data-lime-desktop-sidebar]').getByRole('button', { name: 'プロフィール', exact: true }).click();
  await expect(page.getByText('あなたがリポストしました', { exact: true })).toBeVisible();
  const profileCard = page.locator('[data-lime-post-card]').filter({ hasText: '画像付きの投稿' }).first();
  await expect(profileCard.locator('[data-lime-repost-label] svg')).toBeVisible();
  const label = (await profileCard.locator('[data-lime-repost-label] > span').last().boundingBox())!;
  const header = (await profileCard.locator('[data-lime-post-header]').boundingBox())!;
  expect(label.y).toBeLessThan(header.y);
  expect(Math.abs(label.x - header.x)).toBeLessThan(1);
  await profileCard.getByRole('button', { name: 'リポスト', exact: true }).click();
  await page.getByRole('menuitem', { name: 'リポストを取り消す', exact: true }).click();
  await expect(page.getByText('あなたがリポストしました', { exact: true })).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).__repostRequests)).toEqual(['post-0','post-0']);
});


for (const width of [390, 1440]) {
  test(`post detail keeps likes first and reposts second at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('post/post-0');
    const row = page.locator('.post-detail-mobile-action-row');
    await expect(row).toBeVisible();
    await expect(row.locator('.twitter-like-count-static')).toHaveText('');
    await expect(row.locator('[data-lime-post-action="repost"]')).toHaveText('');
    await expect(row.locator('.post-detail-mobile-reply-count')).toHaveText('');
    const buttons = row.locator('button');
    await expect(buttons.nth(0).locator('.twitter-like-heart')).toBeVisible();
    await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'リポスト');
    const likeBounds = (await buttons.nth(0).boundingBox())!;
    const repostBounds = (await buttons.nth(1).boundingBox())!;
    expect(repostBounds.height).toBe(likeBounds.height);
    expect(Math.abs(repostBounds.y - likeBounds.y)).toBeLessThan(1);
    const replyBounds=(await row.locator('.post-detail-mobile-reply-count').boundingBox())!;
    expect(Math.abs(likeBounds.width-repostBounds.width)).toBeLessThan(1);
    expect(Math.abs(repostBounds.width-replyBounds.width)).toBeLessThan(1);
    expect(replyBounds.height).toBe(likeBounds.height);
  });

  test(`quoted originals show a compact preview without action buttons at ${width}px`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    const original = posts[0];
    const quote = { ...posts[1], id: 'quote-0', content: '引用した側のコメント', isQuote: true, parentId: original.id, parentPost: original };
    await page.route('**/src/api/posts.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      const original=${JSON.stringify(original)};const quote=${JSON.stringify(quote)};quote.parentPost=original;
      export const getFeed=async()=>[quote,original,{...quote,id:'quote-two'}];export const getFollowingFeed=getFeed;
      export const getPostsByUser=getFeed;export const getProfilePosts=getFeed;export const getLikedPostsByUser=async()=>[];
      export const searchPosts=getFeed;export const getPostById=async(id)=>id==='quote-0'?quote:original;
      export const createPost=async()=>quote;export const toggleLike=async()=>({liked:true,likesCount:1});
      export const toggleRepost=async()=>{original.repostedByMe=true;original.repostsCount=1;return {reposted:true,repostsCount:1};};
      export const deletePost=async()=>{};export const getPostLikers=async()=>[];
    ` }));
    await page.goto('./');
    const quoted = page.locator('[data-lime-quoted-post]').first();
    await expect(quoted.locator('[data-lime-post-card]')).toBeVisible();
    await expect(quoted.locator('[data-lime-post-actions]')).toHaveCount(0);
    await expect(quoted.locator('[data-lime-post-header] button')).toHaveCount(0);
    const normalName = page.locator('[data-lime-post-card]:not([data-lime-embedded])').first().locator('[data-lime-post-header] span').first();
    const quoteName = quoted.locator('[data-lime-post-header] span').first();
    await expect(quoteName).toHaveCSS('font-size', await normalName.evaluate(el => getComputedStyle(el).fontSize));
    const bounds = (await quoted.boundingBox())!;
    const cardBounds = (await quoted.locator('[data-lime-post-card]').boundingBox())!;
    expect(cardBounds.width).toBeLessThanOrEqual(bounds.width);
    const imageBounds = (await quoted.locator('[data-lime-single-post-image]').boundingBox())!;
    expect(Math.abs(imageBounds.width - cardBounds.width)).toBeLessThan(3);
    expect(Math.abs(imageBounds.y + imageBounds.height - cardBounds.y - cardBounds.height)).toBeLessThan(1);
    await page.screenshot({ path: `artifacts/quote-layout-${width}.png`, fullPage: false });
    await quoted.getByText('画像付きの投稿', {exact: true}).click();
    await expect(page).toHaveURL(/post\/post-0$/);
    expect(pageErrors).toEqual([]);
  });
}


test.describe('mobile touch quote composer', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('opens from touch selection and accepts input after scrolling', async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const manyPosts = Array.from({length:80}, (_,i)=>({...posts[1],id:`touch-${i}`,content:`スクロールした投稿 ${i}`}));
    await page.route('**/src/api/posts.ts*', route => route.fulfill({contentType:'application/javascript',body:`
      const posts=${JSON.stringify(manyPosts)};
      export const getFeed=async()=>posts;export const getFollowingFeed=getFeed;export const getProfilePosts=getFeed;
      export const getPostsByUser=getFeed;export const getLikedPostsByUser=getFeed;export const searchPosts=getFeed;
      export const getPostById=async()=>posts[0];export const createPost=async()=>posts[0];
      export const toggleLike=async()=>({liked:true});export const toggleRepost=async()=>({reposted:true});
      export const deletePost=async()=>{};export const getPostLikers=async()=>[];
    `}));
    await page.goto('./');
    await expect(page.locator('[data-lime-post-card]').first()).toBeVisible();
    await page.evaluate(()=>window.scrollTo(0,6000));
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(3000);
    const card = page.locator('[data-lime-post-card]').last();
    await card.getByRole('button', {name:'リポスト',exact:true}).tap();
    await page.getByRole('menuitem', {name:'引用リポスト',exact:true}).tap();
    const dialog = page.getByRole('dialog',{name:'引用リポスト'});
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal','true');
    await dialog.locator('textarea').tap();
    await expect(dialog.locator('textarea')).toBeFocused();
    await expect(page.locator('body')).toHaveCSS('pointer-events','auto');
    await page.setViewportSize({width:390,height:500});
    await dialog.locator('textarea').pressSequentially('タッチで引用');
    await expect(dialog.locator('textarea')).toHaveValue('タッチで引用');
    const inputBounds=(await dialog.locator('textarea').boundingBox())!;
    expect(inputBounds.height).toBeGreaterThan(100);
    await dialog.getByRole('button',{name:'引用ポスト',exact:true}).tap();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/RaimuNoteSNS.github.io\/$/);
    expect(errors).toEqual([]);
  });
});

for (const width of [390,1440]) {
  test(`quoted image grids reach the card edges in posts and the composer at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    const original = {...posts[0],content:'複数画像の元投稿',imageUrls:[image,image]};
    const quote = {...posts[1],id:'media-quote',isQuote:true,parentId:original.id,parentPost:original};
    await page.route('**/src/api/posts.ts*', route => route.fulfill({contentType:'application/javascript',body:`
      const original=${JSON.stringify(original)},quote=${JSON.stringify(quote)};
      export const getFeed=async()=>[quote,original];export const getFollowingFeed=getFeed;
      export const getPostsByUser=getFeed;export const getProfilePosts=getFeed;export const getLikedPostsByUser=getFeed;
      export const searchPosts=getFeed;export const getPostById=async()=>original;
      export const createPost=async()=>quote;export const toggleLike=async()=>({liked:true});
      export const toggleRepost=async()=>({reposted:true});export const deletePost=async()=>{};export const getPostLikers=async()=>[];
    `}));
    await page.goto('./');
    async function checkGrid(container: ReturnType<typeof page.locator>) {
      const card=container.locator('[data-lime-embedded]').first();
      const grid=card.locator('[data-lime-post-image-grid]');
      await expect(grid.locator('img')).toHaveCount(2);
      await expect(grid).toHaveCSS('border-radius','0px');
      await expect(grid).toHaveCSS('border-bottom-width','0px');
      await expect.poll(()=>card.evaluate(card => {
        const cardBox=card.getBoundingClientRect();
        const gridBox=card.querySelector('[data-lime-post-image-grid]')!.getBoundingClientRect();
        return Math.max(Math.abs(gridBox.x-cardBox.x), Math.abs(gridBox.width-cardBox.width), Math.abs(gridBox.bottom-cardBox.bottom));
      })).toBeLessThan(1);
    }
    const quoted=page.locator('[data-lime-quoted-post]').first();
    await expect(quoted).toBeVisible();
    await checkGrid(quoted);
    await quoted.screenshot({path:`artifacts/quote-grid-${width}.png`,animations:'disabled'});
    const source=page.locator('[data-lime-post-card]:not([data-lime-embedded])').filter({hasNot:page.locator('[data-lime-quoted-post]')}).first();
    await source.getByRole('button',{name:'リポスト',exact:true}).click();
    await page.getByRole('menuitem',{name:'引用リポスト',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'引用リポスト'});
    await expect(dialog).toBeVisible();
    await checkGrid(dialog.locator('[data-lime-quoted-post]'));
    await expect(dialog.getByText('[画像あり]',{exact:true})).toHaveCount(0);
    await dialog.locator('[data-lime-quoted-post]').screenshot({path:`artifacts/quote-composer-grid-${width}.png`,animations:'disabled'});
  });
}

for (const width of [390,1440]) {
  test(`external posts expose local repost and quote actions at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:844});
    const external = {...posts[0], id:'bsky:at://did:plc:author/app.bsky.feed.post/original',userId:'did:plc:author',source:'bluesky',blueskyUri:'at://did:plc:author/app.bsky.feed.post/original',blueskyUrl:'https://bsky.app/profile/author.bsky.social/post/original',content:'外部の引用元',author:{...user,id:'did:plc:author',username:'author.bsky.social'}};
    await page.route('**/src/api/posts.ts*', route=>route.fulfill({contentType:'application/javascript',body:`
      const post=${JSON.stringify(external)};
      export const getFeed=async()=>[post];export const getFollowingFeed=getFeed;
      export const getPostsByUser=getFeed;export const getProfilePosts=getFeed;export const getLikedPostsByUser=getFeed;
      export const searchPosts=getFeed;export const getPostById=async()=>post;
      export const createPost=async(input)=>{window.__lastCreatedPost=input;return {...post,id:'created-quote'};};
      export const toggleLike=async()=>({liked:true});export const toggleRepost=async()=>({reposted:true,repostsCount:1});
      export const deletePost=async()=>{};export const getPostLikers=async()=>[];
    `}));
    await page.goto('./');
    const repost=page.getByRole('button',{name:'リポスト',exact:true});
    await expect(repost).toBeVisible();
    await expect(repost).toHaveText('');
    const externalCard=page.locator('[data-lime-post-card]').first();
    await expect(externalCard.locator('svg.lucide-plus')).toHaveCount(0);
    await expect(externalCard.locator('svg.lucide-heart').locator('..')).toHaveText('');
    await expect(externalCard.locator('svg.lucide-message-circle').locator('..')).toHaveText('');
    await repost.click();
    await expect(page.getByRole('menuitem',{name:'リポストする',exact:true})).toBeEnabled();
    await page.getByRole('menuitem',{name:'引用リポスト',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'引用リポスト'});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('外部の引用元',{exact:true})).toBeVisible();
    await dialog.locator('textarea').fill('外部投稿へのコメント');
    await dialog.getByRole('button',{name:'引用ポスト',exact:true}).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(()=>(window as any).__lastCreatedPost)).toMatchObject({parentId:external.id,isQuote:true,content:'外部投稿へのコメント'});
  });
}

for (const width of [390,1440]) {
  test(`profile reply and its source both support repost; shared reply keeps recipient and media at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:844});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const reply={id:'22222222-2222-2222-2222-222222222222',post_id:'post-0',user_id:user.id,content:'プロフィールの返信本文',created_at:'2026-10-03T00:00:00Z',image_urls:[image],likes_count:0,parent_comment_id:null,profiles:profile,post:{user_id:user.id,profiles:{username:'lime'}},replying_to:null};
    let shared=false;
    await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
      import {toggleReplyRepost,getProfileReplyReposts,getReplyPost} from '/RaimuNoteSNS.github.io/src/api/reply-reposts.ts';
      const posts=${JSON.stringify(posts)};
      export const getFeed=async()=>posts;export const getFollowingFeed=async()=>posts;export const getPostsByUser=async()=>posts;
      export const getProfilePosts=async()=>[...posts,...await getProfileReplyReposts('${user.id}',10)];
      export const getLikedPostsByUser=async()=>[];export const searchPosts=async()=>posts;
      export const getPostById=async(id)=>id.startsWith('reply:')?getReplyPost(id):posts[0];
      export const createPost=async(input)=>{window.__lastCreatedPost=input;return posts[0];};export const toggleLike=async()=>({liked:true,likesCount:1});
      export const toggleRepost=async(id)=>id.startsWith('reply:')?toggleReplyRepost(id):({reposted:true,repostsCount:1});
      export const deletePost=async()=>{};export const getPostLikers=async()=>[];` }));
    await page.route('**/*.supabase.co/rest/v1/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname.endsWith('/comments')) return route.fulfill({contentType:'application/json',body:JSON.stringify(request.headers().accept?.includes('vnd.pgrst.object')?reply:[reply])});
      if(url.pathname.endsWith('/reply_reposts')) {
        if(request.method()==='POST'){shared=true;return route.fulfill({status:201,body:''});}
        if(request.method()==='DELETE'){shared=false;return route.fulfill({status:204,body:''});}
        if(request.method()==='HEAD') return route.fulfill({headers:{'content-range':`*/${shared?1:0}`,'access-control-expose-headers':'content-range'},body:''});
        const embedded=url.searchParams.get('select')?.includes('comments!inner');
        return route.fulfill({contentType:'application/json',body:JSON.stringify(embedded?(shared?[{created_at:'2026-10-03T01:00:00Z',comments:reply}]:[]):(shared?{comment_id:reply.id}:null))});
      }
      if(url.pathname.endsWith('/posts') && request.method()==='HEAD') return route.fulfill({headers:{'content-range':'*/0','access-control-expose-headers':'content-range'},body:''});
      return route.fallback();
    });
    await page.goto('u/lime');
    const thread=page.locator('.profile-reply-thread');
    await expect(thread).toContainText(reply.content);
    await expect(thread.getByRole('button',{name:'リポスト',exact:true})).toHaveCount(2);
    const replyButton=thread.getByRole('button',{name:'リポスト',exact:true}).last();
    await replyButton.click();await page.getByRole('menuitem',{name:'リポストする',exact:true}).click();
    const sharedCard=page.locator(`[data-lime-comment-card="${reply.id}"]`).filter({hasText:'あなたがリポストしました'});
    await expect(sharedCard).toBeVisible();
    await expect(sharedCard).toContainText('返信先: @limeさん');
    await expect(sharedCard).toContainText(reply.content);
    await expect(sharedCard).not.toContainText('画像付きの投稿');
    await expect(sharedCard.locator('img[alt="返信画像"]')).toBeVisible();
    await expect(sharedCard.getByRole('button',{name:'リポスト',exact:true})).toHaveText('1');
    await sharedCard.screenshot({path:`artifacts/reposted-reply-${width}.png`,animations:'disabled'});
    const label=(await sharedCard.locator('[data-lime-repost-label] > span').last().boundingBox())!;
    const header=(await sharedCard.locator('[data-lime-post-header]').boundingBox())!;
    expect(label.y).toBeLessThan(header.y);expect(Math.abs(label.x-header.x)).toBeLessThan(1);
    await sharedCard.getByRole('button',{name:'リポスト',exact:true}).click();
    await page.getByRole('menuitem',{name:'引用リポスト',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'引用リポスト'});
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-lime-quoted-post]')).toContainText('返信先: @limeさん');
    await expect(dialog.locator('[data-lime-quoted-post] [data-lime-post-action]')).toHaveCount(0);
    await dialog.locator('textarea').fill('返信を引用');
    await dialog.getByRole('button',{name:'引用ポスト',exact:true}).click();
    expect(await page.evaluate(()=>(window as any).__lastCreatedPost)).toMatchObject({parentId:`reply:${reply.id}`,content:'返信を引用',isQuote:true});
    await sharedCard.getByRole('button',{name:'リポスト',exact:true}).click();
    await page.getByRole('menuitem',{name:'リポストを取り消す',exact:true}).click();
    await expect(sharedCard).toHaveCount(0);
    expect(shared).toBe(false);expect(errors).toEqual([]);
  });
}

test('news history animates every time it opens from the search news page',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/*.supabase.co/rest/v1/news_summaries*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([
    {id:'latest',title:'最新のニュース',content:'最新の本文',created_at:'2026-10-03T00:00:00Z'},
    {id:'older',title:'過去の記事',content:'過去の本文',created_at:'2026-10-02T00:00:00Z'}
  ])}));
  await page.goto('search');
  await page.getByText('最新のニュース',{exact:true}).click();
  await expect(page).toHaveURL(/\/news(?:\?story=latest)?$/);
  for(let i=0;i<2;i++) {
    await page.getByRole('button',{name:'ニュースのメニュー',exact:true}).click();
    await page.getByRole('menuitem',{name:'トレンド履歴',exact:true}).click();
    const history=page.locator('[data-lime-news-history]');
    await expect(history).toContainText('過去の記事');
    expect(await history.evaluate(el=>({name:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration}))).toEqual({name:'newsHistoryEnter',duration:'0.3s'});
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'ニュースに戻る',exact:true}).click();await expect(history).toHaveCount(0);
  }
});

for (const width of [390,1440]) {
  test(`replies remain visible in posts, nested threads and profiles after adding reposts at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const root={id:'33333333-3333-3333-3333-333333333333',post_id:'post-0',user_id:user.id,content:'復旧した通常の返信',created_at:'2026-10-03T00:00:00Z',likes_count:0,image_urls:[],parent_comment_id:null,profiles:profile};
    const child={...root,id:'44444444-4444-4444-4444-444444444444',content:'復旧した返信への返信',parent_comment_id:root.id};
    const selects:string[]=[];
    await page.route('**/*.supabase.co/rest/v1/comments*',route=>{
      const select=new URL(route.request().url()).searchParams.get('select') ?? '';
      selects.push(select);
      // Reproduce the ambiguous author embed introduced by a share join table.
      if(select.includes('profiles(*)')) return route.fulfill({status:300,contentType:'application/json',body:JSON.stringify({code:'PGRST201',message:'Ambiguous comments/profiles relationship'})});
      return route.fulfill({contentType:'application/json',body:JSON.stringify([root,child])});
    });
    await page.goto('post/post-0');
    await expect(page.locator(`[data-lime-comment-card="${root.id}"]`)).toContainText(root.content);
    await page.goto(`post/post-0?reply=${child.id}`);
    await expect(page.locator('[data-lime-reply-chain]')).toContainText(root.content);
    await expect(page.locator('[data-lime-selected-reply]')).toContainText(child.content);
    await page.goto('u/lime');
    const profileThread=page.locator('.profile-reply-thread').filter({hasText:child.content}).first();
    await expect(profileThread).toContainText(root.content);
    await expect(profileThread).toContainText(child.content);
    expect(selects).toContain('*,profiles:profiles!comments_user_id_fkey(*)');
    expect(errors).toEqual([]);
  });
}

for(const width of [320,390,768,1024,1440]) {
  test(`recommended tab mixes services and prioritizes the viewer interests at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const candidates=[{...posts[0],id:'cat-lime',content:'猫の写真を投稿しました',imageUrls:[]},{...posts[1],id:'sports-lime',content:'サッカー速報',likesCount:50000}];
    await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const posts=${JSON.stringify(candidates)};
      export const getFeed=async()=>posts;export const getFollowingFeed=async()=>[posts[1]];export const getPostsByUser=getFeed;export const getProfilePosts=getFeed;export const getLikedPostsByUser=getFeed;export const searchPosts=getFeed;export const getPostById=async()=>posts[0];export const createPost=async()=>posts[0];export const toggleLike=async()=>({liked:true});export const toggleRepost=async()=>({reposted:true});export const deletePost=async()=>{};export const getPostLikers=async()=>[];`}));
    await page.route('**/*.supabase.co/rest/v1/likes*',route=>{
      const select=new URL(route.request().url()).searchParams.get('select') ?? '';
      if(select.includes('posts:post_id(')) return route.fulfill({contentType:'application/json',body:JSON.stringify([{posts:{user_id:'cat-author',content:'猫の写真が好きです'}}])});
      return route.fallback();
    });
    await page.route('**/public.api.bsky.app/**',route=>{
      if(!route.request().url().includes('searchPosts')) return route.fulfill({contentType:'application/json',body:JSON.stringify({posts:[],feed:[],actors:[]})});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({posts:[{
        uri:'at://did:plc:cats/app.bsky.feed.post/cat',cid:'cat-cid',author:{did:'did:plc:cats',handle:'cats.bsky.social',displayName:'Cats'},
        record:{$type:'app.bsky.feed.post',text:'猫の写真をBlueskyから',createdAt:new Date().toISOString(),langs:['ja']},likeCount:1000,replyCount:0
      }]})});
    });
    await page.goto('./');
    const visibleTabs=page.getByRole('tab');
    await expect(visibleTabs).toHaveText(['最新','フォロー中','おすすめ','トレンド']);
    expect(await visibleTabs.evaluateAll(tabs=>tabs.every(tab=>{const label=tab.querySelector('span');return !label || label.getBoundingClientRect().width<=tab.getBoundingClientRect().width;}))).toBe(true);
    await page.getByRole('tab',{name:'おすすめ',exact:true}).click();
    await expect(page.getByRole('tab',{name:'おすすめ',exact:true})).toHaveAttribute('data-state','active');
    const cards=page.locator('[data-lime-post-card]');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('猫の写真');
    await expect(page.getByText('猫の写真をBlueskyから',{exact:true})).toBeVisible();
    await expect(page.getByText('猫の写真を投稿しました',{exact:true})).toBeVisible();
    await expect(cards.last()).toContainText('サッカー速報');
    await page.getByRole('tab',{name:'フォロー中',exact:true}).click();
    await expect(cards).toHaveCount(1);await expect(cards).toContainText('サッカー速報');
    await page.getByRole('tab',{name:'おすすめ',exact:true}).click();
    await expect(cards).toHaveCount(3);
    await page.reload();
    await expect(page.getByRole('tab',{name:'おすすめ',exact:true})).toHaveAttribute('data-state','active');
    await expect(cards).toHaveCount(3);
    expect(await visibleTabs.evaluateAll(tabs=>tabs.every(tab=>{const bounds=tab.getBoundingClientRect();return bounds.left>=0 && bounds.right<=innerWidth;}))).toBe(true);
    if(width>=390) expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

for(const width of [390,1440]) {
  test(`recommendation scoring discovers low-like relevant posts beyond the popular pool at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const cat={...posts[0],id:'niche-lime-cat',userId:'22222222-2222-2222-2222-222222222222',content:'猫の写真。まだいいねゼロのLimeNote投稿',imageUrls:[],likesCount:0,author:{...user,id:'22222222-2222-2222-2222-222222222222'}};
    const sport={...posts[1],id:'general-sport',content:'サッカー速報。一般的な人気投稿',likesCount:50000};
    await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const cat=${JSON.stringify(cat)},sport=${JSON.stringify(sport)};
      export const getFeed=async()=>[sport];export const getFollowingFeed=getFeed;export const getPostsByUser=async()=>[];export const getProfilePosts=getFeed;export const getLikedPostsByUser=getFeed;
      export const searchPosts=async(query)=>{window.__recommendationTopics=[...(window.__recommendationTopics??[]),query];return query==='猫'||query==='写真'?[cat]:[];};
      export const getPostById=async()=>cat;export const createPost=async()=>cat;export const toggleLike=async()=>({liked:true});export const toggleRepost=async()=>({reposted:true});export const deletePost=async()=>{};export const getPostLikers=async()=>[];`}));
    await page.route('**/*.supabase.co/rest/v1/likes*',route=>{
      const select=new URL(route.request().url()).searchParams.get('select') ?? '';
      if(select.includes('posts:post_id(')) return route.fulfill({contentType:'application/json',body:JSON.stringify([{created_at:new Date().toISOString(),posts:{user_id:cat.userId,content:'猫の写真'}}])});
      return route.fallback();
    });
    await page.route('**/public.api.bsky.app/**',route=>{
      const url=new URL(route.request().url());
      if(!url.pathname.endsWith('searchPosts')) return route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'});
      const relevant=['猫','写真'].includes(url.searchParams.get('q') ?? '');
      return route.fulfill({contentType:'application/json',body:JSON.stringify({posts:[{
        uri:`at://did:plc:${relevant?'cats':'sport'}/app.bsky.feed.post/fixture`,cid:'cid',author:{did:`did:plc:${relevant?'cats':'sport'}`,handle:`${relevant?'cats':'sport'}.bsky.social`,displayName:relevant?'Cats':'Sports'},
        record:{$type:'app.bsky.feed.post',text:relevant?'猫の写真。まだいいねゼロのBluesky投稿':'サッカー速報の人気Bluesky投稿',createdAt:new Date().toISOString(),langs:['ja']},likeCount:relevant?0:100000,replyCount:0
      }]})});
    });
    await page.goto('./');await page.getByRole('tab',{name:'おすすめ',exact:true}).click();
    const cards=page.locator('[data-lime-post-card]');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('猫の写真');await expect(cards.nth(1)).toContainText('猫の写真');
    await expect(page.getByText('猫の写真。まだいいねゼロのBluesky投稿',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>(window as any).__recommendationTopics)).toContain('猫');
    await expect.poll(()=>page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('lime_recommendation_impressions:11111111-1111-1111-1111-111111111111') ?? '{}')).length)).toBeGreaterThan(0);
    await page.getByRole('tab',{name:'最新',exact:true}).click();
    await expect(cards).toHaveCount(1);await expect(cards).toContainText('一般的な人気投稿');
  });
}

for (const width of [390,1440]) {
  test(`profile shows the aggregate activity count after followers at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/*.supabase.co/rest/v1/rpc/get_profile_activity_count',route=>route.fulfill({contentType:'application/json',body:'15'}));
    await page.goto('./u/lime');
    const count=page.locator('[data-lime-profile-activity-count]');
    await expect(count).toHaveText('15投稿');
    const follower=page.getByRole('link',{name:/フォロワー/}).first();
    const followerBounds=await follower.boundingBox(),countBounds=await count.boundingBox();
    expect(countBounds!.x).toBeGreaterThan(followerBounds!.x);
    expect(Math.abs(countBounds!.y-followerBounds!.y)).toBeLessThan(5);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
  test(`recommendations exclude liked and three-times-viewed posts across reloads at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/*.supabase.co/rest/v1/likes*',route=>{
      const url=new URL(route.request().url());
      if((url.searchParams.get('select') ?? '').includes('posts:post_id(')) return route.fulfill({contentType:'application/json',body:JSON.stringify([{created_at:new Date().toISOString(),posts:{id:'post-1',user_id:user.id,content:'フォロー中の投稿'}}])});
      if(url.searchParams.get('post_id')==='eq.post-1' && (route.request().headers().accept ?? '').includes('vnd.pgrst.object')) return route.fulfill({contentType:'application/json',body:JSON.stringify({user_id:user.id})});
      return route.fallback();
    });
    await page.addInitScript(({viewerId})=>{
      const key=`lime_recommendation_impressions:${viewerId}`;
      if(!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify({'post-0':{at:Date.now(),count:3}}));
      localStorage.setItem(`lime_recommendation_likes:${viewerId}`,JSON.stringify([{id:'post-1',content:'テスト投稿 1'}]));
    },{viewerId:user.id});
    await page.goto('./');
    await page.getByRole('tab',{name:'おすすめ',exact:true}).click();
    await expect(page.getByRole('tab',{name:'おすすめ',exact:true})).toHaveAttribute('data-state','active');
    await expect(page.getByText('画像付きの投稿',{exact:true})).toHaveCount(0);
    await expect(page.getByText('フォロー中の投稿',{exact:true})).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('tab',{name:'おすすめ',exact:true})).toHaveAttribute('data-state','active');
    await expect(page.locator('[data-lime-post-card]')).toHaveCount(0);
  });
}

for(const width of [390,1440]) {
  test(`freeform profile location saves, survives reload and can be cleared at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/src/lib/supabase.ts*',async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text())+`\nsupabase.auth.getUser=async()=>({data:{user:{id:'${user.id}'}},error:null});`});
    });
    let location='';
    const patches:Record<string,unknown>[]=[];
    await page.route('**/*.supabase.co/rest/v1/profiles*',route=>{
      if(route.request().method()==='PATCH') {const patch=route.request().postDataJSON();patches.push(patch);if('location' in patch) location=patch.location;}
      const row={...profile,location};
      const single=(route.request().headers().accept ?? '').includes('vnd.pgrst.object');
      return route.fulfill({contentType:'application/json',body:JSON.stringify(single?row:[row])});
    });
    await page.route('**/*.supabase.co/rest/v1/rpc/get_profile_activity_count',route=>route.fulfill({contentType:'application/json',body:'15'}));
    await page.goto('./u/lime');
    await expect(page.locator('[data-lime-profile-activity-count]')).toHaveText('15投稿');
    await expect(page.locator('[data-lime-profile-location]')).toHaveCount(0);
    await page.goto('./settings');
    await page.getByLabel('場所',{exact:true}).fill('ホットプレート');
    await page.getByRole('button',{name:'保存する',exact:true}).click();
    await expect.poll(()=>patches.at(-1)?.location).toBe('ホットプレート');
    await page.goto('./u/lime');
    const field=page.locator('[data-lime-profile-location]');
    await expect(field).toHaveText('ホットプレート');
    await expect(field.locator('svg.lucide-map-pin')).toBeVisible();
    await expect(field.locator('script')).toHaveCount(0);
    const joined=page.getByText('2026年10月 から参加',{exact:true});
    await expect(joined).toBeVisible();
    const joinedBox=await joined.boundingBox(),locationBox=await field.boundingBox();
    expect(locationBox!.x).toBeGreaterThan(joinedBox!.x);
    expect(Math.abs(locationBox!.y-joinedBox!.y)).toBeLessThan(5);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.reload();await expect(field).toHaveText('ホットプレート');
    await page.goto('./settings');
    await expect(page.getByLabel('場所',{exact:true})).toHaveValue('ホットプレート');
    await page.getByLabel('場所',{exact:true}).fill('ホットプレート <script>text</script>');
    await page.getByRole('button',{name:'保存する',exact:true}).click();
    await expect.poll(()=>patches.at(-1)?.location).toBe('ホットプレート <script>text</script>');
    await page.goto('./u/lime');
    await expect(field).toHaveText('ホットプレート <script>text</script>');
    await expect(field.locator('script')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.goto('./settings');
    await expect(page.getByLabel('場所',{exact:true})).toHaveValue('ホットプレート <script>text</script>');
    await page.getByLabel('場所',{exact:true}).fill('');
    await page.getByRole('button',{name:'保存する',exact:true}).click();
    await expect.poll(()=>patches.at(-1)?.location).toBe('');
    await page.goto('./u/lime');
    await expect(page.locator('[data-lime-profile-location]')).toHaveCount(0);
  });
}

test('iPad sidebar survives scrolling, route changes and narrow viewport transitions',async({page},info)=>{
 test.skip(!info.project.name.startsWith('iPad'),'iPad touch viewport');
 await page.goto('./');
 for(const width of [820,1180,744,700,620,820]){
  await page.setViewportSize({width,height:900});
  if(width>=640){
   const sidebar=page.locator('[data-lime-desktop-sidebar]');await expect(sidebar).toBeVisible();
   await expect(sidebar.getByRole('button',{name:'ホーム',exact:true})).toBeVisible();
   await page.evaluate(()=>{const filler=document.createElement('div');filler.style.height='3000px';document.querySelector('main').append(filler);window.scrollTo(0,800);});
   await expect.poll(()=>page.evaluate(()=>{window.scrollTo(0,800);return scrollY;})).toBeGreaterThan(500);
   await expect(sidebar.getByRole('button',{name:'ホーム',exact:true})).toBeInViewport();
   // OS UI changes height/focus without changing the application's column layout.
   await page.setViewportSize({width,height:720});
   await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});
   await expect(sidebar).toBeVisible();await expect(page.locator('.lime-desktop-discover')).toBeVisible();
   expect((await page.locator('.lime-desktop-menu').boundingBox())!.width).toBe(72);
   await page.setViewportSize({width,height:900});
   await sidebar.getByRole('button',{name:'検索',exact:true}).click();
   await expect(sidebar).toBeVisible();await expect(page.locator('.lime-desktop-discover')).toBeVisible();
   await sidebar.getByRole('button',{name:'ホーム',exact:true}).click();
  }else{
   await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
   await expect(page.locator('[data-lime-mobile-sidebar]').getByRole('button',{name:'設定',exact:true})).toBeVisible();
  }
 }
});

test('account export is above logout and always requests a password',async({page})=>{
 await page.goto('settings');
 const exportButton=page.getByRole('button',{name:'データをエクスポート',exact:true});
 await expect(exportButton).toBeVisible();
 const logout=page.getByRole('button',{name:'ログアウト',exact:true}).last();
 expect((await exportButton.boundingBox())!.y).toBeLessThan((await logout.boundingBox())!.y);
 await exportButton.click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 const input=dialog.getByLabel('パスワードを入力してください');await expect(input).toHaveAttribute('type','password');
 await expect(dialog.getByRole('button',{name:'確認してダウンロード'})).toBeDisabled();
 await input.fill('not-a-real-password');await expect(dialog.getByRole('button',{name:'確認してダウンロード'})).toBeEnabled();
});

test('offline export browses posts replies attachments and history without any network',async({page,context})=>{
 await page.goto('./');
 const html=await page.evaluate(async()=>{const module=await import('/RaimuNoteSNS.github.io/src/lib/accountExport.ts');return module.offlineArchiveHtml();});
 const archive={version:1,userId:user.id,createdAt:user.createdAt,tables:{profiles:[profile],posts:[{id:'own-post',user_id:user.id,content:'保存したポスト [[stamp:cat]] <script>window.bad=true</script>',image_urls:['https://asset.test/picture.png'],created_at:user.createdAt}],comments:[{id:'reply',post_id:'own-post',user_id:user.id,content:'オフラインで返信を閲覧',created_at:user.createdAt}],bookmarks:[{post_id:'own-post'}],custom_emojis:[{id:'cat',name:'cat',public_id:'cat',format:'png'}],profile_pins:[{post_id:'own-post'}],chat_sessions:[{id:'chat',title:'保存したチャット',messages:[{role:'user',content:'過去の会話'}]}]},related:{},local:{'search:recent':['猫']},assets:{'https://asset.test/picture.png':'assets/picture.svg','https://res.cloudinary.com/dveiikhhw/image/upload/custom_emojis/cat.png':'assets/picture.svg'}};
 let unexpected=0;
 await page.route('https://archive.test/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill(path==='/index.html'?{contentType:'text/html',body:html}:path==='/data.js'?{contentType:'text/javascript',body:`window.LIME_ARCHIVE=${JSON.stringify(archive).replace(/</g,'\\u003c')};`}:{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="pink"/></svg>'});});
 await page.route('https://asset.test/**',route=>{unexpected++;return route.abort();});
 await context.setOffline(true);await page.goto('https://archive.test/index.html');
 await expect(page.getByText('固定されたポスト',{exact:false})).toBeVisible();
 await expect(page.locator('img.stamp')).toBeVisible();await expect(page.locator('.photos img')).toBeVisible();
 await page.getByRole('button',{name:'返信 1',exact:true}).click();await expect(page.getByText('オフラインで返信を閲覧',{exact:true})).toBeVisible();
 await page.locator('#more-nav').click();await page.locator('#details').getByRole('button',{name:'ブックマーク',exact:true}).click();await expect(page.locator('article')).toHaveCount(1);
 await page.getByRole('button',{name:'LimeAI',exact:true}).click();await expect(page.getByText('過去の会話',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'履歴・設定',exact:true}).click();await expect(page.getByText('検索履歴',{exact:true}).first()).toBeVisible();
 expect(await page.evaluate(()=>Boolean((window as any).bad))).toBe(false);expect(unexpected).toBe(0);
});

test('export viewer opens directly from local files with its adjacent data script',async({page})=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {pathToFileURL}=await import('node:url');
 await page.goto('./');const html=await page.evaluate(async()=>{const module=await import('/RaimuNoteSNS.github.io/src/lib/accountExport.ts');return module.offlineArchiveHtml();});
 const folder=await mkdtemp(join(tmpdir(),'lime-export-viewer-'));
 try {
  await writeFile(join(folder,'index.html'),html);await writeFile(join(folder,'data.js'),`window.LIME_ARCHIVE=${JSON.stringify({userId:user.id,createdAt:user.createdAt,tables:{profiles:[profile],posts:[{id:'local-file-post',user_id:user.id,content:'展開したファイルを直接閲覧',created_at:user.createdAt}]},related:{},assets:{},local:{}})};`);
  await page.goto(pathToFileURL(join(folder,'index.html')).href);
  await expect(page.getByText('展開したファイルを直接閲覧',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:profile.display_name,exact:true,level:1})).toBeVisible();
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('development PWA worker endpoint serves JavaScript rather than the application HTML',async({request})=>{
 const response=await request.get('dev-sw.js?dev-sw');
 expect(response.status()).toBe(200);expect(response.headers()['content-type']).toMatch(/(?:java|ecma)script/i);
 expect(await response.text()).not.toMatch(/<!doctype html>/i);
});

test('account export caches ZIP only on device, verifies every reuse, and expires after seven days',async({page})=>{
 await page.goto('./');
 const actions:string[]=[];let deny=false;let directImages=0;let uploads=0;
 const imageUrl='https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:example/image';
 await page.route('**/functions/v1/account-export',route=>{
  const input=route.request().postDataJSON();actions.push(input.action);
  if(deny)return route.fulfill({status:403,json:{error:'パスワードが正しくありません'}});
  if(input.action==='verify')return route.fulfill({json:{verified:true,userId:user.id}});
  const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+7*86400000).toISOString();
  return route.fulfill({json:{userId:user.id,createdAt,expiresAt,snapshot:{version:1,userId:user.id,createdAt,expiresAt,account:{},tables:{posts:[{id:'export-post',content:'保存用の画像',image_urls:[imageUrl]}]},related:{},uploads:[],unavailable:[]}}});
 });
 await page.route('**/functions/v1/link-preview',route=>route.request().postDataJSON()?.mode==='image'?route.fulfill({contentType:'application/octet-stream',headers:{'X-Lime-Image-Type':'image/png','Access-Control-Expose-Headers':'X-Lime-Image-Type'},body:Buffer.from('local-image-bytes')}):route.fulfill({json:{preview:null}}));
 await page.route('https://cdn.bsky.app/**',route=>{directImages++;return route.abort();});
 page.on('request',request=>{if(/\/storage\/v1\//.test(request.url())&&['POST','PUT'].includes(request.method()))uploads++;});
 await page.evaluate(async(id)=>{
  const {supabase}=await import('/RaimuNoteSNS.github.io/src/lib/supabase.ts');
  supabase.auth.getSession=async()=>({data:{session:{user:{id},access_token:'test-session'}},error:null}) as any;
 },user.id);
 const generate=()=>page.evaluate(async(id)=>{
  const module=await import('/RaimuNoteSNS.github.io/src/lib/accountExport.ts');
  const result=await module.createAccountExport(id,'confirmation',()=>{},new AbortController().signal);
  return {cached:result.cached,expiresAt:result.expiresAt,warning:result.cacheWarning,zipBytes:new TextDecoder().decode(await result.zip.arrayBuffer())};
 },user.id);
 const first=await generate();expect(first.cached).toBe(false);expect(first.warning).toBeUndefined();expect(first.zipBytes).toContain('local-image-bytes');expect(first.zipBytes).toMatch(/assets\/media-\d+\.png/);
 const second=await generate();expect(second.cached).toBe(true);expect(second.expiresAt).toBe(first.expiresAt);expect(second.zipBytes).toBe(first.zipBytes);expect(actions).toEqual(['collect','verify']);
 deny=true;await expect(generate()).rejects.toThrow('パスワードが正しくありません');deny=false;
 await page.evaluate(async(id)=>{
  const module=await import('/RaimuNoteSNS.github.io/src/lib/accountExport.ts');const saved=await module.localAccountExport(id);
  await module.localAccountExport(id,{...saved!,expiresAt:new Date(Date.now()-1).toISOString()});
 },user.id);
 expect((await generate()).cached).toBe(false);expect(actions).toEqual(['collect','verify','verify','collect']);expect(uploads).toBe(0);expect(directImages).toBe(0);
 await page.goto('./settings');
 await page.evaluate(async(id)=>{
  const {supabase}=await import('/RaimuNoteSNS.github.io/src/lib/supabase.ts');
  supabase.auth.getSession=async()=>({data:{session:{user:{id},access_token:'test-session'}},error:null}) as any;
 },user.id);
 await page.getByRole('button',{name:'データをエクスポート',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('パスワードを入力してください').fill('confirmation');
 const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'確認してダウンロード'}).click();
 const download=await downloadPromise;expect(download.suggestedFilename()).toBe('LimeNote-export.zip');
 const {readFile}=await import('node:fs/promises');const bytes=await readFile((await download.path())!);
 expect(bytes.readUInt32LE(0)).toBe(0x04034b50);expect(bytes.toString()).toContain('local-image-bytes');expect(actions.at(-1)).toBe('verify');expect(uploads).toBe(0);
});

for(const width of [390,820,1440])test(`offline LimeNote iPad keeps private spaces and a stable layout at ${width}px`,async({page,context},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('./');
 const html=await page.evaluate(async()=>{const m=await import('/RaimuNoteSNS.github.io/src/lib/accountExport.ts');return m.offlineArchiveHtml();});
 const localImage='assets/picture.svg';const url='https://asset.test/picture.png';
 const archive={userId:user.id,createdAt:user.createdAt,tables:{profiles:[{...profile,display_name:'長い名前のLimeNoteユーザー',bio:'保存したプロフィールです。',cover_url:url}],posts:[{id:'main',user_id:user.id,content:'本文とスタンプ [[emoji:cat]] と長いURL https://example.com/'+('long-path-'.repeat(14)),image_urls:[url],created_at:user.createdAt},{id:'quoted',user_id:user.id,content:'引用したポスト',parent_id:'main',created_at:user.createdAt}],profile_pins:[{post_id:'main'}],comments:[{id:'first',user_id:user.id,post_id:'main',content:'親ポストへの返信',created_at:user.createdAt},{id:'nested',user_id:user.id,post_id:'main',parent_comment_id:'first',content:'返信への返信',created_at:user.createdAt}],spaces:[{id:'mine',host_id:user.id,title:'自分が作成したスペース',created_at:user.createdAt,is_active:false,heartbeat_at:'INTERNAL_HEARTBEAT'},{id:'other',host_id:'another-user',title:'他人のスペースをコピーしない',heartbeat_at:'PRIVATE_LOG'}],custom_emojis:[{id:'cat',name:'cat',public_id:'cat',format:'png'}]},related:{spaces:[{id:'joined',host_id:'another-user',title:'参加した他人のスペース'}]},local:{theme:'light','search:recent':['猫']},assets:{[url]:localImage,'https://res.cloudinary.com/dveiikhhw/image/upload/custom_emojis/cat.png':localImage}};
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const {mkdtemp,writeFile,mkdir,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {pathToFileURL}=await import('node:url');
 const folder=await mkdtemp(join(tmpdir(),'lime-offline-layout-'));
 try{
 await mkdir(join(folder,'assets'));await writeFile(join(folder,'index.html'),html);await writeFile(join(folder,'data.js'),'window.LIME_ARCHIVE='+JSON.stringify(archive)+';');
 await writeFile(join(folder,'assets','picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#f7dce7"/><circle cx="400" cy="240" r="140" fill="#f65392"/></svg>');
 if(info.project.name==='iPad-WebKit'){
  // WebKit's synthetic offline mode blocks the initial file navigation itself.
  // Load the same saved bytes first, then disable networking for all UI actions.
  await page.route('https://offline-ui.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;const relative=pathname==='/index.html'?'index.html':pathname==='/data.js'?'data.js':'assets/picture.svg';const {readFile}=await import('node:fs/promises');return route.fulfill({contentType:relative.endsWith('.html')?'text/html':relative.endsWith('.js')?'text/javascript':'image/svg+xml',body:await readFile(join(folder,relative))});});
  await page.goto('https://offline-ui.test/index.html');await expect(page.locator('#feed .photos img').first()).toBeVisible();
  await context.setOffline(true);
 }else{
  await context.setOffline(true);await page.goto(pathToFileURL(join(folder,'index.html')).href);
 }
 await expect(page.locator('#feed .post-layout').first()).toBeVisible();await expect(page.locator('#feed .quote')).toBeVisible();await expect(page.locator('#feed .emoji').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const sizes=await page.locator('#feed article').first().locator('.actions .icon').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));expect(sizes).toHaveLength(6);expect(sizes.every(s=>s.width===20&&s.height===20)).toBe(true);
 if(width>=640){await expect(page.locator('.sidebar')).toBeVisible();await expect(page.locator('.discover')).toBeVisible();}
 else{for(const label of ['ホーム','検索','プロフ','チャット','設定'])await expect(page.locator('#bottom').getByRole('button',{name:label,exact:true})).toBeInViewport();}
 await expect(page.locator('#back')).toBeHidden();
 await page.screenshot({path:'/tmp/lime-offline-'+width+'-'+info.project.name+'-light.png'});
 await page.locator('#theme').click();expect(await page.locator('html').getAttribute('class')).toContain('dark');await page.screenshot({path:'/tmp/lime-offline-'+width+'-'+info.project.name+'-dark.png'});
 await page.locator('#feed article').first().getByRole('button',{name:'返信 1',exact:true}).click();await expect(page.getByText('親ポストへの返信',{exact:true})).toBeVisible();await expect(page.getByText('返信への返信',{exact:true})).toBeVisible();await expect(page.locator('.reply-thread')).toHaveCount(2);
 if(width<640)await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
 if(width>=640){await page.locator('#more-nav').click();await page.locator('#details').getByRole('button',{name:'スペース',exact:true}).click();}else await page.locator('#nav').getByRole('button',{name:'スペース',exact:true}).click();await expect(page.getByText('自分が作成したスペース',{exact:true})).toBeVisible();await expect(page.getByText('他人のスペースをコピーしない',{exact:true})).toHaveCount(0);await expect(page.getByText('参加した他人のスペース',{exact:true})).toHaveCount(0);
 expect(await page.locator('#feed').textContent()).not.toContain('INTERNAL_HEARTBEAT');expect(await page.locator('#feed').textContent()).not.toContain('host_id');expect(await page.locator('pre')).toHaveCount(0);expect(errors).toEqual([]);
 }finally{await rm(folder,{recursive:true,force:true});}
});

for(const width of [390,1440])test(`post detail header has no bottom border at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.goto('post/post-0');
 const bar=page.locator('.post-detail-mobile-topbar');
 await expect(bar).toBeVisible();
 expect(await bar.evaluate(e=>getComputedStyle(e).borderBottomWidth)).toBe('0px');
 await expect(bar.getByRole('button',{name:'戻る',exact:true})).toBeVisible();
});

test('mobile drawer keeps the main page above the sidebar throughout opening and closing',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('./');
 await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
 const mover=page.locator('[data-lime-root-move-wrapper]');
 await expect(mover).toHaveCSS('z-index','101');
 await expect.poll(()=>page.getByRole('button',{name:'新規投稿',exact:true}).evaluate(el=>el.getBoundingClientRect().x)).toBeGreaterThan(600);
 await expect.poll(()=>mover.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)).toBeGreaterThan(325);
 await page.locator('[data-lime-mobile-sidebar-overlay]').click({position:{x:10,y:100}});
 await expect(page.locator('[data-lime-mobile-sidebar]')).toBeVisible();
 await expect(mover).toHaveCSS('z-index','101');
 await page.screenshot({path:test.info().outputPath('drawer-closing.png')});
 await expect(mover).toHaveCSS('transform','none');
 await expect(page.locator('[data-lime-mobile-sidebar]')).toBeHidden();
 await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
});

test('iPad sidebar and desktop sidebar stay visible after closing the mobile drawer and resizing',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('./');
 await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
 const drawer=page.locator('[data-lime-mobile-sidebar="true"]');await expect(drawer).toBeVisible();
 // Resize during a drawer close: its delayed callback must never hide the
 // persistent sidebar, nor leave the whole desktop root translated/clipped.
 await page.locator('[data-lime-mobile-sidebar-overlay]').click({position:{x:10,y:100},force:true});
 for(const width of [820,1180,740,820]){
  await page.setViewportSize({width,height:900});

  const sidebar=page.locator('[data-lime-desktop-sidebar]');await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('pointer-events','auto');await expect(sidebar).not.toHaveAttribute('data-lime-mobile-sidebar','true');
  await expect(sidebar.getByRole('button',{name:'ホーム',exact:true})).toBeInViewport();
  await expect.poll(()=>page.evaluate(()=>{
   const wrapper=document.querySelector('[data-lime-root-move-wrapper]');return wrapper?getComputedStyle(wrapper).transform:'none';
  })).toBe('none');
  await page.waitForTimeout(400);
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button',{name:'設定',exact:true}).click();await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button',{name:'検索',exact:true}).click();await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button',{name:'ホーム',exact:true}).click();await expect(sidebar).toBeVisible();
 }
});

for (const width of [390, 820, 1440]) test(`${width===820?'iPad keeps ':''}protected account requests and public review tab at ${width}px`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const protectedId='22222222-2222-4222-8222-222222222222';
 const locked={...profile,id:protectedId,username:'protected',display_name:'非公開ユーザー',is_private:true,is_official:true,review:true};
 let requested=false;
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(locked)}));
 await page.route('**/rest/v1/rpc/get_account_follow_state',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({followed:false,requested,canView:false})}));
 await page.route('**/rest/v1/rpc/toggle_account_follow',route=>{requested=!requested;return route.fulfill({contentType:'application/json',body:JSON.stringify({followed:false,requested,canView:false})});});
 await page.route('**/rest/v1/rpc/get_account_reviews',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,total:0,average:0,distribution:{},reviews:[]})}));
 await page.setViewportSize({width,height:900});await page.goto('u/protected');
 await expect(page.getByText('このアカウントのポストは非公開です')).toBeVisible();
 await expect(page.locator('[data-lime-profile-name]').locator('..').getByRole('img',{name:'非公開アカウント'})).toBeVisible();
 await expect(page.locator('[data-lime-profile-name]').locator('..').getByAltText('Official')).toBeVisible();
 await expect(page.locator('[data-lime-profile-posts]')).toHaveCount(0);
 await expect(page.locator('[data-lime-profile-activity-count]')).toHaveCount(0);
 const follow=page.locator('[data-lime-profile-actions]').getByRole('button',{name:'フォロー',exact:true});
 await follow.click();await expect.poll(()=>requested).toBe(true);
 await page.locator('[data-lime-profile-actions]').getByRole('button',{name:'リクエスト済み',exact:true}).click();await expect.poll(()=>requested).toBe(false);
 await page.getByRole('tab',{name:'レビュー',exact:true}).filter({visible:true}).click();
 await expect(page.getByText('まだレビューがありません。')).toBeVisible();expect(errors).toEqual([]);
});

test('privacy settings save protection and approve or reject pending followers',async({page})=>{
 let privateAccount=false;let pending=[{id:'requester',username:'requester',displayName:'リクエストユーザー',avatarUrl:'',isPrivate:true,isOfficial:true}];
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>{
  if(route.request().method()==='PATCH')privateAccount=route.request().postDataJSON().is_private;
  return route.fulfill({contentType:'application/json',body:JSON.stringify({...profile,is_private:privateAccount})});
 });
 await page.route('**/rest/v1/rpc/get_account_follow_requests',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(pending)}));
 const responses:boolean[]=[];
 await page.route('**/rest/v1/rpc/respond_account_follow_request',route=>{responses.push(route.request().postDataJSON().accept_request);pending=[];return route.fulfill({contentType:'application/json',body:'null'});});
 await page.setViewportSize({width:1440,height:900});await page.goto('settings?section=privacy');
 const check=page.getByRole('checkbox',{name:'ポストを非公開'});
 await check.click();await expect(check).toBeChecked();expect(privateAccount).toBe(true);
 await page.getByRole('button',{name:'承認',exact:true}).click();await expect(page.getByText('フォローリクエストはありません')).toBeVisible();expect(responses).toEqual([true]);
 pending=[{id:'another',username:'another',displayName:'別のリクエスト',avatarUrl:'',isPrivate:false,isOfficial:false}];
 await page.reload();await page.getByRole('button',{name:'拒否',exact:true}).click();await expect(page.getByText('フォローリクエストはありません')).toBeVisible();expect(responses).toEqual([true,false]);
 await check.click();await expect(check).not.toBeChecked();expect(privateAccount).toBe(false);
});

for(const width of [390,640,820,1440]) test(`${width===820?'iPad keeps ':''}privacy panel fits requests without horizontal overflow at ${width}px`,async({page})=>{
 await page.route('**/rest/v1/rpc/get_account_follow_requests',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{id:'requester',username:'long_requester_username_that_needs_truncating',displayName:'長い表示名の非公開アカウント',avatarUrl:image,isPrivate:true,isOfficial:true}])}));
 await page.setViewportSize({width,height:900});await page.goto('settings?section=privacy');
 const panel=page.locator('[data-account-privacy-settings]');
 await expect(panel.getByRole('button',{name:'承認',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'拒否',exact:true})).toBeVisible();
 await expect(panel.getByRole('img',{name:'非公開アカウント'})).toBeVisible();
 await expect(panel.getByAltText('Official')).toBeVisible();
 const geometry=await panel.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth,right:el.getBoundingClientRect().right,viewport:innerWidth}));
 expect(geometry.width).toBeGreaterThan(180);expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
 if(width===390||width===1440)await panel.screenshot({path:`/private/tmp/lime-privacy-${width}.png`});
});

test('protected account badges accompany verification in desktop footer and existing notifications',async({page})=>{
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>{
  const single=(route.request().headers().accept??'').includes('vnd.pgrst.object');
  const locked={...profile,is_private:true,is_official:true};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(single?locked:[locked])});
 });
 await page.route('**/*.supabase.co/rest/v1/notifications*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{id:'notification',user_id:user.id,actor_id:user.id,post_id:'post-0',type:'like',actor_name:user.displayName,actor_is_official:true,actor_avatar_url:null,content_preview:'',is_read:true,created_at:user.createdAt}])}));
 await page.setViewportSize({width:1440,height:900});await page.goto('notifications');
 const footer=page.locator('[data-lime-account-info]');
 await expect(footer.getByRole('img',{name:'非公開アカウント'})).toBeVisible();await expect(footer.getByAltText('Official')).toBeVisible();
 const notification=page.locator('[data-notification-type="like"]');
 await expect(notification.getByRole('img',{name:'非公開アカウント'})).toBeVisible();await expect(notification.getByAltText('認証済み')).toBeVisible();
});

test('mobile profile header keeps a blurred cover and matching follow colors in both themes',async({page})=>{
 const other={...profile,id:'22222222-2222-4222-8222-222222222222',username:'other',display_name:'別のユーザー',cover_url:image};
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify((route.request().headers().accept??'').includes('vnd.pgrst.object')?other:[other])}));
 await page.setViewportSize({width:390,height:900});
 const styles:unknown[]=[];
 for(const theme of ['light','dark']){
  await page.emulateMedia({colorScheme:theme as 'light'|'dark'});await page.goto('u/other');
  await expect(page.locator('[data-lime-profile-name]')).toBeVisible();
  await page.evaluate(()=>{document.body.style.minHeight='2400px';window.scrollTo(0,1000);});
  const follow=page.locator('.lime-profile-bar-follow.is-visible button');await expect(follow).toBeVisible();
  await expect.poll(()=>page.locator('.lime-profile-bar-background').evaluate(el=>getComputedStyle(el,'::before').filter)).toBe('blur(12px)');
  await expect.poll(()=>page.locator('.lime-profile-bar-background').evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
  styles.push(await follow.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,border:s.borderWidth};}));
 }
 expect(styles[0]).toEqual(styles[1]);
});

for(const provider of ['Bluesky','Misskey'])test(`${provider} detail does not flash an error while the external request is pending`,async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let started=false;
 const content=`${provider}からの詳細ポスト`;
 if(provider==='Bluesky')await page.route('**/public.api.bsky.app/**',async route=>{
  if(!new URL(route.request().url()).pathname.endsWith('getPostThread'))return route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'});
  started=true;await gate;await route.fulfill({contentType:'application/json',body:JSON.stringify({thread:{post:{uri:'at://did:plc:external/app.bsky.feed.post/fixture',cid:'cid',author:{did:'did:plc:external',handle:'external.bsky.social',displayName:'External'},record:{$type:'app.bsky.feed.post',text:content,createdAt:user.createdAt},likeCount:0,replyCount:0},replies:[]}})});
 });
 else await page.route('https://misskey.io/api/**',async route=>{
  if(new URL(route.request().url()).pathname.endsWith('/notes/show')){started=true;await gate;return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'fixture',text:content,createdAt:user.createdAt,visibility:'public',user:{id:'external',username:'external',name:'External'},files:[],reactions:{}})});}
  return route.fulfill({contentType:'application/json',body:'[]'});
 });
 await page.setViewportSize({width:390,height:900});
 const id=provider==='Bluesky'?'bsky:at://did:plc:external/app.bsky.feed.post/fixture':'misskey:https://misskey.io/notes/fixture';
 await page.goto(`post/${encodeURIComponent(id)}`);await expect.poll(()=>started).toBe(true);
 await expect(page.getByText('投稿の読み込みに失敗しました。',{exact:true})).toHaveCount(0);
 release();await expect(page.locator('[data-lime-post-detail-card]')).toContainText(content);
 await expect(page.getByText('投稿の読み込みに失敗しました。',{exact:true})).toHaveCount(0);
});

for(const width of [390,1440])test(`profile displays known followers below counts except on your own profile at ${width}px`,async({page})=>{
 const other={...profile,id:'22222222-2222-4222-8222-222222222222',username:'other',display_name:'別のユーザー'};
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify((route.request().headers().accept??'').includes('vnd.pgrst.object')?other:[other])}));
 let matches=42;
 await page.route('**/*.supabase.co/rest/v1/follows*',route=>{
  const select=new URL(route.request().url()).searchParams.get('select')??'';
  const users=[{id:'a',username:'as',display_name:'AS',avatar_url:image},{id:'b',username:'limenote',display_name:'LimeNote',avatar_url:image},{id:'c',username:'c',display_name:'C',avatar_url:image}];
  const data=select==='followee_id'?[...users.map(row=>({followee_id:row.id})),...Array.from({length:39},(_,i)=>({followee_id:`extra-${i}`}))]:select.startsWith('profile:')?(matches?users.map(profile=>({profile})):[]):[];
  return route.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':`0-2/${select.startsWith('profile:')?matches:42}`} ,body:JSON.stringify(data)});
 });
 await page.setViewportSize({width,height:900});await page.goto('u/other');
 const known=page.locator('[data-lime-known-followers]');
 await expect(known).toHaveText('フォローしているASさん、LimeNoteさん、他40人にフォローされています');
 await expect(known).toHaveAttribute('href',/u\/other\/followers_following\?tab=followers$/);
 const bounds=await known.boundingBox();expect(bounds!.width).toBeLessThan(width);expect(bounds!.x).toBeGreaterThanOrEqual(0);
 matches=0;await page.reload();await expect(page.locator('[data-lime-profile-name]')).toBeVisible();await expect(known).toHaveCount(0);
 await page.unroute('**/*.supabase.co/rest/v1/profiles*');matches=42;await page.goto('u/lime');await expect(page.locator('[data-lime-profile-name]')).toBeVisible();await expect(known).toHaveCount(0);
});
