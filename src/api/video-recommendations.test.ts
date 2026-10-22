import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
import type {MediaViewerSelection} from "@/lib/mediaThumbnail";
const mocks = vi.hoisted(() => ({native: vi.fn(), external: vi.fn(), popular: vi.fn(), follows: [] as unknown[], filters: vi.fn()}));
vi.mock('./posts', () => ({getVideoFeed: (...args: unknown[]) => mocks.native(...args), getPostById: vi.fn()}));
vi.mock("./external-posts", async importOriginal => ({
  ...await importOriginal<typeof import("./external-posts")>(),
  getExternalPost: vi.fn(),
  isExternalPostId: (id: string) => id.startsWith('x:')
}));
vi.mock('@/lib/bluesky', () => ({fetchBlueskyAuthorFeed: (...args: unknown[]) => mocks.external(...args)}));
vi.mock('@/lib/fxTwitter', () => ({searchXPage: (...args: unknown[]) => mocks.popular(...args)}));
vi.mock("@/lib/utils", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/utils")>(),
  normalizeTimelineBlueskyPost: (post: unknown) => post
}));
vi.mock("@/lib/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  supabase: {from: () => {
  const query = {select: () => query, eq: (...args: unknown[]) => {mocks.filters(...args); return query;}, order: () => query, range: () => query, abortSignal: async () => ({data: mocks.follows, error: null})};
  return query;
}}
}));
import {getVideoRecommendationPage, type VideoRecommendationCursor} from "@/api/recommendations";
const post = (id: string, userId = 'creator', date = '2026-10-20T00:00:00Z', likes = 1) => ({id, userId, author: {id: userId, username: userId}, createdAt: date, likesCount: likes, video: {key: id}} as PostWithAuthor);
const selection = (first: PostWithAuthor): MediaViewerSelection => ({post: first, url: 'video:' + first.id, video: {postId: first.id, video: first.video!}});
afterEach(() => {vi.restoreAllMocks();});
beforeEach(() => {vi.resetAllMocks(); vi.spyOn(Math, 'random').mockReturnValue(.999); mocks.follows = []; mocks.popular.mockResolvedValue({posts: [], cursor: null}); mocks.native.mockResolvedValue({posts: [], nextCursor: null});});

