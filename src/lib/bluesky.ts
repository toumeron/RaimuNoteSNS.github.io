import { cloudExternalHandles, saveExternalProviderHandles } from './externalAccounts';
import {externalFetch, accountSearchScore} from './utils';
import { searchMisskey, configuredMisskeyHandles, isMisskeyActor, isMisskeyId, misskeyFeed, misskeyProfile, misskeyThread, misskeyFollowList, misskeyRequest, mapMisskeyNote, type MisskeyNote, misskeyEnabled, misskeyViewer, likeMisskey, unlikeMisskey, misskeyFollowState, followMisskey, unfollowMisskey } from './misskey';
import {singlePreviewUrl,type LinkPreview} from './linkPreview';
import {TOPICS,matchingTopics,type TopicId} from './topics';
import { ACTIVE_ACCOUNT_KEY } from './savedAccounts';
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
  if(trimmed.startsWith('did:'))return trimmed;
  const profileMatch = trimmed.match(/^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#]+)/i);
  const normalized = (profileMatch?.[1] ?? trimmed)
    .replace(/^@+/, '')
    .replace(/\/$/, '')
    .toLowerCase();
  return normalized;
}

export function getConfiguredBlueskyHandles(): string[] {
  const cloud = cloudExternalHandles('bluesky');
  if (cloud !== null) return cloud;
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

export async function saveConfiguredBlueskyHandles(handles: string[]): Promise<string[]> {
  return saveExternalProviderHandles('bluesky', handles.map(normalizeBlueskyHandle).filter(Boolean));
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
  const owner = window.localStorage.getItem(ACTIVE_ACCOUNT_KEY);
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

  if (window.localStorage.getItem(ACTIVE_ACCOUNT_KEY) !== owner) throw new Error('アカウントが切り替わりました。もう一度ログインしてください');
  saveBlueskySession(session);
  return session;
}

/**
 * accessJwtが失効した場合にrefreshJwtでセッションを更新する。
 * refreshJwtの失効が確認できた場合だけ保存セッションを削除する。一時的な失敗では保持する。
 */
let sessionRefresh: {token:string;owner:string|null;promise:Promise<BlueskySession|null>}|null=null;
export async function refreshBlueskySession(): Promise<BlueskySession | null> {
  const current=getStoredBlueskySession();
  if(!current)return null;
  const owner=window.localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  if(sessionRefresh?.token===current.refreshJwt&&sessionRefresh.owner===owner)return sessionRefresh.promise;
  const stillCurrent=()=>window.localStorage.getItem(ACTIVE_ACCOUNT_KEY)===owner&&getStoredBlueskySession()?.refreshJwt===current.refreshJwt;
  const perform=async()=>{
    if(!stillCurrent()){
      const latest=getStoredBlueskySession();
      return window.localStorage.getItem(ACTIVE_ACCOUNT_KEY)===owner&&latest?.did===current.did?latest:null;
    }
    const response=await fetch(`${BSKY_PDS_API}/com.atproto.server.refreshSession`,{method:'POST',headers:{Authorization:`Bearer ${current.refreshJwt}`}});
    if(!response.ok){
      const error=await response.clone().json().catch(()=>({}));
      // Network/server/rate-limit failures do not invalidate saved login credentials.
      if((response.status===400||response.status===401)&&['ExpiredToken','InvalidToken','AccountTakedown'].includes(error.error)&&stillCurrent())saveBlueskySession(null);
      throw new Error(`Blueskyのログイン更新に失敗しました (${response.status})`);
    }
    const data=await response.json() as BlueskySession;
    if(!data.did||!data.handle||!data.accessJwt||!data.refreshJwt)throw new Error('Blueskyのログイン更新の応答が不正です');
    if(!stillCurrent()){
      const latest=getStoredBlueskySession();
      return window.localStorage.getItem(ACTIVE_ACCOUNT_KEY)===owner&&latest?.did===current.did?latest:null;
    }
    const session={...current,...data};saveBlueskySession(session);return session;
  };
  const promise=typeof navigator!=='undefined'&&navigator.locks
    ?navigator.locks.request(`lime-bluesky-refresh:${owner??'guest'}`,perform).then(result=>result):perform();
  sessionRefresh={token:current.refreshJwt,owner,promise};
  try{return await promise;}finally{if(sessionRefresh?.promise===promise)sessionRefresh=null;}
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

  if (await isExpiredOrInvalidTokenResponse(response)) {
    const refreshed = await refreshBlueskySession();
    if (!refreshed) throw new Error('Blueskyのセッションが失効しました。再度ログインしてください');
    response = await call(refreshed.accessJwt);
  }

  return response;
}

// AT ProtocolのXRPCは、アクセストークンが期限切れ/無効な場合、
// 401ではなく 400 + {"error":"ExpiredToken"} (または "InvalidToken") を
// 返すことがある(実際、公式PDSの挙動として確認済み)。
// 401だけを見ていると、期限切れのたびに何もせず失敗レスポンスをそのまま
// 返してしまい、いいね/フォロー等が常に失敗する不具合につながっていた。
// レスポンスボディは一度しか読めないため、判定には clone() を使う。
async function isExpiredOrInvalidTokenResponse(response: Response): Promise<boolean> {
  if (response.status === 401) return true;
  if (response.status !== 400) return false;

  try {
    const payload = await response.clone().json() as { error?: string };
    return payload?.error === 'ExpiredToken' || payload?.error === 'InvalidToken';
  } catch {
    return false;
  }
}

// AT Protocolでは、自分のPDS経由で app.bsky.* (AppView側)のメソッドを呼ぶ際、
// どのAppViewに転送してほしいかを atproto-proxy ヘッダーで明示する必要がある。
// これを付けずに呼ぶと、PDSの実装によっては 501/400 等で失敗し、
// (エラーにならずレスポンスが単に空/失敗として返ってくることもある)、
// 結果として「いいね済みか」「cid」が取得できずいいねができない、
// という不具合につながる。com.atproto.repo.* (createRecord/deleteRecord)は
// PDSがネイティブに処理するメソッドなので、このヘッダーは不要かつ付けない。
const BSKY_APPVIEW_PROXY_DID = 'did:web:api.bsky.app#bsky_appview';

async function authorizedBlueskyAppViewFetch(
  endpoint: string,
  init: RequestInit = {}
): Promise<Response> {
  return authorizedBlueskyFetch(endpoint, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'atproto-proxy': BSKY_APPVIEW_PROXY_DID,
    },
  });
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
  if (uri.startsWith('https://misskey.io/notes/')) return misskeyViewer(uri,signal);
  const session = getStoredBlueskySession();
  if (!session) return { likeUri: null, cid: null };

  try {
    const params = new URLSearchParams({ uri, depth: '0' });
    const response = await authorizedBlueskyAppViewFetch(
      `app.bsky.feed.getPostThread?${params.toString()}`,
      { method: 'GET', signal }
    );

    if (response.ok) {
      const payload = (await response.json()) as {
        thread?: { post?: { cid?: string; viewer?: { like?: string } } };
      };

      const cid = payload.thread?.post?.cid ?? null;
      if (cid) {
        return {
          likeUri: payload.thread?.post?.viewer?.like ?? null,
          cid,
        };
      }
      // cidが取れなかった場合は下の公開APIフォールバックへ続ける
    } else {
      console.warn('Bluesky post thread (authorized) failed:', response.status, uri);
    }
  } catch (error) {
    console.error('Fetch Bluesky post viewer state (authorized) failed:', error);
  }

  // 認証付き取得(PDS経由でのAppViewプロキシ)に失敗しても、
  // いいね自体は可能な限り行えるよう、公開APIからcidだけでも取得しておく。
  // この場合、現在いいね済みかどうかは判定できない(likeUriはnullのまま)ため
  // UI上は「未いいね」扱いになるが、クリックすれば新規にいいねできる。
  try {
    const params = new URLSearchParams({ uri, depth: '0' });
    const response = await fetch(
      `${BSKY_PUBLIC_API}/app.bsky.feed.getPostThread?${params.toString()}`,
      { method: 'GET', headers: { Accept: 'application/json' }, signal }
    );

    if (!response.ok) return { likeUri: null, cid: null };

    const payload = (await response.json()) as { thread?: { post?: { cid?: string } } };
    return { likeUri: null, cid: payload.thread?.post?.cid ?? null };
  } catch (error) {
    console.error('Fetch Bluesky post cid (public fallback) failed:', error);
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
  if (isMisskeyId(did)) return misskeyFollowState(did,signal);
  const session = getStoredBlueskySession();
  if (!session) return { followUri: null };

  try {
    const params = new URLSearchParams({ actor: did });
    const response = await authorizedBlueskyAppViewFetch(
      `app.bsky.actor.getProfile?${params.toString()}`,
      { method: 'GET', signal }
    );

    if (!response.ok) {
      console.warn('Bluesky actor profile (authorized) failed:', response.status, did);
      return { followUri: null };
    }

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
  if (uri.startsWith('https://misskey.io/notes/')) return likeMisskey(uri);
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
  recommendationLikesCache.clear();
  return data.uri;
}

/**
 * いいねを解除する。likeUriは likeBlueskyPost または
 * fetchBlueskyPostViewerState で取得した app.bsky.feed.like レコードのuri
 * (at://did/app.bsky.feed.like/rkey 形式)。
 */
export async function unlikeBlueskyPost(likeUri: string): Promise<void> {
  if (likeUri.startsWith('misskey-reaction:')) return unlikeMisskey(likeUri);
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
  recommendationLikesCache.clear();
}

/**
 * 指定したdidのBlueskyアカウントをフォローする。
 * 成功時は作成された app.bsky.graph.follow レコードのuriを返す。
 */
export async function followBlueskyUser(did: string): Promise<string> {
  if (isMisskeyId(did)) return followMisskey(did);
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
  if (followUri.startsWith('misskey-follow:')) return unfollowMisskey(followUri);
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
  languages?: string[];
  recommendationLanguages?: string[];
  imageAltTexts?: string[];
  contentLabels?: string[];
  recommendationTopics?: string[];
  recommendationSources?: string[];
  linkPreview?:LinkPreview;
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
  source: 'bluesky' | 'misskey';
  isQuote?: boolean;
  parentId?: string | null;
  parentPost?: import('@/types').PostWithAuthor | null;
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
  postsCount?: number;
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
  images?: Array<{ fullsize?: string; thumb?: string;alt?:string }>;
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
      langs?: string[];
      createdAt?: string;
      facets?: Array<{
        index?: { byteStart?: number; byteEnd?: number };
        features?: Array<{ $type?: string; uri?: string }>;
      }>;
    };
    embed?: BlueskyEmbed;
    labels?:Array<{val?:string}>;
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
  postsCount?: number;
};

