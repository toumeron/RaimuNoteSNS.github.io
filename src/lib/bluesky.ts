// 初期状態ではBlueskyアカウントを1件も登録しない。
// BSKY_AUTHOR_HANDLE は既存コードとの互換性のためだけに残し、既定の登録先には使用しない。
export const BSKY_AUTHOR_HANDLES = [] as const;
export const BSKY_AUTHOR_HANDLE = 'jp.bsky.app';
export const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';
const BSKY_SEARCH_API = 'https://api.bsky.app/xrpc';
export const BSKY_HANDLES_STORAGE_KEY = 'lime_bluesky_author_handles';

// 自分のBlueskyアカウントでログイン(アプリパスワード認証)した際のセッション情報。
// ログイン/セッション更新/ログアウトは公式PDSエンドポイント(bsky.social)に対して行う。
export const BSKY_SESSION_STORAGE_KEY = 'lime_bluesky_session';
const BSKY_PDS_API = 'https://bsky.social/xrpc';

// 「トレンド」タブ用の設定。
// Blueskyの検索APIには「日本語×いいね数上位から無作為抽出する」専用APIが
// 存在しないため、複数の頻出語(助詞など、日本語の文章であればほぼ必ず
// 含まれる語)で app.bsky.feed.searchPosts (sort=top, lang=ja) を検索し、
// その結果を合算した上でいいね数によるフィルタとシャッフルをかけることで
// 疑似的な「トレンド・ランダム表示」を実現する。
const TRENDING_SEED_QUERIES = ['の', 'は', 'た', 'です'] as const;
const TRENDING_MIN_LIKES = 100;
const TRENDING_MAX_AGE_DAYS = 5;

export function normalizeBlueskyHandle(value: string): string {
  const trimmed = value.trim();
  const profileMatch = trimmed.match(/^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#]+)/i);
  const normalized = (profileMatch?.[1] ?? trimmed)
    .replace(/^@+/, '')
    .replace(/\/$/, '')
    .toLowerCase();
  return normalized;
}

export function getConfiguredBlueskyHandles(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(BSKY_HANDLES_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    const handles = parsed
      .filter((value): value is string => typeof value === 'string')
      .map(normalizeBlueskyHandle)
      .filter(Boolean);

    return Array.from(new Set(handles));
  } catch (error) {
    console.warn('Read Bluesky handles from localStorage failed:', error);
    return [];
  }
}

export function saveConfiguredBlueskyHandles(handles: string[]): string[] {
  const normalized = Array.from(
    new Set(handles.map(normalizeBlueskyHandle).filter(Boolean))
  );

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(BSKY_HANDLES_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(
      new CustomEvent('lime-bluesky-handles-changed', {
        detail: { handles: normalized },
      })
    );
  }

  return normalized;
}

// ------------------------------------------------------------------
// 自分のBlueskyアカウントでのログイン(アプリパスワード認証)
// ------------------------------------------------------------------

export interface BlueskySession {
  did: string;
  handle: string;
  email?: string;
  accessJwt: string;
  refreshJwt: string;
}

export function getStoredBlueskySession(): BlueskySession | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(BSKY_SESSION_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<BlueskySession>;
    if (!parsed.did || !parsed.handle || !parsed.accessJwt || !parsed.refreshJwt) return null;

    return parsed as BlueskySession;
  } catch (error) {
    console.warn('Read Bluesky session from localStorage failed:', error);
    return null;
  }
}

