// 初期状態ではBlueskyアカウントを1件も登録しない。
// BSKY_AUTHOR_HANDLE は既存コードとの互換性のためだけに残し、既定の登録先には使用しない。
export const BSKY_AUTHOR_HANDLES = [] as const;
export const BSKY_AUTHOR_HANDLE = 'jp.bsky.app';
export const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';
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

const uniqueStrings = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

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

export async function fetchBlueskyAuthorFeed(options?: {
  actor?: string;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<BlueskyAuthorFeedPage> {
  const actor = options?.actor || BSKY_AUTHOR_HANDLE;
  const limit = Math.min(100, Math.max(1, options?.limit ?? 30));
  const params = new URLSearchParams({
    actor,
    limit: String(limit),
    filter: 'posts_no_replies',
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