type BlueskyThreadView = {
  post?: BlueskyFeedItem['post'];
  replies?: BlueskyThreadView[];
};

const uniqueStrings = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const validBlueskyHandle = (handle:string | undefined, did:string) => handle && handle !== 'handle.invalid' ? handle : did;

function mapBlueskyActorProfile(profile: BlueskyActorProfile): BlueskyProfile | null {
  if (!profile.did) return null;
  return {
    id: profile.did,
    username: validBlueskyHandle(profile.handle, profile.did),
    displayName: profile.displayName || validBlueskyHandle(profile.handle, profile.did),
    avatarUrl: profile.avatar || '',
    coverUrl: profile.banner || '',
    bio: profile.description || '',
    createdAt: profile.createdAt || new Date().toISOString(),
    isOfficial: false,
    followersCount: profile.followersCount ?? 0,
    followingCount: profile.followsCount ?? 0,
    postsCount: profile.postsCount ?? 0,
  };
}

const searchEndpointCooldown=new Map<string,number>();
async function fetchBlueskySearchEndpoint(
  endpoint: string,
  params: URLSearchParams,
  signal?: AbortSignal,
  priority:'interactive'|'supplementary'='supplementary',
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 公開 AppView はブラウザからの未認証 GET 用に提供されているため、
    // まずこちらを使う。CDN/CORS などで一方が失敗しても、もう一方を試す。
    for (const baseUrl of [BSKY_PUBLIC_API, BSKY_SEARCH_API]) {
      const cooldownKey=baseUrl+'/'+endpoint;
      if((searchEndpointCooldown.get(cooldownKey)??0)>Date.now())continue;
      try {
        const response = await externalFetch(`${baseUrl}/${endpoint}?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        },priority);
        if (response.ok) return response;
        lastResponse = response;
        if(response.status===403||response.status===429)searchEndpointCooldown.set(cooldownKey,Date.now()+60000);
      } catch (error) {
        if (signal?.aborted) throw error;
        searchEndpointCooldown.set(cooldownKey,Date.now()+60000);
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

// Legacy shared UI guard: both providers must bypass native UUID mutations.
export function isBlueskyPost(post: { id?: string; source?: string } | null | undefined): boolean {
  if (!post) return false;
  return post.source === 'bluesky' || String(post.id || '').startsWith('bsky:') || isMisskeyId(post.id);
}

export function getBlueskyPostUrl(
  post: { blueskyUrl?: string; author?: { username?: string }; id?: string } | null | undefined,
): string | null {
  if (!post) return null;
  if (post.id?.startsWith('misskey:')) return post.id.slice('misskey:'.length);
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
  if (!post?.uri || !post.author?.did) return null;
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
  const external=post.embed?.external??post.embed?.media?.external;
  let linkPreview:LinkPreview|undefined;
  if((external?.title||external?.description)&&external.uri&&singlePreviewUrl(content)===external.uri&&(!external.thumb||/^https?:\/\//.test(external.thumb))){
    try{linkPreview={url:external.uri,domain:new URL(external.uri).hostname.replace(/^www\./,''),title:external.title||new URL(external.uri).hostname,image:external.thumb||'',description:external.description};}catch{/* Keep the text link. */}
  }

  return {
    id: `bsky:${post.uri}`,
    userId: post.author.did,
    content,
    imageUrls,
    languages:post.record?.langs??[],
    imageAltTexts:(post.embed?.images??post.embed?.media?.images??[]).map(image=>image.alt??''),
    contentLabels:(post.labels??[]).flatMap(label=>label.val?[label.val]:[]),
    linkPreview,
    createdAt: post.record?.createdAt || post.indexedAt || new Date().toISOString(),
    visibility: 'public',
    likedByMe: false,
    likesCount: post.likeCount ?? 0,
    commentsCount: post.replyCount ?? 0,
    isBot: false,
    cid: post.cid || '',
    author: {
      id: post.author.did,
      username: validBlueskyHandle(post.author.handle, post.author.did),
      displayName: post.author.displayName || validBlueskyHandle(post.author.handle, post.author.did),
      avatarUrl: post.author.avatar || '',
      // Blueskyから取得したユーザーをLimeの公式ユーザーとして扱わない。
      // Lime側の公式認証情報がない限り、認証バッジは表示しない。
      isOfficial: false,
      bio: post.author.description || '',
      createdAt: post.author.createdAt || post.record?.createdAt || new Date().toISOString(),
    },
    source: 'bluesky',
    blueskyUrl: `https://bsky.app/profile/${validBlueskyHandle(post.author.handle, post.author.did)}/post/${rkey}`,
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
  if (decodedId.startsWith('misskey:')) return decodedId.slice('misskey:'.length);
  const uri = decodedId.startsWith('bsky:') ? decodedId.slice('bsky:'.length) : decodedId;
  return uri.startsWith('at://') ? uri : null;
};

// Read only the authenticated account's likes, on a requested recommendation
// page. The API disallows another account's private likes.
const recommendationLikesCache=new Map<string,{at:number;posts:BlueskyMappedPost[]}>();
export async function fetchBlueskyLikedPosts(signal?:AbortSignal):Promise<BlueskyMappedPost[]> {
 const session=getStoredBlueskySession();if(!session)return [];
 const owner=window.localStorage.getItem(ACTIVE_ACCOUNT_KEY),key=`${owner}:${session.did}`;
 const cached=recommendationLikesCache.get(key);if(cached&&Date.now()-cached.at<600000)return cached.posts;
 const params=new URLSearchParams({actor:session.did,limit:'100'});
 const response=await authorizedBlueskyAppViewFetch(`app.bsky.feed.getActorLikes?${params}`,{signal});
 if(!response.ok)throw new Error(`Own likes unavailable: ${response.status}`);
 const payload=await response.json() as {feed?:BlueskyFeedItem[]};
 if(signal?.aborted||window.localStorage.getItem(ACTIVE_ACCOUNT_KEY)!==owner||getStoredBlueskySession()?.did!==session.did)return [];
 const posts=(payload.feed??[]).map(mapBlueskyFeedItemToPost).filter((post):post is BlueskyMappedPost=>!!post);
 recommendationLikesCache.set(key,{at:Date.now(),posts});return posts;
}

export async function fetchBlueskyPostThread(postId: string, signal?: AbortSignal): Promise<BlueskyPostThread> {
  if (isMisskeyId(postId)) return misskeyThread(postId, signal);
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
  if (isMisskeyActor(actor)) return misskeyProfile(actor, signal);
  const normalizedActor = normalizeBlueskyHandle(actor);
  if (!normalizedActor) return null;

  const params = new URLSearchParams({ actor: normalizedActor });
  const response = await externalFetch(
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
    if (options?.signal?.aborted || error?.name === 'AbortError') throw error;
    console.error('Bluesky actor typeahead search failed:', error);
    return null;
  });
  const postRequest = options?.includePosts === false
    ? Promise.resolve(null)
    : fetchBlueskySearchEndpoint(
      'app.bsky.feed.searchPosts', new URLSearchParams({ q, limit: '30' }), options?.signal,
    );
  const [actorOutcome, typeaheadOutcome, postOutcome] = await Promise.allSettled([actorRequest, actorTypeaheadRequest, postRequest]);
  if(options?.signal?.aborted)throw options.signal.reason;
  const actorResponse = actorOutcome.status==='fulfilled' ? actorOutcome.value:null;
  const typeaheadResponse = typeaheadOutcome.status === 'fulfilled' ? typeaheadOutcome.value : null;
  const postResponse = postOutcome.status === 'fulfilled' ? postOutcome.value : null;
  if (!actorResponse?.ok && !typeaheadResponse?.ok && !postResponse?.ok) throw new Error('Bluesky検索を取得できませんでした');

  const actorPayload = (actorResponse?.ok ? await actorResponse.json() : {}) as { actors?: BlueskyActorProfile[] };
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
      'app.bsky.feed.searchPosts', new URLSearchParams({ q: taglessQuery, limit: '30' }), options?.signal,
    );
    if (taglessResponse.ok) {
      const taglessPayload = (await taglessResponse.json()) as { posts?: BlueskyFeedItem['post'][] };
      posts = (taglessPayload.posts || [])
        .map((post) => mapBlueskyFeedItemToPost({ post }))
        .filter((post): post is BlueskyMappedPost => Boolean(post));
    }
  }

  if (posts.length === 0 && options?.includePosts !== false) {
    // A failed global search must not fan out into thousands of author posts.
    const normalizedQuery = (taglessQuery || q).toLocaleLowerCase();
    const pages = await Promise.all(
      users.slice(0, 4).map((user) => fetchBlueskyAuthorFeed({
        actor: user.id,
        limit: 20,
        signal: options?.signal,
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
  if(options?.signal?.aborted)throw options.signal.reason;
  const key = `${options?.includePosts === false ? 'accounts' : 'all'}:${q.toLocaleLowerCase()}`;
  const cached = blueskySearchCache.get(key) || (options?.includePosts===false ? blueskySearchCache.get(`all:${q.toLocaleLowerCase()}`):undefined);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  if(options?.signal) {
    const result=await searchBlueskyUncached(q,options);
    if(!options.signal.aborted)blueskySearchCache.set(key,{result,expiresAt:Date.now()+BLUESKY_SEARCH_CACHE_TTL_MS});
    return result;
  }
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
  filter?: 'posts_no_replies' | 'posts_with_replies' | 'posts_and_author_threads' | 'posts_with_media';
  signal?: AbortSignal;
}): Promise<BlueskyAuthorFeedPage> {
  if (options?.actor && isMisskeyActor(options.actor)) return misskeyFeed(options);
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

  const response = await externalFetch(
    `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?${params.toString()}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options?.signal,
    },
    'interactive',
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
type TrendingCursorMap = Partial<Record<(typeof TRENDING_SEED_QUERIES)[number], string | null>> & {queryRound?:number};

function encodeTrendingCursor(map: TrendingCursorMap): string | null {
  const hasAny = TRENDING_SEED_QUERIES.some(seed => !(seed in map) || Boolean(map[seed]));
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
async function fetchBlueskyTrendingPosts(options?: {
  cursor?: string | null;
  limit?: number;
  queryLimit?: number;
  signal?: AbortSignal;
}): Promise<BlueskyAuthorFeedPage> {
  const perQueryLimit = Math.min(100, Math.max(1, options?.limit ?? 30));
  const cursorMap = decodeTrendingCursor(options?.cursor);

  const round=cursorMap.queryRound??0;
  const seeds=options?.queryLimit ? Array.from({length:Math.min(TRENDING_SEED_QUERIES.length,Math.max(1,options.queryLimit))},(_,i)=>TRENDING_SEED_QUERIES[(round+i)%TRENDING_SEED_QUERIES.length]) : TRENDING_SEED_QUERIES;

  // 直近 TRENDING_MAX_AGE_DAYS 日以内の投稿だけを対象にする。
  // app.bsky.feed.searchPosts の since パラメータ(ISO日時)でAPI側にも
  // 絞り込みをかけつつ、念のためクライアント側でも createdAt を再チェックする。
  const sinceDate = new Date(Date.now() - TRENDING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();
  const sinceTime = sinceDate.getTime();

  const results = await Promise.all(
    seeds.map(async (seedQuery) => {
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

  const nextCursorMap: TrendingCursorMap = {...cursorMap};
  if(options?.queryLimit)nextCursorMap.queryRound=round+seeds.length;
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
  if (isMisskeyActor(options.actor)) return misskeyFollowList(options.actor,false,options.cursor,options.limit,options.signal);
  return fetchBlueskyFollowList('app.bsky.graph.getFollowers', 'followers', options);
}

export async function fetchBlueskyFollows(options: {
  actor: string;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<BlueskyFollowListPage> {
  if (isMisskeyActor(options.actor)) return misskeyFollowList(options.actor,true,options.cursor,options.limit,options.signal);
  return fetchBlueskyFollowList('app.bsky.graph.getFollows', 'follows', options);
}

// BlueskyのDIDは "did:" で始まるため、これでLimeの内部ユーザーと区別できる
export function isBlueskyProfileId(id: string | null | undefined): boolean {
  return typeof id === 'string' && (id.startsWith('did:') || id.startsWith('misskey-user:'));
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
/** Personalized discovery has no global trending like-count threshold. */
// Public creator/art feeds inspected on 2026-10-08. They include image posts
// independent of Japanese body text; generated-art declarations are checked
// again by the recommendation ranker rather than trusting a feed's promise.
export const BLUESKY_ART_FEEDS=[
 'at://did:plc:y7crv2yh74s7qhmtx3mvbgv5/app.bsky.feed.generator/art-new',
 'at://did:plc:odqmsar3ikz5ubokya4sempk/app.bsky.feed.generator/aaabhy3bowhbo',
] as const;
export async function fetchBlueskyTopicFeed(options:{topic:TopicId;feed:string;cursor?:string|null;limit?:number;signal?:AbortSignal}):Promise<BlueskyAuthorFeedPage> {
 const params=new URLSearchParams({feed:options.feed,limit:String(Math.min(30,options.limit??20))});
 if(options.cursor)params.set('cursor',options.cursor);
 const response=await fetchBlueskySearchEndpoint('app.bsky.feed.getFeed',params,options.signal,'interactive');
 if(!response.ok)throw new Error(`Topic feed unavailable: ${response.status}`);
 const data=await response.json() as {feed?:BlueskyFeedItem[];cursor?:string};
 return {posts:(data.feed??[]).map(mapBlueskyFeedItemToPost).filter((post):post is BlueskyMappedPost=>!!post).map(post=>({...post,recommendationTopics:[options.topic],recommendationSources:[options.feed],recommendationLanguages:options.topic==='digital-illustration'?['ja']:topicFeedLanguages.get(options.feed)??[]})),cursor:data.cursor??null};
}
const TOPIC_FEED_QUERIES:Record<TopicId,string>={economy:'stocks',politics:'politics',sports:'sports',business:'finance',science:'science',technology:'tech',ai:'AI',art:'アート','digital-illustration':'萌え',film:'movies',games:'gaming',crypto:'crypto',travel:'travel',anime:'anime',food:'food',career:'career',pets:'pets',music:'music',design:'design',fashion:'fashion',memes:'memes',fitness:'fitness'};
export const BLUESKY_DIGITAL_ILLUSTRATION_FEEDS=[
 // Original works, Japanese popular artwork, and recent creator artwork.
 // No single game/franchise supplies the entire cold-start candidate pool.
 'at://did:plc:pbznmgl4g4srad5kabmmfkmi/app.bsky.feed.generator/aaaewbdiflbom',
 'at://did:plc:ujbv5agep7botiks7dozqbo3/app.bsky.feed.generator/aaajfu5lurq44',
 'at://did:plc:hqzn6bi5qyyqvjkuiuo7j4oc/app.bsky.feed.generator/aaajsnvcw64q4',
] as const;
const topicFeedLanguages=new Map<string,string[]>();
const topicFeedCache=new Map<TopicId,{feeds:string[];expires:number}>();
export async function discoverBlueskyTopicFeeds(topic:TopicId,signal?:AbortSignal):Promise<string[]> {
 if(topic==='digital-illustration')return [...BLUESKY_DIGITAL_ILLUSTRATION_FEEDS];
 const cached=topicFeedCache.get(topic);if(cached&&cached.expires>Date.now())return cached.feeds;
 const query=TOPIC_FEED_QUERIES[topic];
 const local=!['economy','business','crypto'].includes(topic);
 const japaneseQuery=TOPICS.find(item=>item.id===topic)!.queries[0];
 const response=await fetchBlueskySearchEndpoint('app.bsky.unspecced.getPopularFeedGenerators',new URLSearchParams({query:local?japaneseQuery:query,limit:'15'}),signal);
 if(!response.ok)throw new Error(`Topic discovery unavailable: ${response.status}`);
 const data=await response.json() as {feeds?:Array<{uri:string;displayName?:string;description?:string;likeCount?:number}>};
 const feeds=(data.feeds??[]).map(feed=>{
  const text=`${feed.displayName??''} ${feed.description??''}`;
  // The feed's subject must match its title. A description saying "no AI"
  // or mentioning an artist's career must not turn art into an AI/career feed.
  const title=feed.displayName??'';
  const related=matchingTopics(title).includes(topic)||new RegExp(`\\b${query}\\b`,'i').test(title)||title.toLowerCase().startsWith(`${query.toLowerCase()}sky`);
  const japanese=/[\u3040-\u30ff]|日本|japanese|japan/i.test(text);
  if(japanese)topicFeedLanguages.set(feed.uri,['ja']);
  return {feed,related,japanese,score:(title.trim().toLowerCase()===query.toLowerCase()?10:0)+(/日本|japanese|japan/i.test(text)?5:0)+Math.log1p(feed.likeCount??0)};
 }).filter(row=>row.related&&(!local||row.japanese)&&/^at:\/\/did:[^/]+\/app\.bsky\.feed\.generator\/[^/]+$/.test(row.feed.uri)&&! /\bnsfw\b/i.test(row.feed.displayName??'')&&!(topic==='art'&&/AIイラスト|AIart|AI画像|生成AI|midjourney|stable diffusion/i.test(row.feed.displayName??'')))
 .sort((a,b)=>b.score-a.score)
 // Independently maintained feeds provide different candidate populations.
 .filter((row,index,all)=>all.findIndex(other=>other.feed.uri.split('/')[2]===row.feed.uri.split('/')[2])===index)
 .slice(0,2).map(row=>row.feed.uri);
 // Cache discovery in memory, without periodic refresh or account storage.
 topicFeedCache.set(topic,{feeds,expires:Date.now()+15*60000});
 return feeds;
}
export async function fetchBlueskyTopicPosts(options: {query:string;cursor?:string|null;limit?:number;signal?:AbortSignal}):Promise<BlueskyAuthorFeedPage> {
  const params=new URLSearchParams({q:options.query,lang:'ja',sort:'latest',limit:String(options.limit ?? 20),since:new Date(Date.now()-30*86400000).toISOString()});
  if(options.cursor) params.set('cursor',options.cursor);
  const response=await fetchBlueskySearchEndpoint('app.bsky.feed.searchPosts',params,options.signal);
  if(!response.ok) throw new Error(`Bluesky topic search failed: ${response.status}`);
  const data=await response.json() as {posts?:BlueskyFeedItem['post'][];cursor?:string};
  return {posts:(data.posts ?? []).map(post=>mapBlueskyFeedItemToPost({post})).filter((post):post is BlueskyMappedPost=>!!post),cursor:data.cursor ?? null};
}

// Historical Bluesky-named readers above dispatch external IDs to their own provider.
export function getConfiguredExternalHandles() { return [...getConfiguredBlueskyHandles(),...configuredMisskeyHandles()]; }

export async function fetchTrendingJapaneseBlueskyPosts(options?:{cursor?:string|null;limit?:number;queryLimit?:number;signal?:AbortSignal}):Promise<BlueskyAuthorFeedPage> {
  const results=await Promise.allSettled([
    fetchBlueskyTrendingPosts(options),
    !options?.cursor && misskeyEnabled() ? misskeyRequest<MisskeyNote[]>('notes/featured',{limit:options?.limit || 30},options?.signal).then(notes=>notes.map(note=>mapMisskeyNote(note)).filter((post):post is BlueskyMappedPost=>Boolean(post))) : Promise.resolve([]),
  ]);
  const bluesky=results[0].status==='fulfilled' ? results[0].value : {posts:[],cursor:null};
  const misskey=results[1].status==='fulfilled' ? results[1].value : [];
  if (options?.signal?.aborted) throw options.signal.reason;
  // Keep the existing external candidate budget. Adding a provider must not
  // double its weight against LimeNote or replace the existing Bluesky pool.
  const limit=Math.min(100,Math.max(1,options?.limit ?? 30));
  const extra=misskey.slice(0,bluesky.posts.length ? Math.floor(limit/3) : limit);
  const base=bluesky.posts.slice(0,limit-extra.length);
  const posts:BlueskyMappedPost[]=[];
  while(base.length || extra.length) {
    posts.push(...base.splice(0,2),...extra.splice(0,1));
  }
  return {posts,cursor:bluesky.cursor};
}

// Both search surfaces publish one ranked list after the readers settle.
export async function searchExternalUsers(query:string,options:{includeBluesky?:boolean;signal?:AbortSignal;limit?:number}={}):Promise<BlueskyProfile[]> {
  const normalized=query.trim().replace(/^@+/, '');
  if(!normalized)return [];
  const results=await Promise.allSettled([
    options.includeBluesky===false ? Promise.resolve({users:[]}):searchBluesky(normalized,{includePosts:false,signal:options.signal}),
    searchMisskey(normalized,false,options.signal),
  ]);
  if(options.signal?.aborted)throw options.signal.reason;
  if(results.every(result=>result.status==='rejected'))throw (results[0] as PromiseRejectedResult).reason;
  const users=results.flatMap(result=>result.status==='fulfilled' ? result.value.users:[]);
  return [...new Map(users.map(user=>[user.id,user])).values()]
    .sort((a,b)=>accountSearchScore(b,normalized)-accountSearchScore(a,normalized))
    .slice(0,options.limit ?? 3);
}