function saveBlueskySession(session: BlueskySession | null) {
  if (typeof window === 'undefined') return;

  if (session) {
    window.localStorage.setItem(BSKY_SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(BSKY_SESSION_STORAGE_KEY);
  }

  window.dispatchEvent(
    new CustomEvent('lime-bluesky-session-changed', {
      detail: { session },
    })
  );
}

/**
 * 自分のBlueskyアカウントでログインする。
 * 通常のアカウントパスワードではなく、Bluesky側で発行する「アプリパスワード」を使う想定。
 * (https://bsky.app/settings/app-passwords)
 */
export async function loginToBluesky(identifierRaw: string, appPassword: string): Promise<BlueskySession> {
  const identifier = normalizeBlueskyHandle(identifierRaw) || identifierRaw.trim();
  if (!identifier || !appPassword.trim()) {
    throw new Error('ユーザー名とアプリパスワードを入力してください');
  }

  const response = await fetch(`${BSKY_PDS_API}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: appPassword.trim() }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('ユーザー名またはアプリパスワードが正しくありません');
    }
    throw new Error(`Blueskyログインに失敗しました (${response.status})`);
  }

  const data = (await response.json()) as {
    did: string;
    handle: string;
    email?: string;
    accessJwt: string;
    refreshJwt: string;
  };

  const session: BlueskySession = {
    did: data.did,
    handle: data.handle,
    email: data.email,
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
  };

  saveBlueskySession(session);
  return session;
}

/**
 * accessJwtが失効した場合にrefreshJwtでセッションを更新する。
 * refreshJwt自体が失効している場合はローカルのセッションを削除してnullを返す(=ログアウト扱い)。
 */
export async function refreshBlueskySession(): Promise<BlueskySession | null> {
  const current = getStoredBlueskySession();
  if (!current) return null;

  try {
    const response = await fetch(`${BSKY_PDS_API}/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.refreshJwt}` },
    });

    if (!response.ok) {
      saveBlueskySession(null);
      return null;
    }

    const data = (await response.json()) as {
      did: string;
      handle: string;
      accessJwt: string;
      refreshJwt: string;
    };

    const session: BlueskySession = {
      ...current,
      did: data.did,
      handle: data.handle,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
    };

    saveBlueskySession(session);
    return session;
  } catch (error) {
    console.error('Bluesky session refresh failed:', error);
    return null;
  }
}

export async function logoutFromBluesky(): Promise<void> {
  const current = getStoredBlueskySession();
  saveBlueskySession(null);

  if (!current) return;

  try {
    await fetch(`${BSKY_PDS_API}/com.atproto.server.deleteSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.refreshJwt}` },
    });
  } catch (error) {
    // サーバー側の失効通知に失敗しても、ローカルのセッションは既に削除済みなので無視する
    console.warn('Bluesky deleteSession failed:', error);
  }
}

/**
 * ログイン中のBlueskyアカウントとして認証付きAPIを呼び出すための共通ヘルパー。
 * いいね・リポスト・フォローなど、ログインが必要な機能を今後実装する際に使う想定。
 * accessJwtが失効している場合は1回だけrefreshSessionを試みてから再実行する。
 */
export async function authorizedBlueskyFetch(
  endpoint: string,
  init: RequestInit = {}
): Promise<Response> {
  const session = getStoredBlueskySession();
  if (!session) {
    throw new Error('Blueskyにログインしていません');
  }

  const call = (accessJwt: string) =>
    fetch(`${BSKY_PDS_API}/${endpoint}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${accessJwt}`,
      },
    });

  let response = await call(session.accessJwt);
  if (response.status === 401) {
    const refreshed = await refreshBlueskySession();
    if (!refreshed) throw new Error('Blueskyのセッションが失効しました。再度ログインしてください');
    response = await call(refreshed.accessJwt);
  }

  return response;
}

// ------------------------------------------------------------------
// いいね / フォロー（ログイン中の自分のBlueskyアカウントとして実行）
// ------------------------------------------------------------------
//
// AT Protocolでは「いいね」「フォロー」はそれぞれ
// app.bsky.feed.like / app.bsky.graph.follow というレコードを
// 自分のリポジトリ(PDS)に作成すること、そのレコードを削除することで
// 表現される。REST的な「like/unlikeエンドポイント」は存在しない。
//
// - いいねの作成には対象投稿の uri と cid の両方が必要（cidはレコード内容の
//   ハッシュで、投稿本文の改変検知に使われる）。
// - フォローの作成には対象アカウントの did のみで良い。
// - 解除(削除)は、作成時に返ってきたレコード自身の uri (= at://did/collection/rkey)
//   の rkey 部分を使って com.atproto.repo.deleteRecord を呼ぶ。
// - 「自分は既にいいね/フォロー済みか」は、公開の getPostThread / getProfile を
//   認証付きで呼んだ際に返る viewer.like / viewer.following (レコードのuri)で判定する。

export type BlueskyPostViewerState = {
  likeUri: string | null;
  cid: string | null;
};

export type BlueskyActorViewerState = {
  followUri: string | null;
};

/**
 * 投稿に対する自分の「いいね」状態(と cid)を取得する。
 * ログインしていない場合は常に未いいね扱いを返す。
 */
export async function fetchBlueskyPostViewerState(
  uri: string,
  signal?: AbortSignal
): Promise<BlueskyPostViewerState> {
  const session = getStoredBlueskySession();
  if (!session) return { likeUri: null, cid: null };

  try {
    const params = new URLSearchParams({ uri, depth: '0' });
    const response = await authorizedBlueskyFetch(
      `app.bsky.feed.getPostThread?${params.toString()}`,
      { method: 'GET', signal }
    );

    if (!response.ok) return { likeUri: null, cid: null };

    const payload = (await response.json()) as {
      thread?: { post?: { cid?: string; viewer?: { like?: string } } };
    };

    return {
      likeUri: payload.thread?.post?.viewer?.like ?? null,
      cid: payload.thread?.post?.cid ?? null,
    };
  } catch (error) {
    console.error('Fetch Bluesky post viewer state failed:', error);
    return { likeUri: null, cid: null };
  }
}

/**
 * 特定のBlueskyアカウントに対する自分の「フォロー」状態を取得する。
 * ログインしていない場合は常に未フォロー扱いを返す。
 */
export async function fetchBlueskyActorViewerState(
  did: string,
  signal?: AbortSignal
): Promise<BlueskyActorViewerState> {
  const session = getStoredBlueskySession();
  if (!session) return { followUri: null };

  try {
    const params = new URLSearchParams({ actor: did });
    const response = await authorizedBlueskyFetch(
      `app.bsky.actor.getProfile?${params.toString()}`,
      { method: 'GET', signal }
    );

    if (!response.ok) return { followUri: null };

    const payload = (await response.json()) as { viewer?: { following?: string } };
    return { followUri: payload.viewer?.following ?? null };
  } catch (error) {
    console.error('Fetch Bluesky actor viewer state failed:', error);
    return { followUri: null };
  }
}

/**
 * 投稿にいいねする。成功時は作成された app.bsky.feed.like レコードのuriを返す。
 * cidが分からない場合は事前に fetchBlueskyPostViewerState で取得しておくこと。
 */
export async function likeBlueskyPost(uri: string, cid: string): Promise<string> {
  const session = getStoredBlueskySession();
  if (!session) throw new Error('Blueskyにログインしていません');
  if (!uri) throw new Error('投稿のuriが取得できませんでした');
  if (!cid) throw new Error('投稿のcidが取得できませんでした');

  const response = await authorizedBlueskyFetch('com.atproto.repo.createRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.like',
      record: {
        $type: 'app.bsky.feed.like',
        subject: { uri, cid },
        createdAt: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`いいねに失敗しました (${response.status})`);
  }

  const data = (await response.json()) as { uri: string };
  return data.uri;
}

/**
 * いいねを解除する。likeUriは likeBlueskyPost または
 * fetchBlueskyPostViewerState で取得した app.bsky.feed.like レコードのuri
 * (at://did/app.bsky.feed.like/rkey 形式)。
 */
export async function unlikeBlueskyPost(likeUri: string): Promise<void> {
  const session = getStoredBlueskySession();
  if (!session) throw new Error('Blueskyにログインしていません');

  const rkey = likeUri.split('/').pop();
  if (!rkey) throw new Error('無効ないいねレコードです');

  const response = await authorizedBlueskyFetch('com.atproto.repo.deleteRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.like',
      rkey,
    }),
  });

  if (!response.ok) {
    throw new Error(`いいね解除に失敗しました (${response.status})`);
  }
}

/**
 * 指定したdidのBlueskyアカウントをフォローする。
 * 成功時は作成された app.bsky.graph.follow レコードのuriを返す。
 */
export async function followBlueskyUser(did: string): Promise<string> {
  const session = getStoredBlueskySession();
  if (!session) throw new Error('Blueskyにログインしていません');
  if (!did) throw new Error('フォロー対象のDIDが不明です');

  const response = await authorizedBlueskyFetch('com.atproto.repo.createRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.graph.follow',
      record: {
        $type: 'app.bsky.graph.follow',
        subject: did,
        createdAt: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`フォローに失敗しました (${response.status})`);
  }

  const data = (await response.json()) as { uri: string };
  return data.uri;
}

/**
 * フォローを解除する。followUriは followBlueskyUser または
 * fetchBlueskyActorViewerState で取得した app.bsky.graph.follow レコードのuri。
 */
export async function unfollowBlueskyUser(followUri: string): Promise<void> {
  const session = getStoredBlueskySession();
  if (!session) throw new Error('Blueskyにログインしていません');

  const rkey = followUri.split('/').pop();
  if (!rkey) throw new Error('無効なフォローレコードです');

  const response = await authorizedBlueskyFetch('com.atproto.repo.deleteRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.graph.follow',
      rkey,
    }),
  });

  if (!response.ok) {
    throw new Error(`フォロー解除に失敗しました (${response.status})`);
  }
}

export type BlueskyMappedPost = {
  id: string;
  userId: string;
  content: string;
  imageUrls: string[];
  createdAt: string;
  visibility: 'public';
  likedByMe: boolean;
  likesCount: number;
  commentsCount: number;
  isBot: boolean;
  is_bot?: boolean;
  // いいねレコード作成(app.bsky.feed.like)に必須のフィールド。
  // getPostThread等から取得できない場合は空文字になる。
  cid: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isOfficial: boolean;
    bio: string;
    createdAt: string;
  };
  source: 'bluesky';
  blueskyUrl: string;
  blueskyUri: string;
};

export type BlueskyAuthorFeedPage = {
  posts: BlueskyMappedPost[];
  cursor: string | null;
};

export type BlueskyProfile = BlueskyMappedPost['author'] & {
  coverUrl: string;
  followersCount: number;
  followingCount: number;
};

export type BlueskyPostThread = {
  post: BlueskyMappedPost | null;
  replies: BlueskyMappedPost[];
};

export type BlueskySearchResults = {
  posts: BlueskyMappedPost[];
  users: BlueskyProfile[];
};

// フォロー/フォロワー一覧取得のページ結果
export type BlueskyFollowListPage = {
  users: BlueskyProfile[];
  cursor: string | null;
};

const BLUESKY_SEARCH_CACHE_TTL_MS = 60_000;
const blueskySearchCache = new Map<string, { expiresAt: number; result: BlueskySearchResults }>();
const blueskySearchRequests = new Map<string, Promise<BlueskySearchResults>>();

type BlueskyEmbed = {
  $type?: string;
  images?: Array<{ fullsize?: string; thumb?: string }>;
  thumbnail?: string;
  external?: { uri?: string; thumb?: string; title?: string; description?: string };
  media?: BlueskyEmbed;
  record?: {
    $type?: string;
    author?: { handle?: string; displayName?: string };
    value?: { text?: string };
    record?: {
      author?: { handle?: string; displayName?: string };
      value?: { text?: string };
      text?: string;
    };
    text?: string;
  };
};

type BlueskyFeedItem = {
  reason?: { $type?: string };
  post?: {
    uri?: string;
    cid?: string;
    author?: {
      did?: string;
      handle?: string;
      displayName?: string;
      avatar?: string;
      createdAt?: string;
      description?: string;
    };
    record?: {
      text?: string;
      createdAt?: string;
      facets?: Array<{
        index?: { byteStart?: number; byteEnd?: number };
        features?: Array<{ $type?: string; uri?: string }>;
      }>;
    };
    embed?: BlueskyEmbed;
    likeCount?: number;
    replyCount?: number;
    indexedAt?: string;
  };
};

type BlueskyActorProfile = {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  description?: string;
  createdAt?: string;
  followersCount?: number;
  followsCount?: number;
};

type BlueskyThreadView = {
  post?: BlueskyFeedItem['post'];
  replies?: BlueskyThreadView[];
};

const uniqueStrings = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

function mapBlueskyActorProfile(profile: BlueskyActorProfile): BlueskyProfile | null {
  if (!profile.did || !profile.handle) return null;
  return {
    id: profile.did,
    username: profile.handle,
    displayName: profile.displayName || profile.handle,
    avatarUrl: profile.avatar || '',
    coverUrl: profile.banner || '',
    bio: profile.description || '',
    createdAt: profile.createdAt || new Date().toISOString(),
    isOfficial: false,
    followersCount: profile.followersCount ?? 0,
    followingCount: profile.followsCount ?? 0,
  };
}

async function fetchBlueskySearchEndpoint(
  endpoint: string,
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 公開 AppView はブラウザからの未認証 GET 用に提供されているため、
    // まずこちらを使う。CDN/CORS などで一方が失敗しても、もう一方を試す。
    for (const baseUrl of [BSKY_PUBLIC_API, BSKY_SEARCH_API]) {
      try {
        const response = await fetch(`${baseUrl}/${endpoint}?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        });
        if (response.ok) return response;
        lastResponse = response;
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    if (attempt === 0 && lastResponse && (lastResponse.status === 403 || lastResponse.status === 429 || lastResponse.status >= 100)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    } else {
      break;
    }
  }
  if (!lastResponse) throw new Error(`Bluesky ${endpoint} request did not start`);
  return lastResponse;
}