it('caps additional creator videos at three across pages before reading mixed sources', async () => {
  const first = post('start'), cursor = {createdAt: first.createdAt, id: 'page-two'};
  mocks.native.mockResolvedValueOnce({posts: [first, post('a'), post('b')], nextCursor: cursor}).mockResolvedValueOnce({posts: [post('c'), post('d'), post('e')], nextCursor: cursor});
  const a = await getVideoRecommendationPage(selection(first), 'viewer');
  expect(a.posts.map(p => p.id)).toEqual(['a', 'b']); expect(a.nextCursor?.stage).toBe('author');
  expect(mocks.native).toHaveBeenCalledWith(undefined, undefined, {authorIds: ['creator']});
  const b = await getVideoRecommendationPage(selection(first), 'viewer', a.nextCursor!);
  expect(b.posts.map(p => p.id)).toEqual(['c']); expect(b.nextCursor?.stage).toBe('mixed');
  expect(mocks.native).toHaveBeenLastCalledWith(cursor, undefined, {authorIds: ['creator']});
  expect(mocks.popular).not.toHaveBeenCalled(); expect(a.nextCursor?.authorCount).toBe(2);
});
it('handles sparse creator pages and starts mixing when fewer than three videos exist', async () => {
  const first = post('start'); mocks.native.mockResolvedValue({posts: [first], nextCursor: null});
  const page = await getVideoRecommendationPage(selection(first), 'viewer');
  expect(page.posts).toEqual([]); expect(page.nextCursor?.stage).toBe('mixed');
  const mixed = await getVideoRecommendationPage(selection(first), 'viewer', page.nextCursor!);
  expect(mixed.nextCursor?.popularDone).toBe(true); expect(mocks.popular).toHaveBeenCalledWith(expect.stringContaining('動画'), expect.objectContaining({feed: 'top',limit:20}));
});
it('uses external author pagination, excludes reposts and caps external creator candidates', async () => {
  const first = {...post('x:start', 'x-user:123'), source: 'x', author: {id: 'x-user:123', username: 'artist@twitter.com'}} as PostWithAuthor;
  mocks.external.mockResolvedValueOnce({posts: [{...post('image', first.userId), video: null}, {...post('repost', first.userId), profileRepostedBy: 'someone'}, post('a', first.userId)], cursor: 'next'}).mockResolvedValueOnce({posts: [post('b', first.userId), post('c', first.userId), post('d', first.userId)], cursor: 'more'});
  // An image-only page must not count toward the three-video limit.
  const page = await getVideoRecommendationPage(selection(first), 'viewer');
  expect(mocks.external).toHaveBeenCalledWith(expect.objectContaining({actor: 'artist@twitter.com', filter: 'posts_with_media', includeReposts: false}));
  expect(page.posts.map(p => p.id)).toEqual(['a']);
  const next = await getVideoRecommendationPage(selection(first), 'viewer', page.nextCursor!);
  expect(next.posts.map(p => p.id)).toEqual(['b', 'c']); expect(next.nextCursor?.stage).toBe('mixed');
  expect(mocks.native).not.toHaveBeenCalled();
});
it('interleaves newest followed videos and popular Twitter videos without repeating the original creator', async () => {
  const first = post('start');
  mocks.follows = [{followee_id: 'friend'}, {external_provider: 'x', external_handle: 'artist'}];
  mocks.native.mockResolvedValue({posts: [post('old', 'friend', '2026-10-18'), post('own', 'creator')], nextCursor: null});
  mocks.external.mockResolvedValue({posts: [post('new', 'x-user:999', '2026-10-20')], cursor: 'unused-recent-cursor'});
  mocks.popular.mockResolvedValue({posts: [post('low', 'x-user:222', undefined, 3), post('high', 'x-user:333', undefined, 50), post('more-own', 'creator')], cursor: null});
  let cursor:VideoRecommendationCursor={stage:'mixed',author:first,seen:['start']};
  const delivered:PostWithAuthor[]=[];
  for(let i=0;i<4;i++){
   const page=await getVideoRecommendationPage(selection(first),'viewer',cursor);delivered.push(...page.posts);cursor=page.nextCursor!;
  }
  expect(new Set(delivered.map(p=>p.id))).toEqual(new Set(['new','old','high','low']));
  expect(delivered.map(p=>p.id).indexOf('new')).toBeLessThan(delivered.map(p=>p.id).indexOf('old'));
  expect(mocks.filters).toHaveBeenCalledWith('approved', true); expect(mocks.filters).toHaveBeenCalledWith('follower_id', 'viewer');
  expect(mocks.native).toHaveBeenCalledWith(undefined, undefined, {authorIds: ['friend'], limit: 20});
  expect(mocks.external).toHaveBeenCalledWith(expect.objectContaining({actor: 'artist@twitter.com'}));
});
it('retains the recent-follow reserve and deduplicates mixed pages without mutating cached cursors', async () => {
  const first = post('start'); const following = Array.from({length: 8}, (_, i) => post('f' + i, 'friend'));
  const cursor: VideoRecommendationCursor = {stage: 'mixed', author: first, seen: ['start'], following};
  mocks.popular.mockResolvedValueOnce({posts: [post('p1', 'twitter')], cursor: 'next'}).mockResolvedValueOnce({posts: [post('p1', 'twitter'), post('p2', 'twitter')], cursor: null});
  const a = await getVideoRecommendationPage(selection(first), 'viewer', cursor);
  expect(a.nextCursor?.following).toHaveLength(2); expect(cursor.following).toHaveLength(8);
  const b = await getVideoRecommendationPage(selection(first), 'viewer', a.nextCursor!);
  const c = await getVideoRecommendationPage(selection(first), 'viewer', b.nextCursor!);
  expect([...a.posts,...b.posts,...c.posts].map(p=>p.id)).toEqual(expect.arrayContaining(['f6','f7','p1','p2']));
  expect([...a.posts,...b.posts,...c.posts].filter(p=>p.id==='p1')).toHaveLength(1);
  expect(mocks.filters).not.toHaveBeenCalled(); expect(mocks.native).not.toHaveBeenCalled();
});
it('uses popular videos with no follows and propagates errors for retry', async () => {
  const first = post('start'), cursor: VideoRecommendationCursor = {stage: 'mixed', author: first, seen: ['start']};
  mocks.popular.mockRejectedValueOnce(new Error('unavailable'));
  await expect(getVideoRecommendationPage(selection(first), undefined, cursor)).rejects.toThrow('unavailable');
  mocks.popular.mockResolvedValueOnce({posts: [post('popular', 'twitter')], cursor: null});
  expect((await getVideoRecommendationPage(selection(first), undefined, cursor)).posts.map(p => p.id)).toEqual(['popular']);
  expect(mocks.filters).not.toHaveBeenCalled();
});

