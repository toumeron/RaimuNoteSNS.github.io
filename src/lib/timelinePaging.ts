import type { PostWithAuthor } from '@/types';
import type { BlueskyAuthorFeedPage } from '@/lib/bluesky';
import type { FeedCursor } from '@/api/posts';

const SOURCE_PAGE_SIZE = 10;
const TIMELINE_PAGE_SIZE = 20;

type SourceCursor = { done: boolean; posts: PostWithAuthor[] };
export type TimelineCursor = {
  lime: SourceCursor & { page: number; before?: FeedCursor };
  bluesky: Record<string, SourceCursor & { cursor: string | null }>;
};
export type TimelinePage = { posts: PostWithAuthor[]; next: TimelineCursor | undefined };
export type TimelineSources = {
  lime: (page: number, limit: number, before?: FeedCursor) => Promise<PostWithAuthor[]>;
  bluesky: (handle: string, cursor: string | null, limit: number) => Promise<BlueskyAuthorFeedPage>;
};

export function createTimelineCursor(handles: string[]): TimelineCursor {
  return {
    lime: { page: 0, done: false, posts: [] },
    bluesky: Object.fromEntries(handles.map(handle => [handle, { cursor: null, done: false, posts: [] }])),
  };
}

export function normalizeTimelineBlueskyPost(post: BlueskyAuthorFeedPage['posts'][number]): PostWithAuthor {
  return {
    ...post,
    id: post.id, userId: post.userId, content: post.content, imageUrls: post.imageUrls,
    createdAt: post.createdAt, visibility: post.visibility,
    likedByMe: post.likedByMe, likesCount: post.likesCount, commentsCount: post.commentsCount,
    isBot: post.isBot,
    ...(post.is_bot !== undefined ? { is_bot: post.is_bot } : {}),
    repostsCount: 0, repostedByMe: false,
    author: {
      id: post.author.id, username: post.author.username, displayName: post.author.displayName,
      avatarUrl: post.author.avatarUrl, coverUrl: '', isOfficial: false,
      bio: post.author.bio, createdAt: post.author.createdAt,
    },
  };
}

const newestFirst = (a: PostWithAuthor, b: PostWithAuthor) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);

// Each source keeps a small lookahead buffer. Before choosing the next post we
// must know the head of every unfinished source. This prevents older Bluesky
// posts being displayed ahead of Lime posts that have not been fetched yet.
export async function loadTimelinePage(previous: TimelineCursor, sources: TimelineSources): Promise<TimelinePage> {
  // Work on a copy so failures/cancelled queries cannot advance any cursor.
  const lime = { ...previous.lime, posts: [...previous.lime.posts] };
  const bluesky = Object.fromEntries(Object.entries(previous.bluesky).map(([handle, state]) =>
    [handle, { ...state, posts: [...state.posts] }],
  ));
  const states = [lime, ...Object.values(bluesky)];
  const posts: PostWithAuthor[] = [];
  const seen = new Set<string>();

  while (posts.length < TIMELINE_PAGE_SIZE) {
    const requests: Array<()=>Promise<void>> = [];
    if (!lime.done && lime.posts.length === 0) {
      requests.push(()=>sources.lime(lime.page, SOURCE_PAGE_SIZE, lime.before).then(rows => {
        lime.page += 1;
        lime.done = rows.length < SOURCE_PAGE_SIZE;
        const ordered = [...rows].sort(newestFirst);
        lime.posts.push(...ordered);
        const oldest = ordered[ordered.length - 1];
        if (oldest) lime.before = { createdAt: oldest.createdAt, id: oldest.id };
      }));
    }
    for (const [handle, state] of Object.entries(bluesky)) {
      if (state.done || state.posts.length > 0) continue;
      requests.push(()=>sources.bluesky(handle, state.cursor, SOURCE_PAGE_SIZE).then(page => {
        if (page.cursor && page.cursor === state.cursor) throw new Error(`Bluesky cursor did not advance for ${handle}`);
        state.cursor = page.cursor;
        // A filtered/empty page can still have another page. Only the cursor
        // tells us this source is exhausted.
        state.done = !page.cursor;
        state.posts.push(...page.posts.map(normalizeTimelineBlueskyPost).sort(newestFirst));
      }));
    }
    // Independent reads start together; neither source is published early.
    // One page is committed atomically, with only two source pages in flight.
    let nextRequest=0;
    await Promise.all(Array.from({length:Math.min(2,requests.length)},async()=>{
      while(nextRequest<requests.length)await requests[nextRequest++]();
    }));
    if (states.some(state => !state.done && state.posts.length === 0)) continue;
    const available = states.filter(state => state.posts.length > 0);
    if (available.length === 0) break;
    available.sort((a, b) => newestFirst(a.posts[0], b.posts[0]));
    const post = available[0].posts.shift()!;
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
  }

  const hasMore = states.some(state => !state.done || state.posts.length > 0);
  return { posts, next: hasMore ? { lime, bluesky } : undefined };
}