function extractImageUrls(embed: BlueskyEmbed | undefined): string[] {
  if (!embed) return [];

  const type = embed.$type || '';

  if (Array.isArray(embed.images) && embed.images.length > 0) {
    return uniqueStrings(embed.images.map((image) => image.fullsize || image.thumb));
  }

  if (type.includes('recordWithMedia') && embed.media) {
    return extractImageUrls(embed.media);
  }

  if (type.includes('video') && embed.thumbnail) {
    return [embed.thumbnail];
  }

  if (embed.external?.thumb) {
    return [embed.external.thumb];
  }

  return [];
}

function extractExternalUri(embed: BlueskyEmbed | undefined): string | null {
  if (!embed) return null;
  if (embed.external?.uri) return embed.external.uri;
  if (embed.media?.external?.uri) return embed.media.external.uri;
  return null;
}

function extractQuoteLine(embed: BlueskyEmbed | undefined): string | null {
  if (!embed) return null;

  const quoted = (embed.record?.record ?? embed.record) as {
    author?: { handle?: string; displayName?: string };
    value?: { text?: string };
    record?: {
      author?: { handle?: string; displayName?: string };
      value?: { text?: string };
    };
    text?: string;
  } | undefined;
  if (!quoted) return null;

  const text = quoted.value?.text || quoted.record?.value?.text || quoted.text;
  if (!text) return null;

  const handle =
    quoted.author?.handle ||
    quoted.record?.author?.handle ||
    quoted.author?.displayName ||
    quoted.record?.author?.displayName;

  const clipped = text.length > 280 ? `${text.slice(0, 280)}…` : text;
  return handle ? `引用 @${handle}\n${clipped}` : `引用\n${clipped}`;
}

