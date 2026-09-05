// 初期状態ではBlueskyアカウントを1件も登録しない。
// BSKY_AUTHOR_HANDLE は既存コードとの互換性のためだけに残し、既定の登録先には使用しない。
export const BSKY_AUTHOR_HANDLES = [] as const;
export const BSKY_AUTHOR_HANDLE = 'jp.bsky.app';
export const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';
const BSKY_SEARCH_API = 'https://api.bsky.app/xrpc';
export const BSKY_HANDLES_STORAGE_KEY = 'lime_bluesky_author_handles';

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
    if (attempt === 0 && lastResponse && (lastResponse.status === 403 || lastResponse.status === 429 || lastResponse.status >= 500)) {
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

const getBlueskyUriFromPostId = (postId: string) => {
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
  const postRequest = options?.includePosts === false
    ? Promise.resolve(null)
    : fetchBlueskySearchEndpoint(
      'app.bsky.feed.searchPosts', new URLSearchParams({ q, limit: '50' }), options?.signal,
    );
  const [actorOutcome, postOutcome] = await Promise.allSettled([actorRequest, postRequest]);
  if (actorOutcome.status === 'rejected') throw actorOutcome.reason;
  const actorResponse = actorOutcome.value;
  const postResponse = postOutcome.status === 'fulfilled' ? postOutcome.value : null;
  if (!actorResponse.ok) throw new Error(`Bluesky actor search failed: ${actorResponse.status}`);

  const actorPayload = (await actorResponse.json()) as { actors?: BlueskyActorProfile[] };
  const users = (actorPayload.actors || [])
    .map(mapBlueskyActorProfile)
    .filter((user): user is BlueskyProfile => Boolean(user));

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
    // 検索用エンドポイントが地域/CDN側で拒否される場合でも、検索結果全体を
    // 空にしない。該当アカウントの公開フィードから本文一致する投稿を補完する。
    const normalizedQuery = (taglessQuery || q).toLocaleLowerCase();
    const pages = await Promise.all(
      users.slice(0, 10).map((user) => fetchBlueskyAuthorFeed({
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