it('replenishes random popular searches after a cursor ends and excludes videos already delivered', async () => {
 const first=post('start'),cursor:VideoRecommendationCursor={stage:'mixed',author:first,seen:['start'],following:[]};
 mocks.popular.mockResolvedValueOnce({posts:[post('p1','twitter')],cursor:null})
  .mockResolvedValueOnce({posts:[post('p1','twitter'),post('p2','twitter')],cursor:null})
  .mockResolvedValueOnce({posts:[post('p3','twitter')],cursor:'next-topic'});
 const a=await getVideoRecommendationPage(selection(first),'viewer',cursor);
 expect(a.posts.map(p=>p.id)).toEqual(['p1']);expect(a.nextCursor).not.toBeNull();
 const b=await getVideoRecommendationPage(selection(first),'viewer',a.nextCursor!);
 expect(b.posts.map(p=>p.id)).toEqual(['p2']);expect(b.nextCursor).not.toBeNull();
 const c=await getVideoRecommendationPage(selection(first),'viewer',b.nextCursor!);
 expect(c.posts.map(p=>p.id)).toEqual(['p3']);
 const queries=mocks.popular.mock.calls.map(call=>call[0]);
 expect(queries[0]).toContain('動画');expect(queries[1]).not.toBe(queries[0]);expect(queries[2]).not.toBe(queries[1]);
 expect(mocks.popular.mock.calls.every(call=>call[1].feed==='top')).toBe(true);
});
it('keeps pagination open through empty popular search results', async () => {
 const first=post('start');mocks.popular.mockResolvedValue({posts:[],cursor:null});
 const page=await getVideoRecommendationPage(selection(first),undefined,{stage:'mixed',author:first,seen:['start'],following:[]});
 expect(page.posts).toEqual([]);expect(page.nextCursor).not.toBeNull();
});

it('moves beyond the third creator candidate while a followed source never responds',async()=>{
 const first=post('start');mocks.native.mockResolvedValueOnce({posts:[post('a'),post('b'),post('c'),post('d')],nextCursor:{createdAt:first.createdAt,id:'more'}});
 const author=await getVideoRecommendationPage(selection(first),'viewer');expect(author.posts).toHaveLength(3);
 mocks.follows=[{external_provider:'bluesky',external_profile:{id:'did:plc:slow'}}];mocks.external.mockImplementation(()=>new Promise(()=>{}));
 mocks.popular.mockResolvedValue({posts:[post('ready-popular','twitter')],cursor:null});
 const mixed=await getVideoRecommendationPage(selection(first),'viewer',author.nextCursor!);
 expect(mixed.posts.map(p=>p.id)).toEqual(['ready-popular']);expect(mixed.nextCursor).not.toBeNull();
});
it('does not request Misskey followers that cannot return video candidates',async()=>{
 const first=post('start');mocks.follows=Array.from({length:150},(_,i)=>({external_provider:'misskey',external_handle:`friend${i}@misskey.io`}));
 mocks.popular.mockResolvedValue({posts:[post('popular','twitter')],cursor:null});
 let cursor:VideoRecommendationCursor={stage:'mixed',author:first,seen:['start']};
 for(let i=0;i<3;i++){const page=await getVideoRecommendationPage(selection(first),'viewer',cursor);cursor=page.nextCursor!;}
 expect(mocks.external).not.toHaveBeenCalled();expect(mocks.popular).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({limit:20,feed:'top'}));
});
it('uses ready followed videos while popular search is pending and retains its eventual result',async()=>{
 const first=post('start');let finish!:(value:any)=>void;
 mocks.popular.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const cursor:VideoRecommendationCursor={stage:'mixed',author:first,seen:['start'],following:[post('followed','friend')]};
 const a=await getVideoRecommendationPage(selection(first),'viewer',cursor);expect(a.posts.map(p=>p.id)).toEqual(['followed']);
 finish({posts:[post('late-popular','twitter')],cursor:null});
 const b=await getVideoRecommendationPage(selection(first),'viewer',a.nextCursor!);expect(b.posts.map(p=>p.id)).toEqual(['late-popular']);
 expect(mocks.popular).toHaveBeenCalledTimes(1);
});