function applyLinkFacets(
  text: string,
  facets?: Array<{
    index?: { byteStart?: number; byteEnd?: number };
    features?: Array<{ $type?: string; uri?: string }>;
  }>,
): string {
  if (!text || !Array.isArray(facets) || facets.length === 0) return text;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);

  type Replacement = { start: number; end: number; uri: string };
  const replacements: Replacement[] = [];

  for (const facet of facets) {
    const feature = (facet.features || []).find(
      (item) => item.$type === "app.bsky.richtext.facet#link" && item.uri,
    );
    if (!feature?.uri) continue;

    const start = facet.index?.byteStart ?? 0;
    const end = facet.index?.byteEnd ?? 0;
    if (end <= start || start < 0 || end > bytes.length) continue;

    replacements.push({ start, end, uri: feature.uri });
  }

  replacements.sort((a, b) => a.start - b.start);

  const chunks: string[] = [];
  let cursor = 0;

  for (const replacement of replacements) {
    if (replacement.start < cursor) continue;
    chunks.push(decoder.decode(bytes.slice(cursor, replacement.start)));
    chunks.push(replacement.uri);
    cursor = replacement.end;
  }

  chunks.push(decoder.decode(bytes.slice(cursor)));
  return chunks.join("");
}

export function isBlueskyPost(post: { id?: string; source?: string } | null | undefined): boolean {
  if (!post) return false;
  return post.source === 'bluesky' || String(post.id || '').startsWith('bsky:');
}

