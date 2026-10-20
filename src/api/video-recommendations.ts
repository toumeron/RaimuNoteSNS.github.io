import { getPostById, getVideoFeed, type FeedCursor } from './posts';
import { getExternalPost, isExternalPostId } from './external-posts';
import { supabase } from '@/lib/supabase';
import { TOPICS } from '@/lib/topics';
import { fetchBlueskyAuthorFeed } from '@/lib/bluesky';
import { searchXPage } from '@/lib/fxTwitter';
import { normalizeTimelineBlueskyPost } from '@/lib/timelinePaging';
import type { MediaViewerSelection } from '@/components/media/openMediaViewer';
import type { PostWithAuthor } from '@/types';

export type VideoRecommendationCursor = {
  stage: 'author' | 'mixed';
  authorCount?: number;
  following?: PostWithAuthor[];
  popularDone?: boolean;
  popularQuery?: string;
  popularQueries?: string[];
  author?: PostWithAuthor;
  before?: FeedCursor;
  externalCursor?: string | null;
  seen: string[];
};

const isExternal = (post: PostWithAuthor) => !!post.source && post.source !== 'lime' || /^(x-user:|did:|misskey-user:)/.test(post.userId);
const actor = (post: PostWithAuthor) => post.source === 'x' || post.userId.startsWith('x-user:') ? post.author.username || post.userId : post.userId;
const newest = (a: PostWithAuthor, b: PostWithAuthor) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);

type SourceRead<T> = {done: boolean; value?: T; error?: unknown; promise: Promise<void>};
function startRead<T>(read: () => Promise<T>): SourceRead<T> {
  const job: SourceRead<T> = {done: false, promise: Promise.resolve()};
  job.promise = read().then(value => {job.value = value;}, error => {job.error = error;}).finally(() => {job.done = true;});
  return job;
}
const followingReads = new WeakMap<VideoRecommendationCursor, SourceRead<PostWithAuthor[]>>();
const popularReads = new WeakMap<VideoRecommendationCursor, SourceRead<Awaited<ReturnType<typeof searchXPage>>>>();
async function recentFollowing(viewerId: string | undefined, author: PostWithAuthor | undefined, signal?: AbortSignal): Promise<PostWithAuthor[]> {
    const follows: {followee_id?: string; external_provider?: string; external_handle?: string; external_profile?: {id?: string; username?: string}}[] = [];
    if (viewerId) for (let offset = 0; ; offset += 1000) {
      const {data, error} = await supabase.from('follows').select('followee_id,external_provider,external_handle,external_profile').eq('follower_id', viewerId).eq('approved', true).order('created_at', {ascending: false}).range(offset, offset + 999).abortSignal(signal!);
      if (error) {if (signal?.aborted) throw signal.reason; break;}
      follows.push(...data ?? []);
      if (!data || data.length < 1000) break;
    }
    const nativeIds = follows.filter(row => !row.external_provider && row.followee_id && row.followee_id !== author?.userId).map(row => row.followee_id!);
    // A finite recent pool keeps old followed posts from postponing popular videos forever.
    const native = nativeIds.length ? await getVideoFeed(undefined, signal, {authorIds: nativeIds, limit: 20}).catch(error => {if (signal?.aborted) throw error; return {posts: []};}) : {posts: []};
    const actors = [...new Set(follows.filter(row => ['x','twitter','bluesky'].includes(row.external_provider ?? '')).flatMap(row => {
      const handle = row.external_handle || row.external_profile?.username;
      const name = handle || row.external_profile?.id;
      if (!name) return [];
      return [(row.external_provider === 'x' || row.external_provider === 'twitter') && handle ? `${handle.replace(/^@/, '').replace(/@(?:x|twitter)\.com$/i, '')}@twitter.com` : name];
    }))];
    const external: PostWithAuthor[] = [];
    let index = 0;
    await Promise.all(Array.from({length: Math.min(3, actors.length)}, async () => {
      while (index < actors.length) {
        const name = actors[index++];
        try {
          const page = await fetchBlueskyAuthorFeed({actor: name, filter: 'posts_with_media', includeReposts: false, limit: 30, signal});
          external.push(...page.posts.map(normalizeTimelineBlueskyPost));
        } catch (error) {if (signal?.aborted) throw error;} // One unavailable follow must not stop popular-video fallback.
      }
    }));
    return [...new Map([...native.posts, ...external].filter(post => (post.video || post.externalVideo) && !post.externalRepostedBy && !post.profileRepostedBy && post.userId !== author?.userId).sort(newest).map(post => [post.id, post])).values()];
}

