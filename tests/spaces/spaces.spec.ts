import { test, expect, type Page } from '@playwright/test';
const viewer = { id: '11111111-1111-1111-1111-111111111111', username: 'lime', displayName: 'Lime', avatarUrl: '', createdAt: '2026-10-01T00:00:00Z' };
const host = { id: '22222222-2222-2222-2222-222222222222', username: 'host', displayName: 'ホスト', avatarUrl: '' };
const room = { id: 'demo', title: '夜のスペース', host_id: host.id, speaker_policy: 'everyone', profiles: { display_name: host.displayName, username: host.username, avatar_url: '' } };
async function setup(page: Page, own = false, content = 'スペース開催中の投稿') {
  const fixture = { room: { ...room, host_id: own ? viewer.id : host.id }, active: true, waiting: true, joined: false, anonymous: false, publishing: false, tokenFails: false, approved: false, requested: false, guests: [] as any[], reactions: [] as any[], calls: [] as string[], announcementClient: null as string | null };
  await page.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await page.route('**/src/hooks/useAuth.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({user:${JSON.stringify(viewer)},session:null,loading:false,logout:async()=>{},accounts:[],switching:false});export const AuthProvider=({children})=>children;` }));
  await page.route('**/src/lib/microphone.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export async function requestMicrophonePermission(){window.__spaceAudio??={microphones:0,closed:0,joins:[],handlers:{},muted:[]};window.__spaceAudio.permissions=(window.__spaceAudio.permissions||0)+1;} export const microphoneErrorMessage=e=>e.message;` }));
  await page.route('**/agora-rtc-sdk-ng.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const state=window.__spaceAudio??={microphones:0,closed:0,joins:[],handlers:{},muted:[]};
    export default {getMicrophones:async()=>[],createClient:()=>({remoteUsers:state.remotes??=([]),enableAudioVolumeIndicator:()=>{},setClientRole:async()=>{},on:(name,fn)=>state.handlers[name]=fn,removeAllListeners:()=>{},join:async(...args)=>state.joins.push(args),leave:async()=>{},publish:async()=>{},unpublish:async()=>{},renewToken:async()=>{state.renewed=(state.renewed||0)+1},subscribe:async remote=>{state.remotes=state.remotes||[];if(!state.remotes.some(item=>item.uid===remote.uid))state.remotes.push(remote)}}),createMicrophoneAudioTrack:async()=>{state.microphones++;return {getVolumeLevel:()=>state.level||0,setMuted:async value=>state.muted.push(value),setDevice:async()=>{},stop:()=>{},close:()=>state.closed++}}};
  ` }));
  const post = { id: 'native', userId: host.id, content, imageUrls: [], visibility: 'public', likesCount: 0, commentsCount: 0, repostsCount: 0, author: host, createdAt: viewer.createdAt };
  await page.route('**/src/api/posts.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `const posts=${JSON.stringify([post])};export const getFeed=async()=>posts,getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;export const getPostById=async()=>posts[0],createPost=async()=>posts[0],toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[];` }));
  await page.route('**/*.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*' } });
    let data: unknown = [];
    const method = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/rpc/')) {
      fixture.calls.push(method);
      const body = req.postDataJSON() || {};
      if (method === 'list_live_spaces') data = fixture.active ? [fixture.room] : [];
      if (method === 'announce_live_space') fixture.announcementClient = body.p_client_name;
      if (method === 'get_space_card') data = { ...fixture.room, is_active: fixture.active };
      if (method === 'get_space_state') data = { waiting: fixture.waiting, space: fixture.active ? fixture.room : null, members: [...(fixture.joined && !fixture.anonymous ? [{ id: 'member', display_name: viewer.displayName, avatar_url: '', rtc_uid: 1234, muted: true, role: fixture.room.host_id === viewer.id ? 'host' : fixture.publishing ? 'speaker' : 'listener' }] : []), ...fixture.guests], me: { can_speak: !fixture.anonymous && (fixture.room.host_id === viewer.id || fixture.room.speaker_policy === 'everyone' || fixture.approved), requested: fixture.requested }, anonymous_count: fixture.joined && fixture.anonymous ? 1 : 0, reactions: fixture.reactions };
      if (method === 'create_live_space') { fixture.room = { ...fixture.room, host_id: viewer.id, title: body.p_title, speaker_policy: body.p_policy }; data = 'demo'; }
      if (method === 'join_live_space') { fixture.joined = true; fixture.anonymous = body.p_anonymous; data = { rtc_uid: 1234, role: 'listener', anonymous: fixture.anonymous }; }
      if (method === 'leave_live_space') { fixture.joined = false; if (fixture.room.host_id === viewer.id) fixture.active = false; data = null; }
      if (method === 'set_space_microphone' && !body.p_muted) fixture.waiting = false;
      if (method === 'update_live_space') { fixture.room.title = body.p_title; fixture.room.speaker_policy = body.p_policy; }
      if (method === 'request_space_speaker') fixture.requested = body.p_requested;
      if (method === 'manage_space_speaker') { const guest = fixture.guests.find(item => item.id === body.p_member_id); if (guest) { guest.requested = false; guest.role = body.p_allow ? 'speaker' : 'listener'; } }
      if (method === 'react_live_space') { fixture.reactions.push({ id: String(fixture.reactions.length), emoji: body.p_emoji, created_at: new Date().toISOString() }); data = null; }
    }
    if (method === 'space-token') {
      if (fixture.tokenFails) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture connection failure"}' });
      fixture.publishing = req.postDataJSON().publishing; data = { appId: 'fixture', token: 'test-token', role: fixture.publishing ? 'host' : 'audience' };
    }
    if (method === 'profiles') { const profile = { id: viewer.id, username: viewer.username, display_name: viewer.displayName, avatar_url: '' }; data = (req.headers().accept ?? '').includes('vnd.pgrst.object') ? profile : [profile]; }
    if (method === 'get-trends') data = [];
    return route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: req.method() === 'HEAD' ? '' : JSON.stringify(data) });
  });
  await page.route('**/public.api.bsky.app/**', route => route.fulfill({ contentType: 'application/json', body: '{"feed":[],"posts":[],"actors":[]}' }));
  return fixture;
}
test('sidebar opens creation; microphone starts muted and is closed on ending', async ({ page }, info) => {
  const fixture = await setup(page);
  await page.goto('./spaces/new');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  if (info.project.name === 'desktop' || info.project.name === 'iPad') {
    await page.locator('[data-lime-desktop-sidebar]').getByRole('button', { name: 'もっと見る', exact: true }).click();
    await page.getByRole('menuitem', { name: 'スペースを作成', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
    await page.locator('[data-lime-mobile-sidebar="true"]').getByRole('button', { name: 'スペースを作成', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'スペースを作成', exact: true })).toBeVisible();
  const creationIcon = page.locator('.lime-space-dialog svg.h-14');
  const paintBounds = await creationIcon.evaluate(svg => Array.from(svg.querySelectorAll('path')).map(path => {
    const box = path.getBBox();
    const stroke = Number.parseFloat(getComputedStyle(path).strokeWidth) / 2;
    return { left: box.x - stroke, top: box.y - stroke, right: box.x + box.width + stroke, bottom: box.y + box.height + stroke };
  }));
  for (const box of paintBounds) {
    expect(box.left).toBeGreaterThanOrEqual(0); expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(24); expect(box.bottom).toBeLessThanOrEqual(24);
  }
  await page.screenshot({ path: info.outputPath('creation.png') });
  await page.getByRole('textbox', { name: 'スペースのテーマ' }).fill('みんなで雑談');
  await page.getByRole('button', { name: '今すぐ始める', exact: true }).click();
  await expect(page.getByRole('button', { name: 'マイクをオンにする', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__spaceAudio.muted)).toEqual([true]);
  const music = page.locator('audio[data-lime-space-waiting]');
  await expect(music).toHaveCount(1);
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await expect(music).toHaveAttribute('data-lime-space-ready', 'true', { timeout: 15000 });
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  expect(await music.evaluate((audio: HTMLAudioElement) => audio.loop)).toBe(true);
  await expect.poll(() => fixture.calls.filter(name => name === 'announce_live_space').length).toBe(1);
  await page.screenshot({ path: info.outputPath('hosting.png') });
  await page.getByRole('button', { name: 'マイクをオンにする' }).click();
  await expect(page.getByRole('button', { name: 'マイクをオフにする' })).toBeVisible();
  expect(fixture.announcementClient).toMatch(/^LimeNote for (iPhone|iPad|Mac|Windows|Linux|Android|Web)$/);
  await expect(page.locator('audio[data-lime-space-waiting]')).toHaveCount(0);
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: '終了する', exact: true }).click();
  await expect(page.getByText('このスペースは終了しました。')).toBeVisible();
  expect(fixture.active).toBe(false);
  expect(await page.evaluate(() => (window as any).__spaceAudio.closed)).toBe(1);
});
test('anonymous listening uses no microphone, hides identity, supports reactions and minimization', async ({ page }, info) => {
  const fixture = await setup(page);
  await page.goto('./spaces/demo');
  await page.getByRole('switch', { name: '匿名でリスニングする' }).click();
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByText('匿名でリスニング中', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'マイクをオンにする' })).toHaveCount(0);
  expect(fixture.anonymous).toBe(true);
  expect(await page.evaluate(() => (window as any).__spaceAudio.microphones)).toBe(0);
  await expect(page.getByRole('dialog').getByText('Lime', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'リアクションする', exact: true }).click();
  await page.getByRole('button', { name: '👏でリアクション' }).click();
  await expect(page.locator('.lime-space-reaction')).toHaveText('👏');
  await page.screenshot({ path: info.outputPath('anonymous-listening.png') });
  await page.getByRole('button', { name: 'スペースを最小化' }).click();
  await expect(page.getByRole('button', { name: '参加中のスペース' })).toBeVisible();
  await page.getByRole('button', { name: 'スペースを開く', exact: true }).last().click();
  await page.getByRole('button', { name: '退出する', exact: true }).click();
  await expect.poll(() => fixture.joined).toBe(false);
  await expect(page.locator('audio[data-lime-space-waiting]')).toHaveCount(0);
});
test('live avatar opens a space and a listener can speak and renew the audio token', async ({ page }) => {
  await setup(page);
  await page.goto('./');
  const liveAvatar = page.getByRole('button', { name: '夜のスペースに参加' }).first();
  await expect.poll(() => liveAvatar.evaluate(element => getComputedStyle(element, '::before').borderTopColor)).toBe(await liveAvatar.evaluate(element => { const color = document.createElement('span'); color.style.color = 'hsl(var(--primary))'; element.append(color); const value = getComputedStyle(color).color; color.remove(); return value; }));
  await page.getByRole('button', { name: '夜のスペースに参加' }).first().click();
  await expect(page.getByRole('heading', { name: '夜のスペース' })).toBeVisible();
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByRole('button', { name: 'マイクをオンにする' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__spaceAudio.microphones)).toBe(0);
  await page.getByRole('button', { name: 'マイクをオンにする' }).click();
  await expect(page.getByRole('button', { name: 'マイクをオフにする' })).toBeVisible();
  await page.evaluate(() => (window as any).__spaceAudio.handlers['token-privilege-will-expire']());
  expect(await page.evaluate(() => (window as any).__spaceAudio.renewed)).toBe(2);
  expect(await page.evaluate(() => (window as any).__spaceAudio.joins[0][1])).toBe('lime-space:demo');
});
test('host-only space does not offer publishing; failed audio join removes membership', async ({ page }) => {
  const fixture = await setup(page);
  fixture.room.speaker_policy = 'host';
  fixture.tokenFails = true;
  await page.goto('./spaces/demo');
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByText('音声接続を開始できませんでした。もう一度お試しください。', { exact: true })).toBeVisible();
  await expect.poll(() => fixture.joined).toBe(false);
  await expect(page.locator('audio[data-lime-space-waiting]')).toHaveCount(0);
  fixture.tokenFails = false;
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByRole('button', { name: '発言をリクエスト', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'マイクをオンにする' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__spaceAudio.microphones)).toBe(0);
});

test('host panel edits theme, manages speaker requests, and remains usable after minimizing', async ({ page }, info) => {
  const fixture = await setup(page, true);
  fixture.guests.push({ id: 'guest', display_name: 'ゲスト', username: 'guest', avatar_url: '', role: 'listener', requested: true });
  await page.goto('./spaces/demo');
  await page.getByRole('button', { name: '配信に戻る', exact: true }).click();
  await page.getByRole('button', { name: 'テーマを編集', exact: true }).click();
  await page.getByRole('textbox', { name: 'スペースのテーマ' }).fill('更新したテーマ');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '更新したテーマ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'スペースのメニュー' }).click();
  await page.getByRole('button', { name: 'スペースの設定', exact: true }).click();
  await page.getByRole('radio', { name: 'スピーカーとして許可したアカウントのみ', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'スピーカーとして許可したアカウントのみ', exact: true })).toBeChecked();
  await expect.poll(() => fixture.room.speaker_policy).toBe('host');
  await page.getByRole('button', { name: 'スペースに戻る', exact: true }).click();
  await page.getByRole('button', { name: 'スペースを管理' }).click();
  await expect(page.getByText('発言リクエスト', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '発言を許可' }).click();
  await expect(page.getByRole('button', { name: 'リスナーに戻す' })).toBeVisible();
  await page.getByRole('button', { name: 'スペースに戻る', exact: true }).click();
  const box = await page.locator('.lime-space-live-panel').boundingBox();
  if (info.project.name === 'desktop') expect(box!.x).toBeGreaterThan(900);
  await page.getByRole('button', { name: 'スペースを最小化' }).click();
  await expect(page.locator('.lime-space-mini')).toContainText('更新したテーマ');
  await page.getByRole('button', { name: 'スペースを開く', exact: true }).last().click();
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('button', { name: 'いいえ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'マイクをオンにする' })).toBeVisible();
});
test('listener request can be cancelled; host approval enables the microphone without auto-unmuting', async ({ page }) => {
  const fixture = await setup(page);
  fixture.room.speaker_policy = 'host';
  await page.goto('./spaces/demo');
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await page.getByRole('button', { name: '発言をリクエスト', exact: true }).click();
  await page.getByRole('button', { name: 'リクエストを取消', exact: true }).click();
  await expect.poll(() => fixture.requested).toBe(false);
  fixture.approved = true;
  await expect(page.getByRole('button', { name: 'マイクをオンにする', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__spaceAudio.microphones)).toBe(0);
  await page.getByRole('button', { name: 'マイクをオンにする', exact: true }).click();
  await expect(page.getByRole('button', { name: 'マイクをオフにする', exact: true })).toBeVisible();
  fixture.approved = false;
  await expect(page.getByRole('button', { name: '発言をリクエスト', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__spaceAudio.closed)).toBe(1);
});


test('anonymous listeners hear waiting music until another speaker turns on a microphone; it never restarts', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('./spaces/demo');
  await page.getByRole('switch', { name: '匿名でリスニングする' }).click();
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  const music = page.locator('audio[data-lime-space-waiting]');
  await expect(music).toHaveCount(1);
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await page.getByRole('button', { name: 'スペースを最小化' }).click();
  await expect(music).toHaveCount(1);
  fixture.waiting = false;
  await expect(music).toHaveCount(0);
  await page.getByRole('button', { name: 'スペースを開く', exact: true }).last().click();
  await page.getByRole('button', { name: '退出する', exact: true }).click();
  await expect.poll(() => fixture.joined).toBe(false);
  await page.getByRole('switch', { name: '匿名でリスニングする' }).click();
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByText('匿名でリスニング中', { exact: true })).toBeVisible();
  await expect(music).toHaveCount(0);
});

test('light page background matches the header surface', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('./search');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const background = await page.evaluate(() => ({
    page: getComputedStyle(document.body).backgroundColor,
    gradient: getComputedStyle(document.body).backgroundImage,
    header: getComputedStyle(document.querySelector('[data-lime-search-header]') || document.querySelector('header')!).backgroundColor,
  }));
  expect(background.gradient).toBe('none');
  expect(background.page).toBe('rgb(252, 250, 243)');
  // Translucent headers now blend with the same solid page surface.
  expect(background.header).toMatch(/(252, 250, 243|0, 0, 0, 0)/);
});

test('a muted speaker track does not stop waiting music; an active microphone does', async ({ page }) => {
  const fixture = await setup(page);
  fixture.guests.push({ id: 'speaker', display_name: 'ホスト', avatar_url: '', role: 'host', rtc_uid: 42, muted: true });
  await page.goto('./spaces/demo');
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByRole('button', { name: 'スペースを最小化' })).toBeVisible();
  const published = () => page.evaluate(() => (window as any).__spaceAudio.handlers['user-published']({ uid: 42, audioTrack: { getMediaStreamTrack() { return new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0]; } } }, 'audio'));
  await published();
  await expect(page.locator('audio[data-lime-space-voice]')).toHaveCount(1);
  await expect(page.locator('audio[data-lime-space-waiting]')).toHaveCount(1);
  fixture.guests[0].muted = false;
  fixture.waiting = false;
  await published();
  await expect(page.locator('audio[data-lime-space-waiting]')).toHaveCount(0);
});

test('host and speaker mute status follows RTC events; voice activity and native audio clean up on exit', async ({ page }, info) => {
  const fixture = await setup(page);
  fixture.guests.push({ id: 'host-member', display_name: 'ホスト', avatar_url: '', role: 'host', rtc_uid: 42, muted: true });
  await page.goto('./spaces/demo');
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出する', exact: true })).toBeVisible();
  const hostPerson = page.locator('.lime-space-person').filter({ hasText: 'ホスト' }).first();
  await expect(hostPerson.locator('[aria-label="ミュート中"]')).toBeVisible();
  await expect(page.locator('audio[data-lime-space-waiting]')).toHaveAttribute('src', /^blob:/);
  await page.evaluate(() => {
    const handlers = (window as any).__spaceAudio.handlers;
    handlers['user-info-updated'](42, 'unmute-audio');
    (window as any).__spaceAudio.remotes.push({ uid:42, audioTrack:{ getVolumeLevel:()=>.35 } });
    handlers['volume-indicator']([{ uid: 42, level: 35 }]);
  });
  await expect(hostPerson.locator('[aria-label="発言中"]')).toBeVisible();
  await expect(hostPerson).toHaveClass(/is-speaking/);
  await page.evaluate(() => (window as any).__spaceAudio.handlers['user-info-updated'](42, 'mute-audio'));
  await expect(hostPerson.locator('[aria-label="ミュート中"]')).toBeVisible();
  await expect(hostPerson).not.toHaveClass(/is-speaking/);
  expect(await page.locator('.lime-space-members').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(4);
  await page.screenshot({ path: info.outputPath('mute-status.png') });
  await page.getByRole('button', { name: '退出する', exact: true }).click();
  await expect(page.locator('audio[data-lime-space-waiting],audio[data-lime-space-voice]')).toHaveCount(0);
});

test('microphone level changes the UI continuously and silence stops it', async ({ page }) => {
  const fixture = await setup(page, true);
  await page.goto('./spaces/demo');
  await page.getByRole('button', { name: '配信に戻る', exact: true }).click();
  await page.getByRole('button', { name: 'マイクをオンにする', exact: true }).click();
  const self = page.locator('.lime-space-person').filter({ hasText: 'Lime' }).first();
  await page.evaluate(() => (window as any).__spaceAudio.level = .1);
  await expect(self).toHaveAttribute('data-voice-level', '0.1');
  const quietWidth = await self.locator('.lime-space-face').evaluate(element => parseFloat(getComputedStyle(element).outlineWidth));
  await page.evaluate(() => (window as any).__spaceAudio.level = .8);
  await expect(self).toHaveAttribute('data-voice-level', '0.8');
  await expect.poll(() => self.locator('.lime-space-face').evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThan(quietWidth);
  await page.evaluate(() => (window as any).__spaceAudio.level = 0);
  await expect(self).not.toHaveClass(/is-speaking/);
  await page.getByRole('button', { name: 'マイクをオフにする', exact: true }).click();
  await page.evaluate(() => (window as any).__spaceAudio.level = .8);
  await expect(self).not.toHaveClass(/is-speaking/);
});

test('space announcement opens the room and shows joined state in the timeline', async ({ page }, info) => {
  await setup(page, false, 'https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/demo');
  await page.goto('./');
  const card = page.locator('.lime-space-post-card').first();
  await expect(card.getByRole('button', { name: 'スペースを聞く' })).toBeVisible();
  await card.screenshot({ path: info.outputPath('announcement-live.png') });
  await card.getByRole('button', { name: 'スペースを聞く' }).click();
  await page.getByRole('button', { name: '聞いてみる', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出する', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'スペースを最小化', exact: true }).click();
  await expect(card.getByRole('button', { name: '参加済み' })).toBeVisible();
});

test('ended space announcement remains on post detail without a listening button', async ({ page }, info) => {
  const fixture = await setup(page, false, 'https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/demo');
  fixture.active = false;
  await page.goto('./post/native');
  const card = page.locator('.lime-space-post-card').first();
  await expect(card.getByText('終了しました')).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(0);
  await card.screenshot({ path: info.outputPath('announcement-ended.png') });
});

test('joined announcement icon follows real microphone level while minimized and stops when muted', async ({ page }) => {
  await setup(page, true, 'https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/demo');
  await page.goto('./');
  const card = page.locator('.lime-space-post-card').first();
  await card.getByRole('button', { name: 'スペースを聞く' }).click();
  await page.getByRole('button', { name: '配信に戻る', exact: true }).click();
  await page.getByRole('button', { name: 'マイクをオンにする', exact: true }).click();
  await page.getByRole('button', { name: 'スペースを最小化', exact: true }).click();
  const meter = card.locator('svg[data-voice-level]');
  await page.evaluate(() => (window as any).__spaceAudio.level = .1);
  await expect(meter).toHaveAttribute('data-voice-level', '0.1');
  const quiet = await meter.locator('path').nth(1).getAttribute('d');
  await page.evaluate(() => (window as any).__spaceAudio.level = .8);
  await expect(meter).toHaveAttribute('data-voice-level', '0.8');
  expect(await meter.locator('path').nth(1).getAttribute('d')).not.toBe(quiet);
  await card.getByRole('button', { name: '参加済み' }).click();
  await page.getByRole('button', { name: 'マイクをオフにする', exact: true }).click();
  await page.getByRole('button', { name: 'スペースを最小化', exact: true }).click();
  await expect(meter).toHaveAttribute('data-voice-level', '0');
});