export function getBlueskyPostUrl(
  post: { blueskyUrl?: string; author?: { username?: string }; id?: string } | null | undefined,
): string | null {
  if (!post) return null;
  if (post.blueskyUrl) return post.blueskyUrl;

  const id = String(post.id || '');
  if (!id.startsWith('bsky:')) return null;

  const uri = id.slice('bsky:'.length);
  const rkey = uri.split('/').pop();
  const handle = post.author?.username;
  if (!rkey || !handle) return null;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export function mapBlueskyFeedItemToPost(item: BlueskyFeedItem): BlueskyMappedPost | null {
  const post = item?.post;
  if (!post?.uri || !post.author?.did || !post.author?.handle) return null;
  if (item.reason) return null;

  const rkey = post.uri.split('/').pop();
  if (!rkey) return null;

  const rawText = post.record?.text || '';
  const contentFromFacets = applyLinkFacets(rawText, post.record?.facets);
  const imageUrls = extractImageUrls(post.embed).slice(0, 4);
  const externalUri = extractExternalUri(post.embed);
  const quoteLine = extractQuoteLine(post.embed);

  const extras: string[] = [];
  if (externalUri && !contentFromFacets.includes(externalUri)) {
    extras.push(externalUri);
  }
  if (quoteLine) {
    extras.push(quoteLine);
  }

  const content = [contentFromFacets.trim(), ...extras].filter(Boolean).join('\n\n');

  return {
    id: `bsky:${post.uri}`,
    userId: post.author.did,
    content,
    imageUrls,
    createdAt: post.record?.createdAt || post.indexedAt || new Date().toISOString(),
    visibility: 'public',
    likedByMe: false,
    likesCount: post.likeCount ?? 0,
    commentsCount: post.replyCount ?? 0,
    isBot: false,
    cid: post.cid || '',
    author: {
      id: post.author.did,
      username: post.author.handle,
      displayName: post.author.displayName || post.author.handle,
      avatarUrl: post.author.avatar || '',
      // Blueskyから取得したユーザーをLimeの公式ユーザーとして扱わない。
      // Lime側の公式認証情報がない限り、認証バッジは表示しない。
      isOfficial: false,
      bio: post.author.description || '',
      createdAt: post.author.createdAt || post.record?.createdAt || new Date().toISOString(),
    },
    source: 'bluesky',
    blueskyUrl: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
    blueskyUri: post.uri,
  };
}

export const getBlueskyUriFromPostId = (postId: string) => {
  const decodedId = (() => {
    try {
      return decodeURIComponent(postId);
    } catch {
      return postId;
    }
  })();
  const uri = decodedId.startsWith('bsky:') ? decodedId.slice('bsky:'.length) : decodedId;
  return uri.startsWith('at://') ? uri : null;
};

export async function fetchBlueskyPostThread(postId: string, signal?: AbortSignal): Promise<BlueskyPostThread> {
  const uri = getBlueskyUriFromPostId(postId);
  if (!uri) return { post: null, replies: [] };

  const params = new URLSearchParams({ uri, depth: '1' });
  const response = await fetch(
    `${BSKY_PUBLIC_API}/app.bsky.feed.getPostThread?${params.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' }, signal },
  );

  if (!response.ok) {
    throw new Error(`Bluesky post thread failed: ${response.status}`);
  }

  const payload = (await response.json()) as { thread?: BlueskyThreadView };
  const thread = payload.thread;
  return {
    post: thread?.post ? mapBlueskyFeedItemToPost({ post: thread.post }) : null,
    replies: (thread?.replies || [])
      .map((reply) => reply.post ? mapBlueskyFeedItemToPost({ post: reply.post }) : null)
      .filter((reply): reply is BlueskyMappedPost => Boolean(reply)),
  };
}

export async function fetchBlueskyPost(postId: string, signal?: AbortSignal): Promise<BlueskyMappedPost | null> {
  const thread = await fetchBlueskyPostThread(postId, signal);
  return thread.post;
}

export async function fetchBlueskyProfile(actor: string, signal?: AbortSignal): Promise<BlueskyProfile | null> {
  const normalizedActor = normalizeBlueskyHandle(actor);
  if (!normalizedActor) return null;

  const params = new URLSearchParams({ actor: normalizedActor });
  const response = await fetch(
    `${BSKY_PUBLIC_API}/app.bsky.actor.getProfile?${params.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' }, signal },
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Bluesky profile failed: ${response.status}`);

  return mapBlueskyActorProfile((await response.json()) as BlueskyActorProfile);
}

async function searchBlueskyUncached(query: string, options?: { includePosts?: boolean; signal?: AbortSignal }): Promise<BlueskySearchResults> {
  const q = query.trim();
  if (!q) return { posts: [], users: [] };
  // Lime のハッシュタグリンクは `#タグ` の形で検索ページへ渡す。一方、
  // Bluesky の投稿検索ではタグ記号を外した語の方が安定してヒットするため、
  // 元の語が空振りしたときに使う検索語も用意する。
  const taglessQuery = q.replace(/(^|[\s\u3000])[#＃]+/g, '$1').trim();

  const actorRequest = fetchBlueskySearchEndpoint(
    'app.bsky.actor.searchActors', new URLSearchParams({ q, limit: '25' }), options?.signal,
  );
  // app.bsky.actor.searchActors(通常の検索結果一覧向けAPI)は、実際に
  // 動作確認したところ、表示名が完全一致していてもフォロワー数の多寡に
  // 関わらず結果に含まれないことがある(フォロワー数が少ないから、という
  // わけではなく、検索アルゴリズム自体の相性・ランキングの問題と見られる)。
  // 一方 app.bsky.actor.searchActorsTypeahead(入力補完/オートコンプリート用の
  // 前方一致検索)では、同じキーワードで検索した際に該当アカウントが
  // 1位で返ってくることを実際に確認している。
  // そのため両方を並行して呼び、結果をマージ(重複除去)して検索漏れを減らす。
  // マージの優先順位については後述(typeahead側を先頭に置く)。
  const actorTypeaheadRequest = fetchBlueskySearchEndpoint(
    'app.bsky.actor.searchActorsTypeahead', new URLSearchParams({ q, limit: '25' }), options?.signal,
  ).catch((error) => {
    console.error('Bluesky actor typeahead search failed:', error);
    return null;
  });
  const postRequest = options?.includePosts === false
    ? Promise.resolve(null)
    : fetchBlueskySearchEndpoint(
      'app.bsky.feed.searchPosts', new URLSearchParams({ q, limit: '50' }), options?.signal,
    );
  const [actorOutcome, typeaheadOutcome, postOutcome] = await Promise.allSettled([actorRequest, actorTypeaheadRequest, postRequest]);
  if (actorOutcome.status === 'rejected') throw actorOutcome.reason;
  const actorResponse = actorOutcome.value;
  const typeaheadResponse = typeaheadOutcome.status === 'fulfilled' ? typeaheadOutcome.value : null;
  const postResponse = postOutcome.status === 'fulfilled' ? postOutcome.value : null;
  if (!actorResponse.ok) throw new Error(`Bluesky actor search failed: ${actorResponse.status}`);

  const actorPayload = (await actorResponse.json()) as { actors?: BlueskyActorProfile[] };
  const searchActorsUsers = (actorPayload.actors || [])
    .map(mapBlueskyActorProfile)
    .filter((user): user is BlueskyProfile => Boolean(user));

  // searchActorsTypeaheadの結果を先頭に置く。
  // 以前は searchActors(最大25件)を先に並べ、typeahead側の結果は
  // 重複しないものを「末尾に追加」していたため、searchActorsだけで
  // 25件埋まっている場合、typeaheadでしか見つからないアカウントが
  // 26件目以降に押し出され、その後の呼び出し側で行っている
  // slice(0, 3)(サジェスト表示)や slice(0, 10)(投稿フォールバック用)で
  // 切り捨てられてしまっていた。実際に表示名で完全一致するアカウントが
  // typeaheadでは1位に返ってきているケースを確認したため、
  // 表示名/ハンドル検索の用途としてはtypeahead側の結果を優先する。
  let users: BlueskyProfile[] = [];
  if (typeaheadResponse?.ok) {
    const typeaheadPayload = (await typeaheadResponse.json()) as { actors?: BlueskyActorProfile[] };
    users = (typeaheadPayload.actors || [])
      .map(mapBlueskyActorProfile)
      .filter((user): user is BlueskyProfile => Boolean(user));
  }

  // searchActors側の結果のうち、まだ含まれていないユーザーだけ追加でマージする
  const seenUserIds = new Set(users.map((user) => user.id));
  for (const searchActorsUser of searchActorsUsers) {
    if (!seenUserIds.has(searchActorsUser.id)) {
      seenUserIds.add(searchActorsUser.id);
      users.push(searchActorsUser);
    }
  }

  let posts: BlueskyMappedPost[] = [];
  if (postResponse?.ok) {
    const postPayload = (await postResponse.json()) as { posts?: BlueskyFeedItem['post'][] };
    posts = (postPayload.posts || [])
      .map((post) => mapBlueskyFeedItemToPost({ post }))
      .filter((post): post is BlueskyMappedPost => Boolean(post));
  }

  if (posts.length === 0 && options?.includePosts !== false && taglessQuery && taglessQuery !== q) {
    const taglessResponse = await fetchBlueskySearchEndpoint(
      'app.bsky.feed.searchPosts', new URLSearchParams({ q: taglessQuery, limit: '50' }), options?.signal,
    );
    if (taglessResponse.ok) {
      const taglessPayload = (await taglessResponse.json()) as { posts?: BlueskyFeedItem['post'][] };
      posts = (taglessPayload.posts || [])
        .map((post) => mapBlueskyFeedItemToPost({ post }))
        .filter((post): post is BlueskyMappedPost => Boolean(post));
    }
  }

  if (posts.length === 0 && options?.includePosts !== false) {
    // app.bsky.feed.searchPosts(投稿本文の全文検索API)は、未認証アクセスに対して
    // CDN/WAF側でブロックされており(実際のレスポンスがtext/htmlのエラーページで、
    // かつno-store指定になっており、アプリ本体に届く前にCDNの時点で弾かれている
    // ことを確認済み)、認証なしではBluesky全アカウントを横断した本文検索はできない。
    // そのため、代わりに actor 検索(searchActors/searchActorsTypeahead)で見つかった
    // アカウント自身の投稿だけを対象に、本文一致するものを拾う。
    // これは「関連しそうなアカウントの投稿」しか対象にできないという構造的な限界が
    // あり、Bluesky全体を対象にした検索の代わりにはならないが、対象アカウント数を
    // 増やすことでヒット件数は改善できるため、actor検索で得られた候補(最大30件)
    // 全てのフィードを見に行くようにする(以前は上位10件のみだった)。
    const normalizedQuery = (taglessQuery || q).toLocaleLowerCase();
    const pages = await Promise.all(
      users.slice(0, 30).map((user) => fetchBlueskyAuthorFeed({
        actor: user.username,
        limit: 100,
        filter: 'posts_with_replies',
      }).catch(() => null)),
    );
    posts = pages
      .flatMap((page) => page?.posts || [])
      .filter((post) => post.content.toLocaleLowerCase().includes(normalizedQuery));
  }

  return {
    users,
    posts,
  };
}

export async function searchBluesky(query: string, options?: { includePosts?: boolean; signal?: AbortSignal }): Promise<BlueskySearchResults> {
  const q = query.trim();
  if (!q) return { posts: [], users: [] };
  if (options?.signal) return searchBlueskyUncached(q, options);

  const key = `${options?.includePosts === false ? 'accounts' : 'all'}:${q.toLocaleLowerCase()}`;
  const cached = blueskySearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const inFlight = blueskySearchRequests.get(key);
  if (inFlight) return inFlight;

  const request = searchBlueskyUncached(q, options)
    .then((result) => {
      blueskySearchCache.set(key, { result, expiresAt: Date.now() + BLUESKY_SEARCH_CACHE_TTL_MS });
      return result;
    })
    .finally(() => {
      blueskySearchRequests.delete(key);
    });
  blueskySearchRequests.set(key, request);
  return request;
}

export async function fetchBlueskyAuthorFeed(options?: {
  actor?: string;
  cursor?: string | null;
  limit?: number;
  filter?: 'posts_no_replies' | 'posts_with_replies' | 'posts_and_author_threads';
  signal?: AbortSignal;
}): Promise<BlueskyAuthorFeedPage> {
  const actor = options?.actor || BSKY_AUTHOR_HANDLE;
  const limit = Math.min(100, Math.max(1, options?.limit ?? 30));
  const params = new URLSearchParams({
    actor,
    limit: String(limit),
    filter: options?.filter || 'posts_no_replies',
  });

  if (options?.cursor) {
    params.set('cursor', options.cursor);
  }

  const response = await fetch(
    `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?${params.toString()}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options?.signal,
    },
  );

  if (!response.ok) {
    throw new Error(`Bluesky author feed failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    feed?: BlueskyFeedItem[];
    cursor?: string;
  };

  const posts = (payload.feed || [])
    .map((item) => mapBlueskyFeedItemToPost(item))
    .filter((post): post is BlueskyMappedPost => Boolean(post));

  return {
    posts,
    cursor: payload.cursor || null,
  };
}

// ------------------------------------------------------------------
// トレンド(日本語×いいね数500以上×ランダム表示)
// ------------------------------------------------------------------

// 複数クエリそれぞれの検索カーソルを1つの文字列として持ち回すためのヘルパー。
// 「もっと読み込む」のたびに各クエリのカーソルを個別に進めたいが、
// 呼び出し側(Feed.tsx)には他のBluesky取得と同じく単一のcursor文字列として
// 渡したいため、ここでJSON文字列にエンコード/デコードする。
type TrendingCursorMap = Partial<Record<(typeof TRENDING_SEED_QUERIES)[number], string | null>>;

function encodeTrendingCursor(map: TrendingCursorMap): string | null {
  const hasAny = Object.values(map).some((cursor) => Boolean(cursor));
  if (!hasAny) return null;
  return JSON.stringify(map);
}

function decodeTrendingCursor(cursor: string | null | undefined): TrendingCursorMap {
  if (!cursor) return {};
  try {
    const parsed = JSON.parse(cursor) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as TrendingCursorMap) : {};
  } catch {
    return {};
  }
}

/**
 * トレンドタブ用: 日本語かつ、いいね数が TRENDING_MIN_LIKES 以上、
 * 直近 TRENDING_MAX_AGE_DAYS 日以内に投稿された Bluesky投稿を
 * ランダムな順番で取得する。
 *
 * 実装メモ: Blueskyの公開検索APIは「日本語 × 人気順 × 無作為抽出」を
 * まとめて行うエンドポイントを提供していない。そのため、日本語の文章なら
 * ほぼ必ず含まれる頻出語(助詞・語尾)を複数用意し、それぞれを
 * app.bsky.feed.searchPosts に lang=ja, sort=top で投げて母集団を広げ、
 * 合算結果からいいね数でフィルタし、最後にシャッフルすることで
 * 「日本語のトレンド投稿がランダムに出てくる」体験を近似している。
 */
export async function fetchTrendingJapaneseBlueskyPosts(options?: {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<BlueskyAuthorFeedPage> {
  const perQueryLimit = Math.min(100, Math.max(1, options?.limit ?? 30));
  const cursorMap = decodeTrendingCursor(options?.cursor);

  // 直近 TRENDING_MAX_AGE_DAYS 日以内の投稿だけを対象にする。
  // app.bsky.feed.searchPosts の since パラメータ(ISO日時)でAPI側にも
  // 絞り込みをかけつつ、念のためクライアント側でも createdAt を再チェックする。
  const sinceDate = new Date(Date.now() - TRENDING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();
  const sinceTime = sinceDate.getTime();

  const results = await Promise.all(
    TRENDING_SEED_QUERIES.map(async (seedQuery) => {
      // 前回のページで「このクエリはもう次がない」と分かっている場合はスキップする
      if (seedQuery in cursorMap && !cursorMap[seedQuery]) {
        return { seedQuery, posts: [] as BlueskyMappedPost[], cursor: null as string | null };
      }

      const params = new URLSearchParams({
        q: seedQuery,
        lang: 'ja',
        sort: 'top',
        since: sinceIso,
        limit: String(perQueryLimit),
      });

      const queryCursor = cursorMap[seedQuery];
      if (queryCursor) {
        params.set('cursor', queryCursor);
      }

      try {
        const response = await fetchBlueskySearchEndpoint('app.bsky.feed.searchPosts', params, options?.signal);
        if (!response.ok) {
          return { seedQuery, posts: [] as BlueskyMappedPost[], cursor: null as string | null };
        }

        const payload = (await response.json()) as {
          posts?: BlueskyFeedItem['post'][];
          cursor?: string;
        };

        const posts = (payload.posts || [])
          .map((post) => mapBlueskyFeedItemToPost({ post }))
          .filter((post): post is BlueskyMappedPost =>
            Boolean(post) &&
            post.likesCount >= TRENDING_MIN_LIKES &&
            new Date(post.createdAt).getTime() >= sinceTime,
          );

        return { seedQuery, posts, cursor: payload.cursor || null };
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        console.error(`Bluesky trending search failed for query "${seedQuery}":`, error);
        return { seedQuery, posts: [] as BlueskyMappedPost[], cursor: null as string | null };
      }
    }),
  );

  const nextCursorMap: TrendingCursorMap = {};
  const seenIds = new Set<string>();
  const combinedPosts: BlueskyMappedPost[] = [];

  for (const result of results) {
    nextCursorMap[result.seedQuery] = result.cursor;
    for (const post of result.posts) {
      if (seenIds.has(post.id)) continue;
      seenIds.add(post.id);
      combinedPosts.push(post);
    }
  }

  // 複数クエリ分をまとめてシャッフルする(Fisher-Yates)。
  // これにより、同じクエリの結果が固まって並ぶことなくランダムに見える。
  for (let i = combinedPosts.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [combinedPosts[i], combinedPosts[j]] = [combinedPosts[j], combinedPosts[i]];
  }

  return {
    posts: combinedPosts,
    cursor: encodeTrendingCursor(nextCursorMap),
  };
}

// ------------------------------------------------------------------
// フォロー/フォロワー一覧
// ------------------------------------------------------------------

async function fetchBlueskyFollowList(
  endpoint: 'app.bsky.graph.getFollowers' | 'app.bsky.graph.getFollows',
  resultKey: 'followers' | 'follows',
  options: { actor: string; cursor?: string | null; limit?: number; signal?: AbortSignal },
): Promise<BlueskyFollowListPage> {
  const actor = normalizeBlueskyHandle(options.actor);
  if (!actor) return { users: [], cursor: null };

  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const params = new URLSearchParams({ actor, limit: String(limit) });
  if (options.cursor) {
    params.set('cursor', options.cursor);
  }

  const response = await fetch(
    `${BSKY_PUBLIC_API}/${endpoint}?${params.toString()}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    },
  );

  // アカウントが存在しない/非公開などの場合は空リストとして扱う
  if (response.status === 404) return { users: [], cursor: null };
  if (!response.ok) {
    throw new Error(`Bluesky ${endpoint} failed: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown> & { cursor?: string };
  const rawList = (payload[resultKey] as BlueskyActorProfile[] | undefined) || [];
  const users = rawList
    .map(mapBlueskyActorProfile)
    .filter((user): user is BlueskyProfile => Boolean(user));

  return {
    users,
    cursor: payload.cursor || null,
  };
}

export async function fetchBlueskyFollowers(options: {
  actor: string;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<BlueskyFollowListPage> {
  return fetchBlueskyFollowList('app.bsky.graph.getFollowers', 'followers', options);
}

export async function fetchBlueskyFollows(options: {
  actor: string;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<BlueskyFollowListPage> {
  return fetchBlueskyFollowList('app.bsky.graph.getFollows', 'follows', options);
}

// BlueskyのDIDは "did:" で始まるため、これでLimeの内部ユーザーと区別できる
export function isBlueskyProfileId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('did:');
}

export function mergePostsByCreatedAt<T extends { id: string; createdAt: string }>(
  ...groups: T[][]
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const group of groups) {
    for (const post of group) {
      if (!post?.id || seen.has(post.id)) continue;
      seen.add(post.id);
      merged.push(post);
    }
  }

  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return merged;
}