/** Offer up to three more author videos, then interleave recent follows and popular Twitter videos. */
export async function getVideoRecommendationPage(selection: MediaViewerSelection, viewerId: string | undefined, previous?: VideoRecommendationCursor, signal?: AbortSignal): Promise<{posts: PostWithAuthor[]; nextCursor: VideoRecommendationCursor | null}> {
  const id = selection.video?.postId ?? selection.postId;
  const state: VideoRecommendationCursor = previous ? {...previous, seen: [...previous.seen], following: previous.following ? [...previous.following] : undefined} : {stage: 'author', seen: id ? [id] : []};
  const seen = new Set(state.seen);
  const deliver = (rows: PostWithAuthor[], limit = Infinity) => {
    let count = 0;
    return rows.filter(post => {
    if (count >= limit || !(post.video || post.externalVideo) || post.externalRepostedBy || post.profileRepostedBy || seen.has(post.id)) return false;
    count++; seen.add(post.id); return true;
    });
  };
  let posts: PostWithAuthor[] = [];
  if (state.stage === 'author') {
    const author = state.author ?? selection.post ?? (id ? await (isExternalPostId(id) ? getExternalPost(id) : getPostById(id)) : null);
    if (!author) throw new Error('投稿者の情報を取得できませんでした');
    state.author = author;
    if (isExternal(author)) {
      const page = await fetchBlueskyAuthorFeed({actor: actor(author), cursor: state.externalCursor, filter: 'posts_with_media', includeReposts: false, limit: 30, signal});
      posts = deliver(page.posts.map(normalizeTimelineBlueskyPost).filter(post => post.userId === author.userId), 3 - (state.authorCount ?? 0));
      if (!page.cursor || page.cursor === state.externalCursor) state.stage = 'mixed';
      state.externalCursor = page.cursor;
    } else {
      const page = await getVideoFeed(state.before, signal, {authorIds: [author.userId]});
      posts = deliver(page.posts, 3 - (state.authorCount ?? 0));
      state.before = page.nextCursor ?? undefined;
      if (!page.nextCursor) state.stage = 'mixed';
    }
    state.authorCount = (state.authorCount ?? 0) + posts.length;
    if (state.authorCount >= 3) state.stage = 'mixed';
    if (state.stage === 'mixed') state.externalCursor = null;
  } else {
    let recent = previous ? followingReads.get(previous) : undefined;
    if (state.following === undefined && !recent) recent = startRead(() => recentFollowing(viewerId, state.author, signal));
    let search = previous ? popularReads.get(previous) : undefined;
    if (!search) {
      // A meaningful random topic works even when a filter-only search has no candidates.
      if (!state.popularQuery || state.popularDone) {
        const queries = [...new Set(TOPICS.flatMap(topic => topic.queries).map(term => `${term} 動画`))];
        const available = queries.filter(query => !(state.popularQueries ?? []).includes(query));
        const pool = available.length ? available : queries;
        state.popularQuery = pool[Math.floor(Math.random() * pool.length)] ?? '動画';
        state.popularQueries = [...(available.length ? state.popularQueries ?? [] : []), state.popularQuery];
        state.externalCursor = null;
      }
      search = startRead(() => searchXPage(state.popularQuery!, {cursor: state.externalCursor, feed: 'top', preferAlternative: true, limit: 20, signal}));
    }
    if (!state.following?.length) {
      await Promise.race([search.promise, ...(recent ? [recent.promise] : [])]);
      if (!search.done && !recent?.value?.some(post => !seen.has(post.id))) await search.promise;
    } else await Promise.resolve();
    if (signal?.aborted) throw signal.reason;
    if (recent?.done) {
      state.following = recent.value ?? [];
      recent = undefined;
    }
    let popular: PostWithAuthor[] = [];
    if (search.done) {
      if (search.error && !state.following?.length) throw search.error;
      const page = search.value;
      popular = (page?.posts ?? []).map(normalizeTimelineBlueskyPost).filter(post => (post.externalVideo || post.video) && post.userId !== state.author?.userId && !seen.has(post.id) && !post.externalRepostedBy && !post.profileRepostedBy);
      state.popularDone = !popular.length || !page?.cursor || page.cursor === state.externalCursor;
      state.externalCursor = page?.cursor ?? null;
      search = undefined;
      for (let i = popular.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [popular[i], popular[j]] = [popular[j], popular[i]];
      }
    }
    // Late results are retained for the next page; neither provider blocks ready videos.
    if (recent) followingReads.set(state, recent);
    if (search) popularReads.set(state, search);
   // Keep a recent-follow reserve across popular pages, mixing one of each in order.
   const following = state.following?.splice(0, 6) ?? [];
   posts = deliver(Array.from({length: Math.max(following.length, popular.length)}, (_, i) => [following[i], popular[i]]).flat().filter((post): post is PostWithAuthor => !!post));
  }
  if (signal?.aborted) throw signal.reason;
  state.seen = [...seen];
  return {posts, nextCursor: state};
}
