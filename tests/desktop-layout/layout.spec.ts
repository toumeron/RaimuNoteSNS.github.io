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
    export const getPostsByUser=async()=>posts; export const getLikedPostsByUser=async()=>posts;
    export const searchPosts=async()=>posts; export const getPostById=async()=>posts[0];
    export const createPost=async()=>posts[0]; export const toggleLike=async()=>({liked:true,likesCount:1});
    export const toggleRepost=async()=>({reposted:true,repostsCount:1}); export const deletePost=async()=>{}; export const getPostLikers=async()=>[];` }));
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
    export const getPostsByUser=async()=>[];export const getLikedPostsByUser=async()=>[];
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
