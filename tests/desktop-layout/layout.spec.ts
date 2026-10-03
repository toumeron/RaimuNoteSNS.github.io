import { test, expect } from '@playwright/test';

const user = { id: '11111111-1111-1111-1111-111111111111', username: 'lime', displayName: 'Lime Note', avatarUrl: '', bio: '', coverUrl: '', createdAt: '2026-10-01T00:00:00Z' };
const profile = { id: user.id, username: user.username, display_name: user.displayName, avatar_url: '', bio: '', cover_url: '', created_at: user.createdAt };
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="lightgreen"/></svg>');
const posts = [0, 1].map(i => ({ id: `post-${i}`, userId: user.id, content: i ? 'フォロー中の投稿' : '画像付きの投稿', imageUrls: i ? [] : [image], createdAt: user.createdAt, likesCount: 0, commentsCount: 0, repostsCount: 0, likedByMe: false, repostedByMe: false, author: user }));

test.beforeEach(async ({ page }) => {
  await page.route('**/src/hooks/useAuth.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({user:${JSON.stringify(user)},loading:false,session:null,logout:async()=>{}});export const AuthProvider=({children})=>children;` }));
  await page.route('**/src/lib/currentUser.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const getCurrentUserId=async()=> '${user.id}';` }));
  await page.route('**/src/api/posts.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `const posts=${JSON.stringify(posts)};
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
    if (url.pathname.includes('get-trends')) data = [{ title: 'テストのトレンド', traffic: '10' }];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/public.api.bsky.app/**', route => route.fulfill({ contentType: 'application/json', body: '{"feed":[],"posts":[],"actors":[]}' }));
});

const routes = ['', 'search', 'notifications', 'chat', 'media', 'media/lime', 'news', 'u/lime', 'u/lime/followers_following', 'post/post-0', 'post/post-0/activity', 'settings', 'share', 'spaces/room', 'limepro'];
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
});
for (const width of [768, 1024, 1440]) {
  test(`every app page keeps its menu stable and required sidebars visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let menuX: number | undefined;
    let rightX: number | undefined;
    for (const path of routes) {
      await page.goto(path || './');
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
  await expect.poll(() => page.locator('[data-lime-search-tabs]').evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(64);
  await expect(page.locator('.lime-desktop-main input').first()).toBeVisible();
  await expect(page.locator('[data-lime-search-tabs]')).toBeVisible();
  await expect(page.locator('[data-lime-desktop-sidebar] button[aria-current="page"]')).toHaveText('検索');
  await page.goto('post/post-0');
  await expect(page.locator('.post-detail-mobile-topbar')).toBeVisible();
  await expect(page.locator('.post-detail-mobile-article')).toBeVisible();
  await expect(page.locator('.post-detail-mobile-content')).toHaveCSS('font-size', '18px');
  await expect(page.locator('.post-detail-mobile-action-row')).toBeVisible();
  await expect(page.locator('.comment-form-desktop-reply-input')).toBeVisible();
  await page.locator('.comment-form-desktop-reply-input').fill('返信欄の確認');
});


for (const width of [768, 1024, 1440, 1920]) {
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
    await expect.poll(() => page.locator('[data-lime-search-tabs]').evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(64);
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
  await expect(page.locator('[data-lime-search-tabs]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[data-lime-search-header] > [data-lime-search-bar]')).toBeVisible();
  await expect(page.locator('[data-lime-search-header] > [data-lime-search-tabs]')).toBeVisible();
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


test('LimeAI uses a compact rail and profile reuses mobile cover controls and account footer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('chat');
  await expect(page.locator('[data-lime-sidebar-logo]')).toBeHidden();
  await expect(page.locator('[data-lime-app-header]')).toBeHidden();
  await expect(page.locator('[data-lime-desktop-sidebar] nav button span').first()).toBeHidden();
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
  expect(await page.evaluate(()=>(window as any).__countAnimations)).toContain('repostCountOldDown');
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
  await expect(page).toHaveURL(/\/news$/);
  for(let i=0;i<2;i++) {
    await page.getByRole('button',{name:'履歴を見る',exact:true}).click();
    const history=page.locator('[data-lime-news-history]');
    await expect(history).toContainText('過去の記事');
    expect(await history.evaluate(el=>({name:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration}))).toEqual({name:'newsHistoryEnter',duration:'0.3s'});
    await history.getByRole('button').click();await expect(history).toHaveCount(0);
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
