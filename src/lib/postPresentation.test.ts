import { expect, it, vi, describe, afterEach, beforeEach } from "vitest";
import { shouldRetryRead, canShowPostLinkPreview, quotePreviewText, QUOTE_TEXT_LIMIT, updateLikeCountCache, commentThreadUrl, getCommentAncestors, getAuthorReplyConversations, uniqueProfileMediaPosts, buildProfileReplyThreads, profilePostIdentity, selectProfilePosts, collectProfilePages, externalProfileReplyThread, nextTwitterReplyCursor, twitterReplyText } from "@/lib/utils";
import { composerMediaDrop, isVideoAttachment } from "@/components/feed/PostPoll";
import { displayUsername, getClientName, appendSticker, splitStickers, hasStickers, stickerUrl, stickersAreInline, draftEmojiCharacter, serializeDraftEmojis, insertDraftEmoji } from "@/lib/utils";
import { extractPostMapLocation, mapBoundsContain, mapAreaContains, expandedMapBounds } from "@/lib/mapLocation";
import { QueryClient } from "@tanstack/react-query";
import { type CommentWithAuthor, type PostWithAuthor } from "@/types/index";
import { fetchBlueskyAuthorFeed, fetchBlueskyPostThread, mapBlueskyFeedItemToPost } from "@/lib/bluesky";
import { mapMisskeyNote } from "@/lib/misskey";
import { AVAILABLE_TIMELINE_TABS, isFeedTabValue, normalizeTimelineTabs } from "@/components/feed/TimelineTabBar";
import { singlePreviewUrl, readSavedPreview, savePreview } from "@/lib/mediaThumbnail";
import { metadata, publicAddress, publicUrl } from "./../../supabase/functions/link-preview/metadata.ts";
import { groupMapPosts, createMapPostIcon, updateMapPostIcon, highwayIdentity, highwayAnnotationName, highwayAnnotationNumber, createLimeMapStyle } from "@/components/maps/LimeMap";
import { validateStyleMin, featureFilter } from "@maplibre/maplibre-gl-style-spec";

describe("postPresentation", () => {
describe("postPresentation", () => {
describe("postPresentation", () => {
it('keeps link-only previews but suppresses attached images and either video format',()=>{
 const post={content:'本文 https://example.com',imageUrls:[]};
 expect(canShowPostLinkPreview(post)).toBe(true);
 for(const extra of [{imageUrls:['photo.jpg']},{video:{url:'video.mp4'}},{externalVideo:{url:'video.m3u8'}},{content:'https://example.com/photo.png'}])expect(canShowPostLinkPreview({...post,...extra})).toBe(false);
 expect(canShowPostLinkPreview(post,true)).toBe(false);
});
it('does not mistake an external link thumbnail for an attached photo',()=>{
 const thumbnail='https://example.com/cover.jpg';
 expect(canShowPostLinkPreview({content:'https://example.com',imageUrls:[thumbnail],linkPreview:{image:thumbnail}})).toBe(true);
 expect(canShowPostLinkPreview({imageUrls:[thumbnail,'https://example.com/attached.jpg'],linkPreview:{image:thumbnail}})).toBe(false);
});
it('bounds quoted text without splitting emoji and keeps short text unchanged',()=>{
 expect(quotePreviewText('短い本文')).toBe('短い本文');
 const text='🙂'.repeat(QUOTE_TEXT_LIMIT+1);const result=quotePreviewText(text);
 expect(Array.from(result)).toHaveLength(QUOTE_TEXT_LIMIT+1);expect(result.endsWith('…')).toBe(true);expect(result.includes('\uFFFD')).toBe(false);
});
});

describe("composerMediaDrop", () => {
it('recognizes video files supplied without MIME metadata',()=>{expect(isVideoAttachment(new File(['x'],'clip.MOV'))).toBe(true);expect(isVideoAttachment(new File(['x'],'clip.bin',{type:'video/mp4'}))).toBe(true);expect(isVideoAttachment(new File(['x'],'photo.png',{type:'image/png'}))).toBe(false);});
it('leaves text/link dragging alone and consumes file drops even when busy',()=>{const attach=vi.fn(),preventDefault=vi.fn(),stopPropagation=vi.fn();const event={preventDefault,stopPropagation,dataTransfer:{types:['text/plain'],items:[],files:[]}};composerMediaDrop(attach,false).onDragOver(event as any);expect(preventDefault).not.toHaveBeenCalled();composerMediaDrop(attach,true).onDrop({...event,dataTransfer:{files:[new File(['x'],'v.mp4')]}} as any);expect(preventDefault).toHaveBeenCalled();expect(attach).not.toHaveBeenCalled();});
});

describe("displayUsername", () => {
it('removes twitter suffixes from display without modifying the stored handle',()=>{
 const username='Google@Twitter.com';expect(displayUsername(username)).toBe('Google');expect(username).toBe('Google@Twitter.com');expect(displayUsername('Google@x.com')).toBe('Google');
});
it('preserves native, Bluesky, and Misskey handles',()=>{
 for(const value of ['local','artist.bsky.social','artist@misskey.io'])expect(displayUsername(value)).toBe(value);
});
});

describe("clientName", () => {
describe('posting client', () => {
  it.each([
    ['Mozilla iPhone OS 18 like Mac OS X', 5, 'iPhone'],
    ['Mozilla iPad CPU OS 18 like Mac OS X', 5, 'iPad'],
    ['Mozilla Macintosh Intel Mac OS X', 5, 'iPad'],
    ['Mozilla Macintosh Intel Mac OS X', 0, 'Mac'],
    ['Mozilla Linux Android 15', 5, 'Android'],
    ['Mozilla Windows NT 10.0', 0, 'Windows'],
    ['Mozilla X11 Linux x86_64', 0, 'Linux'],
    ['unknown', 0, 'Web'],
  ])('identifies %s without guessing the hardware model', (ua, touches, device) => {
    expect(getClientName(ua, touches)).toBe(`LimeNote for ${device}`);
  });
});
});

describe("likeCountCache", () => {
describe('like count cache synchronization', () => {
  it('updates latest, following, detail, profile arrays, wrapped likes and quotes without changing paging', () => {
    const client = new QueryClient();
    const post = { id: 'p', likesCount: 2 };
    const other = { id: 'other', likesCount: 9 };
    const feed = { pages: [[post, other, { id: 'quote', parentPost: post }]], pageParams: [4] };
    client.setQueryData(['feed', 'all'], feed);
    client.setQueryData(['feed', 'following'], feed);
    client.setQueryData(['post', 'p'], post);
    client.setQueryData(['feed', 'all', 'timeline', []], { pages: [{ posts: [post], next: { lime: { page: 1 } } }], pageParams: [{}] });
    client.setQueryData(['posts', 'user', 'author'], { pages: [[post]], pageParams: [0] });
    client.setQueryData(['posts', 'likes', 'author'], { pages: [[{ posts: post }]], pageParams: [0] });
    client.setQueryData(['posts', 'user', 'legacy'], [post]);
    client.setQueryData(['profile', 'author'], { id: 'p', displayName: 'Author' });
    updateLikeCountCache(client, 'post', 'p', 8);
    for (const key of [['feed', 'all'], ['feed', 'following']]) {
      expect(client.getQueryData(key)).toEqual({ pages: [[{ ...post, likesCount: 8, likes_count: 8 }, other,
        { id: 'quote', parentPost: { ...post, likesCount: 8, likes_count: 8 } }]], pageParams: [4] });
    }
    expect(client.getQueryData(['post', 'p'])).toMatchObject({ likesCount: 8 });
    expect(client.getQueryData(['feed', 'all', 'timeline', []])).toMatchObject({ pages: [{ posts: [{ likesCount: 8 }], next: { lime: { page: 1 } } }] });
    expect(client.getQueryData(['posts', 'user', 'author'])).toMatchObject({ pages: [[{ likesCount: 8 }]], pageParams: [0] });
    expect(client.getQueryData(['posts', 'likes', 'author'])).toMatchObject({ pages: [[{ posts: { likesCount: 8 } }]] });
    expect(client.getQueryData(['posts', 'user', 'legacy'])).toEqual([{ ...post, likesCount: 8, likes_count: 8 }]);
    expect(client.getQueryData(['profile', 'author'])).toEqual({ id: 'p', displayName: 'Author' });
  });
  it('isolates comment counts from post counts with the same ID', () => {
    const client = new QueryClient();
    client.setQueryData(['comments', 'post'], [{ id: 'same', likes_count: 2 }]);
    client.setQueryData(['post', 'same'], { id: 'same', likesCount: 10 });
    updateLikeCountCache(client, 'comment', 'same', 0);
    expect(client.getQueryData(['comments', 'post'])).toEqual([{ id: 'same', likes_count: 0, likesCount: 0 }]);
    expect(client.getQueryData(['post', 'same'])).toEqual({ id: 'same', likesCount: 10 });
  });
  it('keeps unrelated query references unchanged', () => {
    const client = new QueryClient();
    const key = ['feed', 'all'];
    client.setQueryData(key, { pages: [[{ id: 'other', likesCount: 2 }]], pageParams: [0] });
    const data = client.getQueryData(key);
    updateLikeCountCache(client, 'post', 'missing', 8);
    expect(client.getQueryData(key)).toBe(data);
  });
});
});
});

describe("commentThread", () => {
const comment = (id: string, parentCommentId: string | null = null) => ({ id, parentCommentId, postId: 'post' } as CommentWithAuthor);
describe('reply ancestry', () => {
  it('supports deep threads without recursion or a fixed depth limit', () => {
    const rows = Array.from({ length: 10000 }, (_, i) => comment(String(i), i ? String(i - 1) : null));
    const chain = getCommentAncestors(rows, '9999');
    expect(chain).toHaveLength(10000);
    expect(chain?.[0].id).toBe('0');
    expect(chain?.[9999].id).toBe('9999');
  });
  it('includes only the selected branch, not siblings', () => {
    expect(getCommentAncestors([comment('a'), comment('b', 'a'), comment('c', 'a'), comment('d', 'b')], 'd')?.map(c => c.id)).toEqual(['a', 'b', 'd']);
  });
  it('rejects cyclic and incomplete chains safely', () => {
    expect(getCommentAncestors([comment('a', 'b'), comment('b', 'a')], 'a')).toBeNull();
    expect(getCommentAncestors([comment('a', 'missing')], 'a')).toBeNull();
    expect(getCommentAncestors([], 'missing')).toBeNull();
  });
  it('links to the reply while preserving the original post route', () => {
    expect(commentThreadUrl('post', 'reply')).toBe('/post/post?reply=reply');
  });
});

describe('original author replies', () => {
  const reply = (id: string, userId: string, parentCommentId: string | null, createdAt: string) => ({ ...comment(id, parentCommentId), userId, createdAt });
  const ids = (result: ReturnType<typeof getAuthorReplyConversations>[number]) => result.branches.map(branch => branch.items.map(c => c.id));
  it('prioritizes answered roots and follows only the path to the original author', () => {
    const rows = [reply('new', 'visitor', null, '2026-10-08'), reply('question', 'visitor', null, '2026-10-01'), reply('middle', 'other', 'question', '2026-10-02'), reply('answer', 'host', 'middle', '2026-10-03'), reply('unrelated', 'other', 'question', '2026-10-04')];
    const conversations = getAuthorReplyConversations(rows, 'host');
    expect(conversations.map(c => c.root.id)).toEqual(['question', 'new']);
    expect(ids(conversations[0])).toEqual([['question', 'middle', 'answer']]);
    expect(conversations[0].hasHiddenReplies).toBe(false);
  });
  it('does not show an ancestor sibling before or after expanding the host answer', () => {
    const rows = [reply('cat', 'visitor', null, '2026-10-01'), reply('sibling', 'visitor', 'cat', '2026-10-02'), reply('host', 'host', 'cat', '2026-10-03'), reply('host-child', 'host', 'host', '2026-10-04')];
    const before = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(before)).toEqual([['cat', 'host']]);
    expect([...before.hiddenReplyIds]).toEqual(['host']);
    expect(before.branches[0].moreFor?.id).toBe('host');
    const after = getAuthorReplyConversations(rows, 'host', null, new Set(['host']))[0];
    expect(ids(after)).toEqual([['cat', 'host', 'host-child']]);
    expect(after.items.some(c => c.id === 'sibling')).toBe(false);
    expect(after.hasHiddenReplies).toBe(false);
  });
  it('does not put a button on a zero-reply host answer because its parent has other replies', () => {
    const rows = [reply('cat', 'visitor', null, '2026-10-01'), reply('host', 'host', 'cat', '2026-10-02'), reply('sibling', 'visitor', 'cat', '2026-10-03')];
    const result = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(result)).toEqual([['cat', 'host']]);
    expect(result.hasHiddenReplies).toBe(false);
    expect(result.branches[0].moreFor).toBeNull();
  });
  it('chooses one author branch rather than flattening sibling author answers', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('late', 'host', 'question', '2026-10-03'), reply('early', 'host', 'question', '2026-10-02')];
    expect(ids(getAuthorReplyConversations(rows, 'host')[0])).toEqual([['question', 'early']]);
  });
  it('keeps third-party replies out of the automatic author conversation', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('child', 'other', 'question', '2026-10-02')];
    const result = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(result)).toEqual([['question']]);
    expect(result.threadIds.size).toBe(0);
    expect(result.hasHiddenReplies).toBe(false);
  });
  it('expands only direct children of the selected terminal reply', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'question', '2026-10-02'), reply('continuation', 'host', 'answer', '2026-10-03'), reply('deep', 'host', 'continuation', '2026-10-04'), reply('unrelated', 'other', 'question', '2026-10-05')];
    const result = getAuthorReplyConversations(rows, 'host', null, new Set(['answer']))[0];
    expect(ids(result)).toEqual([['question', 'answer', 'continuation']]);
    expect([...result.hiddenReplyIds]).toEqual(['continuation']);
    expect(result.branches[0].moreFor?.id).toBe('continuation');
  });
  it('keeps multiple actual children of the expanded reply in their own branches', () => {
    const rows = [reply('root', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'root', '2026-10-02'), reply('a', 'host', 'answer', '2026-10-03'), reply('b', 'host', 'answer', '2026-10-04')];
    const result = getAuthorReplyConversations(rows, 'host', null, new Set(['answer']))[0];
    expect(ids(result)).toEqual([['root', 'answer', 'a'], ['root', 'answer', 'b']]);
  });
  it('uses the original author when the selected page is a reply', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('child', 'other', 'question', '2026-10-02'), reply('answer', 'host', 'child', '2026-10-03')];
    expect(ids(getAuthorReplyConversations(rows, 'host', 'question')[0])).toEqual([['child', 'answer']]);
  });
  it('rejects duplicate roots and avoids cycles', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'question', '2026-10-02'), reply('cycle', 'host', 'cycle', '2026-10-03')];
    expect(getAuthorReplyConversations([...rows, rows[0]], 'host').map(ids)).toEqual([[['question', 'answer']]]);
  });
  it('uses connector styling only through the author answer, even after expansion', () => {
    const rows = [reply('root', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'root', '2026-10-02'), reply('other', 'visitor', 'answer', '2026-10-03')];
    const result = getAuthorReplyConversations(rows, 'host', null, new Set(['answer']))[0];
    expect(ids(result)).toEqual([['root', 'answer']]);
    expect(result.hasHiddenReplies).toBe(false);
    expect([...result.threadIds]).toEqual(['root', 'answer']);
    expect(result.threadIds.has('other')).toBe(false);
  });
  it('does not treat a root written by the author as an author reply to someone else', () => {
    const rows = [reply('root', 'host', null, '2026-10-01'), reply('other', 'visitor', 'root', '2026-10-02')];
    const result = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(result)).toEqual([['root']]);
    expect(result.threadIds.size).toBe(0);
    expect(result.hasHiddenReplies).toBe(false);
  });

  it('excludes a third-party-only continuation even when expansion state requests it', () => {
    const rows = [reply('cat', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'cat', '2026-10-02'), reply('unrelated-sibling', 'visitor', 'cat', '2026-10-03'), reply('lime', 'other', 'answer', '2026-10-04')];
    for (const expanded of [new Set<string>(), new Set(['answer']), new Set(['cat', 'answer'])]) {
      const result = getAuthorReplyConversations(rows, 'host', null, expanded)[0];
      expect(ids(result)).toEqual([['cat', 'answer']]);
      expect(result.items.some(c => c.id === 'lime' || c.id === 'unrelated-sibling')).toBe(false);
      expect(result.hasHiddenReplies).toBe(false);
    }
  });

});
});

describe("profileReplyThreads", () => {
describe("profileReplyThreads", () => {
const posts = new Map([['old-post', { id: 'old-post', author: 'original author' }], ['new-post', { id: 'new-post', author: 'someone else' }]]);
const reply = (id: string, postId: string, createdAt: string, parentCommentId: string | null = null) => ({ id, postId, createdAt, parentCommentId });
describe('profile replies', () => {
  it('orders each reply by when it was sent rather than grouping by the original post', () => {
    const comments = [reply('first', 'old-post', '2026-10-01'), reply('second', 'new-post', '2026-10-02'), reply('third', 'old-post', '2026-10-03')];
    const threads = buildProfileReplyThreads(comments, posts, new Map(), new Map(), new Map());
    expect(threads.map(t => t.id)).toEqual(['third', 'second', 'first']);
    expect(threads.every(t => t.comments.length === 1)).toBe(true);
  });
  it('shows the actual parent reply, including another author, for a reply to a reply', () => {
    const parent = { ...reply('parent', 'old-post', '2026-10-01'), author: 'actual recipient' };
    const [thread] = buildProfileReplyThreads([reply('child', 'old-post', '2026-10-03', 'parent')], posts, new Map([['parent', parent]]), new Map(), new Map([['parent', ['reaction']]]));
    expect(thread.parentPost).toEqual(posts.get('old-post')); expect(thread.comments.map(c => c.id)).toEqual(['parent', 'child']);
  });
  it('never presents sibling replies as replies to each other', () => {
    const threads = buildProfileReplyThreads([reply('a', 'old-post', '2026-10-01'), reply('b', 'old-post', '2026-10-02')], posts, new Map(), new Map(), new Map());
    expect(threads.map(t => t.parentPost)).toEqual([posts.get('old-post'), posts.get('old-post')]);
  });
  it('does not substitute the original author for an unavailable parent reply', () => {
    const [thread] = buildProfileReplyThreads([reply('child', 'old-post', '2026-10-03', 'missing')], posts, new Map(), new Map(), new Map());
    expect(thread.parentPost).toBeNull(); expect(thread.comments.map(c => c.id)).toEqual(['child']);
  });
  it('keeps every ancestor in order across authors without including another branch', () => {
    const ancestors = [reply('a', 'old-post', '2026-10-01'), reply('b', 'old-post', '2026-10-02', 'a'), reply('c', 'old-post', '2026-10-03', 'b'), reply('sibling', 'old-post', '2026-10-03', 'a')];
    const [thread] = buildProfileReplyThreads([reply('d', 'old-post', '2026-10-04', 'c')], posts, new Map(ancestors.map(c => [c.id, c])), new Map(), new Map());
    expect(thread.comments.map(c => c.id)).toEqual(['a', 'b', 'c', 'd']); expect(thread.createdAt).toBe('2026-10-04');
  });
  it('does not expose a reply whose original post failed the visibility check', () => {
    expect(buildProfileReplyThreads([reply('child', 'hidden', '2026-10-03')], posts, new Map(), new Map(), new Map())).toEqual([]);
  });
});
});

describe("profilePostIdentity", () => {
it('keeps a self repost and its original as separate entries with stable keys',()=>{
 const original={id:'same'};
 const repost={...original,profileRepostedBy:'me',profileRepostedAt:'2026-10-04'};
 expect(profilePostIdentity(original)).not.toBe(profilePostIdentity(repost));
 expect(profilePostIdentity({...repost})).toBe(profilePostIdentity(repost));
 expect(new Set([original,repost,{...repost}].map(profilePostIdentity)).size).toBe(2);
});
});

describe("profilePostOptions", () => {
const items = [
  {post:{id:'post',createdAt:'2026-10-11',likesCount:2}},
  {reply:{comment:{id:'reply',likes_count:5}},sortAt:'2026-10-10'},
  {post:{id:'repost',profileRepostedBy:'owner',createdAt:'2026-10-09',likesCount:9}},
  {post:{id:'quote',isQuote:true,parentId:'parent',createdAt:'2026-10-08',likesCount:2}},
  {post:{id:'external-reply',externalReplyToId:'parent',createdAt:'2026-10-07',likesCount:3}},
];
const id = (item:any) => item.post?.id ?? item.reply.comment.id;
it('all includes posts, replies and repost activity in chronological order',()=>{
 expect(selectProfilePosts(items,'all','latest').map(id)).toEqual(['post','reply','repost','quote','external-reply']);
});
it('posts excludes native/external replies and reposts but keeps authored quotes',()=>{
 expect(selectProfilePosts(items,'posts','latest').map(id)).toEqual(['post','quote']);
});
it('popular uses likes and resolves ties by newest first without mutating input',()=>{
 expect(selectProfilePosts(items,'all','popular').map(id)).toEqual(['repost','reply','external-reply','post','quote']);
 expect(items.map(id)).toEqual(['post','reply','repost','quote','external-reply']);
});
it('uses stable post identity when likes and timestamps are identical', () => {
 const posts = ['z', 'a', 'm'].map(id => ({ id, createdAt: '2026-10-11', likesCount: 3 }));
 expect(selectProfilePosts(posts, 'all', 'popular').map(p => p.id)).toEqual(['a', 'm', 'z']);
 expect(selectProfilePosts([...posts].reverse(), 'all', 'popular').map(p => p.id)).toEqual(['a', 'm', 'z']);
});
});

describe("profilePopularity", () => {
it.each(['lime', 'bsky', 'misskey'])('%s ranks older popular posts before revealing stable pages', async provider => {
  const newest = Array.from({ length: 20 }, (_, i) => ({ id: `${provider}:new-${i}`, likesCount: 1, createdAt: '2026-10-11' }));
  const older = { id: `${provider}:older-popular`, likesCount: 100, createdAt: '2026-10-01' };
  const load = vi.fn(async (cursor: string | null) => cursor === null
    ? { posts: newest, cursor: 'older' }
    : { posts: [older], cursor: null });
  const snapshot = await collectProfilePages(load);
  const ranked = selectProfilePosts(snapshot, 'all', 'popular');
  const firstPage = ranked.slice(0, 20);
  expect(firstPage[0]).toEqual(older);
  expect(ranked.slice(0, 40).slice(0, 20)).toEqual(firstPage);
  expect(load).toHaveBeenCalledTimes(2);
});
it('continues past pages containing only hidden or filtered posts', async () => {
  const load = vi.fn(async (cursor: string | null) => cursor === null
    ? { posts: [] as string[], cursor: 'next' }
    : { posts: ['public'], cursor: null });
  expect(await collectProfilePages(load)).toEqual(['public']);
});
it('does not publish an incomplete ranking after a later page fails', async () => {
  const load = vi.fn().mockResolvedValueOnce({ posts: ['new'], cursor: 'next' }).mockRejectedValueOnce(new Error('offline'));
  await expect(collectProfilePages(load)).rejects.toThrow('offline');
});
it('rejects a stalled cursor rather than fetching forever', async () => {
  const load = vi.fn().mockResolvedValue({ posts: [], cursor: 'same' });
  await expect(collectProfilePages(load)).rejects.toThrow('カーソル');
  expect(load).toHaveBeenCalledTimes(2);
});
it('stops before fetching the next page when cancelled', async () => {
  const controller = new AbortController();
  const load = vi.fn(async () => { controller.abort(); return { posts: ['new'], cursor: 'next' }; });
  await expect(collectProfilePages(load, controller.signal)).rejects.toThrow();
  expect(load).toHaveBeenCalledTimes(1);
});
});

describe("externalProfileReplies", () => {
const author={did:'did:plc:alice',handle:'alice.bsky.social',displayName:'Alice'};
const uri='at://did:plc:alice/app.bsky.feed.post/';
afterEach(() => vi.unstubAllGlobals());
it('ranks a later Bluesky feed page using the actual mapped like counts',async()=>{
 const entry=(id:string,likes:number,date:string)=>({post:{uri:uri+id,author,likeCount:likes,record:{text:id,createdAt:date}}});
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,status:200,json:async()=>({feed:[entry('new',1,'2026-10-11')],cursor:'next'})})
  .mockResolvedValueOnce({ok:true,status:200,json:async()=>({feed:[entry('older-popular',50,'2026-10-01')]})});
 vi.stubGlobal('fetch',fetch);
 const posts=await collectProfilePages<any,string>(cursor=>fetchBlueskyAuthorFeed({actor:author.handle,cursor,includeReposts:true,filter:'posts_with_replies'}));
 const ranked=selectProfilePosts(posts,'all','popular');
 expect(ranked.map(post=>post.id)).toEqual(['bsky:'+uri+'older-popular','bsky:'+uri+'new']);
 expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('next');
});
it('uses Misskey reactions and external reply likes for popularity',()=>{
 const note=(id:string,reactions:Record<string,number>)=>mapMisskeyNote({id,text:id,createdAt:'2026-10-11',visibility:'public',user:{id:'alice',username:'alice'},reactions})!;
 const original=note('original',{heart:2});
 const reply=externalProfileReplyThread(normalize({...note('reply',{heart:4,smile:3}),externalReplyToId:original.id}));
 expect(selectProfilePosts([{post:original},{reply}],'all','popular')[0]).toEqual({reply});
});
it('includes repost activity only when requested by the profile all-posts feed',async()=>{
 const item={post:{uri:uri+'shared',author,record:{text:'shared',createdAt:'2026-10-10'}},reason:{$type:'app.bsky.feed.defs#reasonRepost',by:{did:'did:plc:owner'},indexedAt:'2026-10-11'}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({feed:[item]})}));
 const all=await fetchBlueskyAuthorFeed({actor:author.handle,includeReposts:true});
 expect(all.posts[0].profileRepostedBy).toBe('did:plc:owner');
 expect(all.posts[0].profileRepostedAt).toBe('2026-10-11');
 const regular=await fetchBlueskyAuthorFeed({actor:author.handle});
 expect(regular.posts).toEqual([]);
});
it('loads nested replies with their immediate parents for native conversation layout', async () => {
 const post=(id:string)=>({uri:uri+id,author,record:{text:id,createdAt:'2026-10-11'}});
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({thread:{post:post('root'),replies:[{post:post('reply'),replies:[{post:post('answer')}]}]}})});
 vi.stubGlobal('fetch',fetch);
 const result=await fetchBlueskyPostThread('bsky:'+uri+'root');
 expect(result.replies.map(reply=>reply.externalReplyToId)).toEqual(['bsky:'+uri+'root','bsky:'+uri+'reply']);
 expect(new URL(fetch.mock.calls[0][0]).searchParams.get('depth')).toBe('6');
});
function normalize(post: any): PostWithAuthor { return {repostsCount:0,repostedByMe:false,...post,author:{coverUrl:'',...post.author}}; }
it('preserves Bluesky reply relationships and renders the native profile thread data',()=>{
 const parent={uri:uri+'parent',author,record:{text:'parent',createdAt:'2026-10-10'}};
 const reply=mapBlueskyFeedItemToPost({post:{uri:uri+'reply',author,record:{text:'reply',createdAt:'2026-10-11',reply:{parent:{uri:parent.uri}}}},reply:{parent}})!;
 expect(reply.externalReplyToId).toBe('bsky:'+parent.uri);
 expect(reply.externalReplyToUsername).toBe(author.handle);
 const thread=externalProfileReplyThread(normalize(reply));
 expect(thread.parentPost?.content).toBe('parent');expect(thread.comments[0].content).toBe('reply');
 expect(thread.comment.externalPost.id).toBe('bsky:'+uri+'reply');expect(thread.createdAt).toBe('2026-10-11');
 expect(thread.comment.externalPost.replyId).toBeUndefined();
});
it('keeps a reply as a reply when its parent is blocked or unavailable',()=>{
 const post=mapBlueskyFeedItemToPost({post:{uri:uri+'reply',author,record:{text:'reply',reply:{parent:{uri:uri+'private'}}}}})!;
 const thread=externalProfileReplyThread(normalize(post));
 expect(thread.parentPost).toBeNull();expect(thread.comments).toHaveLength(1);expect(thread.comment.postId).toBe('bsky:'+uri+'private');
});
it('preserves Misskey reply parents but never renders private parent content',()=>{
 const user={id:'alice',username:'alice'};
 const parent={id:'parent123',text:'parent',createdAt:'2026-10-10',visibility:'public',user};
 const reply={id:'reply123',replyId:parent.id,reply:parent,text:'reply',createdAt:'2026-10-11',visibility:'public',user};
 const mapped=mapMisskeyNote(reply)!;
 const thread=externalProfileReplyThread(normalize(mapped));
 expect(thread.parentPost?.id).toBe('misskey:https://misskey.io/notes/parent123');
 expect(thread.comment.externalPost.id).toBe('misskey:https://misskey.io/notes/reply123');
 const privateReply=mapMisskeyNote({...reply,reply:{...parent,visibility:'followers'}})!;
 expect(privateReply.externalReplyParent).toBeNull();expect(privateReply.externalReplyToId).toBe(mapped.externalReplyToId);
});
it('does not classify original posts as replies',()=>{
 const original=mapBlueskyFeedItemToPost({post:{uri:uri+'original',author,record:{text:'original'}}});
 expect(original?.externalReplyToId).toBeUndefined();
});
});

it('keeps latest-page ties in the same descending ID order as database reads',()=>{
 const posts=Array.from({length:40},(_,i)=>({id:String(i).padStart(2,'0'),createdAt:'2026-10-13T00:00:00Z'})).reverse();
 const first=selectProfilePosts(posts.slice(0,20),'all','latest').slice(0,20);
 const second=selectProfilePosts(posts,'all','latest').slice(20,40);
 expect([...first,...second].map(post=>post.id)).toEqual(posts.map(post=>post.id));
 expect(new Set([...first,...second].map(post=>post.id)).size).toBe(40);
});

it('shows media only once across original, repost, and repeated profile pages',()=>{
 const original={id:'x:2110440180142498036'},repost={...original,profileRepostedBy:'Google'};
 expect(uniqueProfileMediaPosts([original,repost,{...original},{id:'other'}])).toEqual([original,{id:'other'}]);
});

it('excludes twitter reposts from profile media before deduplication, retaining own media and quotes',()=>{
 const own={id:'x:10',source:'x',userId:'x-user:1'},repost={...own,profileRepostedBy:'x-user:1'},quote={...own,id:'x:11',isQuote:true};
 expect(uniqueProfileMediaPosts([repost,own,{...own},quote,{...own,id:'x:12',userId:'x-user:2'},{...own,id:'x:13',externalRepostedBy:{id:'x-user:1'}}],'x-user:1')).toEqual([own,quote]);
 const bluesky={id:'bsky:1',source:'bluesky',profileRepostedBy:'other'};
 expect(uniqueProfileMediaPosts([bluesky])).toEqual([bluesky]);
});

describe('twitter authored-post filter',()=>{
 const profile='x-user:1';
 const own={id:'x:501',userId:profile,source:'x',createdAt:'2026-10-16',likesCount:1};
 const quote={...own,id:'x:502',isQuote:true,parentPost:{id:'x:400',userId:'x-user:2'}};
 const attributed={...own,id:'x:503',userId:'x-user:2',profileRepostedBy:profile};
 const providerOnly={...own,id:'x:504',externalRepostedBy:{id:profile}};
 const missingAttribution={...own,id:'x:505',userId:'x-user:2'};
 const reply={...own,id:'x:506',externalReplyToId:'x:400'};
 const entries=[own,quote,attributed,providerOnly,missingAttribution,reply];
 for(const sort of ['latest','popular'] as const){
  it(`excludes reposts with partial/cached metadata using the ${sort} filter`,()=>{
   expect(new Set(selectProfilePosts(entries,'posts',sort,profile).map(p=>p.id))).toEqual(new Set([own.id,quote.id]));
   expect(selectProfilePosts(entries,'all',sort,profile)).toHaveLength(entries.length);
  });
  it(`applies the same rule to wrapped profile rows using ${sort}`,()=>{
   const rows=entries.map(post=>({post,sortAt:post.createdAt}));
   expect(new Set(selectProfilePosts(rows,'posts',sort,profile).map(row=>row.post.id))).toEqual(new Set([own.id,quote.id]));
  });
 }
 it('retains the original but excludes a self repost of that same post',()=>{
  expect(selectProfilePosts([{post:own},{post:{...own,externalRepostedBy:{id:profile}}}],'posts','latest',profile)).toEqual([{post:own}]);
 });
 it('falls back to author identity on cached records without userId',()=>{
  const ownAuthor={id:'x:507',author:{id:profile}},otherAuthor={id:'x:508',author:{id:'x-user:2'}};
  expect(selectProfilePosts([otherAuthor,ownAuthor],'posts','latest',profile)).toEqual([ownAuthor]);
 });
});
});

describe("twitterReplyPaging", () => {
describe("twitterReplyPaging", () => {
const page=(ids:string[],cursor:string|null,totalReplies?:number)=>({post:{id:'x:parent'},replies:ids.map(id=>({id,externalReplyToId:'x:parent'})),cursor,totalReplies});
it('does not offer more replies for empty or complete conversations despite a server cursor',()=>{
 const empty=page([],'phantom',0);expect(nextTwitterReplyCursor(empty,[empty])).toBeUndefined();
 const complete=page(['one','two'],'phantom',2);expect(nextTwitterReplyCursor(complete,[complete])).toBeUndefined();
});
it('stops once the combined pages contain every direct reply',()=>{
 const first=page(['one'],'second',2),last=page(['two'],'third');
 expect(nextTwitterReplyCursor(first,[first])).toBe('second');expect(nextTwitterReplyCursor(last,[first,last],'second',[null,'second'])).toBeUndefined();
});
it('does not confuse nested replies with remaining direct replies',()=>{
 const first=page(['one'],'more',2);first.replies.push({id:'child',externalReplyToId:'one'});
 expect(nextTwitterReplyCursor(first,[first])).toBe('more');
});
it('stops repeated replies and cyclic cursors without further requests',()=>{
 const first=page(['one'],'second'),copy=page(['one'],'third');
 expect(nextTwitterReplyCursor(copy,[first,copy],'second')).toBeUndefined();
 const fresh=page(['two'],'used');expect(nextTwitterReplyCursor(fresh,[first,fresh],'second',[null,'used','second'])).toBeUndefined();
});
it('keeps a proven continuation when the service omits the reply total',()=>{
 const first=page(['one'],'second');expect(nextTwitterReplyCursor(first,[first])).toBe('second');
});
});

describe("twitterReplyText", () => {
it('removes only the leading recipient block on replies',()=>{
 expect(twitterReplyText('@alice @bob_2 本文 @carol に連絡',true)).toBe('本文 @carol に連絡');
 expect(twitterReplyText('@alice\n@bob 本文',true)).toBe('本文');
 expect(twitterReplyText('@alice',true)).toBe('');
});
it('preserves non-replies, intentional later mentions and email-like text',()=>{
 expect(twitterReplyText('@alice 通常投稿',false)).toBe('@alice 通常投稿');
 expect(twitterReplyText('本文 @alice',true)).toBe('本文 @alice');
 expect(twitterReplyText('@alice@example.com',true)).toBe('@alice@example.com');
});
});
});

describe("timelineTabs", () => {
it('removes a saved recommended tab while preserving followed feeds, lists, and topics',()=>{
 const list='list:01234567-89ab-cdef-0123-456789abcdef';
 expect(normalizeTimelineTabs(['recommended','following',list,'topic:digital-illustration'])).toEqual(['following',list,'topic:digital-illustration']);
 expect(isFeedTabValue('recommended')).toBe(false);
 expect(AVAILABLE_TIMELINE_TABS.some(tab=>String(tab.value)==='recommended')).toBe(false);
});
it('restores the remaining default tabs when only the retired tab was saved',()=>{
 expect(normalizeTimelineTabs(['recommended'])).toEqual(['all','following','trending']);
});
});

describe("linkPreview", () => {
describe("linkPreview", () => {
describe('URL preview eligibility',()=>{
 it('accepts exactly one ordinary URL and trims Japanese sentence punctuation',()=>{expect(singlePreviewUrl('日記 https://example.com/diary。')).toBe('https://example.com/diary');});
 it('suppresses two URLs, including duplicates',()=>{expect(singlePreviewUrl('https://example.com https://example.com')).toBeNull();});
 it('keeps existing dedicated embeds',()=>{for(const url of ['https://youtu.be/abcdefghijk','https://open.spotify.com/track/abc','https://example.com/image.png','https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/abc'])expect(singlePreviewUrl(url)).toBeNull();});
});
describe('metadata parsing and public target validation',()=>{
 it('reads reversed attributes, entities, relative images and Twitter fallback',()=>{expect(metadata(`<meta content="日記 &amp; 写真" property="og:title"><meta property='og:image' content='/cover.jpg'>`,'https://example.com/diary')).toEqual({url:'https://example.com/diary',domain:'example.com',title:'日記 & 写真',image:'https://example.com/cover.jpg'});expect(metadata(`<meta name=twitter:title content='記事'><meta name=twitter:image content='https://example.com/photo.jpg'>`,'https://example.com')).not.toBeNull();});
 it('uses page titles and descriptions even without an image',()=>{
  expect(metadata('<title>どれどれ</title>','https://george-doredore.jrkyushu.co.jp/ip/')).toMatchObject({title:'どれどれ',image:''});
  expect(metadata('<meta name="description" content="ページの説明">','https://example.com')).toMatchObject({title:'example.com',description:'ページの説明',image:''});
  expect(metadata('<meta property="og:title" content="記事"><meta property="og:image" content="javascript:alert(1)">','https://example.com')).toMatchObject({title:'記事',image:''});
  expect(metadata('<html><body>本文だけ</body></html>','https://example.com')).toBeNull();
 });
 it('rejects local address ranges, credentials and non-web protocols',()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.2.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2002:7f00:1::','2001:0000:1234::','2001:0002::1','2001:0db8::1','3fff::1','192.88.99.1','2001:4860:0:0:0:5efe:7f00:1'])expect(publicAddress(ip)).toBe(false);expect(publicAddress('1.1.1.1')).toBe(true);expect(publicAddress('2606:4700::1111')).toBe(true);expect(publicAddress('2001:4860:4860::8888')).toBe(true);for(const url of ['file:///tmp/a','http://localhost/a','https://user:pass@example.com','https://example.com:8080'])expect(()=>publicUrl(url)).toThrow();});
});

describe('Bluesky external metadata',()=>{
 it('keeps original external-card metadata for one URL',async()=>{
  const {mapBlueskyFeedItemToPost}=await import("@/lib/bluesky");
  const item={post:{uri:'at://did:plc:test/app.bsky.feed.post/one',author:{did:'did:plc:test',handle:'user.bsky.social'},record:{text:'日記 https://example.com/diary'},embed:{$type:'app.bsky.embed.external#view',external:{uri:'https://example.com/diary',title:'日記',thumb:'https://example.com/cover.jpg'}}}};
  expect(mapBlueskyFeedItemToPost(item)?.linkPreview?.title).toBe('日記');
  delete (item.post.embed.external as {thumb?:string}).thumb;expect(mapBlueskyFeedItemToPost(item)?.linkPreview?.image).toBe('');
  item.post.record.text+=' https://example.com/another';expect(mapBlueskyFeedItemToPost(item)?.linkPreview).toBeUndefined();
 });
 it('preserves a supplied homepage card when its URL has no trailing slash',async()=>{
  const {mapBlueskyFeedItemToPost}=await import("@/lib/bluesky");
  const item={post:{uri:'at://did:plc:test/app.bsky.feed.post/home',author:{did:'did:plc:test',handle:'user.bsky.social'},record:{text:'https://example.com'},embed:{$type:'app.bsky.embed.external#view',external:{uri:'https://example.com',title:'Homepage'}}}};
  expect(mapBlueskyFeedItemToPost(item)?.linkPreview?.title).toBe('Homepage');
 });
});

describe('product preview metadata',()=>{
 it('extracts real Amazon product title and high resolution image without OGP',()=>{
  const html='<title>Amazon.co.jp</title><span id="productTitle">なーんもうまくいかん！ １</span><img id="logo" src="/logo.png"><img src="https://m.media-amazon.com/images/I/cover-small.jpg" data-old-hires="https://m.media-amazon.com/images/I/cover-large.jpg" id="landingImage">';
  expect(metadata(html,'https://www.amazon.co.jp/dp/4832297554','https://amzn.asia/d/0h2mtcX5')).toMatchObject({url:'https://amzn.asia/d/0h2mtcX5',title:'なーんもうまくいかん！ １',image:'https://m.media-amazon.com/images/I/cover-large.jpg'});
  expect(metadata(html,'https://unrelated.example')).toMatchObject({image:''});
 });
 it('reads genuine structured product images and ignores malformed JSON and unrelated images',()=>{
  expect(metadata('<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"商品名","image":{"url":"/product.jpg"},"description":"商品の説明"}]}</script>','https://shop.example')).toMatchObject({title:'商品名',image:'https://shop.example/product.jpg',description:'商品の説明'});
  expect(metadata('<title>記事</title><script type="application/ld+json">bad</script><img src="/ad.jpg">','https://shop.example')).toMatchObject({title:'記事',image:''});
 });
});
});

describe("linkPreviewCache", () => {
const preview={url:'https://example.com/a',title:'保存した見出し',domain:'example.com',image:'https://example.com/cover.jpg'};
beforeEach(()=>localStorage.clear());
it('reuses saved positive metadata without expiring it',()=>{
 savePreview(preview.url,preview);
 expect(readSavedPreview(preview.url)?.preview).toEqual(preview);
 const saved=JSON.parse(localStorage.getItem('lime-link-previews-v1')!);saved[preview.url].savedAt=1;localStorage.setItem('lime-link-previews-v1',JSON.stringify(saved));
 expect(readSavedPreview(preview.url)?.preview).toEqual(preview);
});
it('recovers malformed storage and expires negative entries',()=>{
 for(const value of ['null','[]','bad']){localStorage.setItem('lime-link-previews-v1',value);expect(readSavedPreview(preview.url)).toBeUndefined();savePreview(preview.url,preview);expect(readSavedPreview(preview.url)?.preview).toEqual(preview);}
 localStorage.setItem('lime-link-previews-v1',JSON.stringify({[preview.url]:{preview:null,savedAt:1}}));expect(readSavedPreview(preview.url)).toBeUndefined();
});

it('re-fetches old incomplete Amazon cards while preserving existing complete previews',()=>{
 const url='https://amzn.asia/d/0h2mtcX5';localStorage.setItem('lime-link-previews-v1',JSON.stringify({[url]:{preview:{url,domain:'amazon.co.jp',title:'Amazon.co.jp',image:''},savedAt:Date.now(),version:3}}));expect(readSavedPreview(url)).toBeUndefined();
 savePreview(url,{url,domain:'amazon.co.jp',title:'商品名',image:'https://m.media-amazon.com/images/I/cover.jpg'});expect(readSavedPreview(url)?.preview?.title).toBe('商品名');
});
});
});
});

describe("mapLocation", () => {
describe("mapLocation", () => {
describe("mapLocation", () => {
describe('external post locations', () => {
  it.each([
    ['ここにいます geo:35.1,139.2', 35.1, 139.2],
    ['https://www.google.com/maps/search/?api=1&query=35.1%2C139.2', 35.1, 139.2],
    ['https://maps.apple.com/?ll=35.1,139.2', 35.1, 139.2],
    ['https://maps.google.com/?q=35.1,139.2', 35.1, 139.2],
    ['https://www.google.com/maps/place/example/data=!3d35.1!4d139.2', 35.1, 139.2],
    ['https://www.openstreetmap.org/?mlat=35.1&mlon=139.2', 35.1, 139.2],
  ])('reads explicitly shared coordinates: %s', (text, latitude, longitude) => {
    expect(extractPostMapLocation(text)).toEqual({ latitude, longitude });
  });
  it.each([
    '東京にいます', 'https://maps.app.goo.gl/abc',
    'https://www.google.com/maps/@35,139,10z',
    'https://evil.example/?q=35,139', 'geo:91,139', 'geo:35,181',
    'https://www.google.com/maps/search/?api=1&query=東京',
  ])('does not invent a location from %s', text => expect(extractPostMapLocation(text)).toBeNull());
  it('includes both sides of the date line and excludes invalid coordinates', () => {
    const bounds = { south: 30, north: 40, west: 170, east: -170 };
    expect(mapBoundsContain(bounds, { latitude: 35, longitude: 175 })).toBe(true);
    expect(mapBoundsContain(bounds, { latitude: 35, longitude: -175 })).toBe(true);
    expect(mapBoundsContain(bounds, { latitude: 35, longitude: 139 })).toBe(false);
    expect(mapBoundsContain(bounds, { latitude: NaN, longitude: 175 })).toBe(false);
  });
});
it('reuses a loaded area when zooming inward and detects leaving it',()=>{
 const original={south:34,north:37,west:138,east:141},loaded=expandedMapBounds(original);
 expect(mapAreaContains(loaded,{south:35,north:36,west:139,east:140})).toBe(true);
 expect(mapAreaContains(loaded,{south:43,north:44,west:140,east:141})).toBe(false);
});
it('does not treat a wider date-line crossing area as contained',()=>{
 expect(mapAreaContains({south:-80,north:80,west:170,east:-170},{south:0,north:20,west:175,east:-175})).toBe(true);
 expect(mapAreaContains({south:-80,north:80,west:170,east:-170},{south:0,north:20,west:170,east:180})).toBe(true);
});
});

describe("mapPostGroups", () => {
it('groups 10,000 dense posts without dropping any and skips offscreen projections',()=>{
 const posts=Array.from({length:10000},(_,i)=>({id:String(i),createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:35.68,longitude:139.76}}));
 const groups=groupMapPosts(posts,()=>({x:100,y:100}));expect(groups).toHaveLength(1);expect(groups[0].posts).toHaveLength(10000);
 expect(groupMapPosts(posts,()=>null)).toHaveLength(0);
});
it('keeps separate cells separately selectable',()=>{
 const posts=[0,1,2].map(i=>({id:String(i),createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:i,longitude:139}}));
 const groups=groupMapPosts(posts,p=>({x:p.mapLocation.latitude*25,y:0}));expect(groups).toHaveLength(3);expect(groups.flatMap(g=>g.posts)).toEqual(posts);
});


it('keeps coincident posts in one marker at their original position',()=>{
 const posts=['one','two'].map(id=>({id,createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:35.68113,longitude:139.76706}}));
 const groups=groupMapPosts(posts,()=>({x:120,y:80}));
 expect(groups).toHaveLength(1);expect(groups[0].point).toEqual({x:120,y:80});expect(groups[0].posts).toEqual(posts);
});
});

describe("externalMapMapping", () => {
it('retains a Bluesky destination hidden behind rich text facets', () => {
  const post = mapBlueskyFeedItemToPost({ post: {
    uri: 'at://did:plc:test/app.bsky.feed.post/location', author: { did: 'did:plc:test', handle: 'map.bsky.social' },
    record: { text: '地図', facets: [{ index: { byteStart: 0, byteEnd: 6 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://maps.apple.com/?ll=35,139' }] }] },
  } });
  expect(post?.mapLocation).toEqual({ latitude: 35, longitude: 139 });
});
it('uses a Misskey note destination and never a private note or quoted location', () => {
  const note = { id: 'test', text: 'geo:35,139', createdAt: '2026-10-09T00:00:00Z', visibility: 'public', user: { id: 'author', username: 'author' } };
  expect(mapMisskeyNote(note)?.mapLocation).toEqual({ latitude: 35, longitude: 139 });
  expect(mapMisskeyNote({ ...note, visibility: 'followers' })).toBeNull();
  expect(mapMisskeyNote({ ...note, text: '引用へのコメント', renote: note })?.mapLocation).toBeNull();
});
});
});

describe("mapPostIcon", () => {
const post={id:'p',createdAt:'2026-10-14',mapLocation:{latitude:35,longitude:139},author:{displayName:'作者',avatarUrl:'https://images.example/avatar.png'}};
describe('map avatar pin',()=>{
 it('uses the author image without injecting profile text into HTML',()=>{
  const icon=createMapPostIcon(post),node=icon.options.html as HTMLElement;
  expect(node.querySelector('img')?.src).toBe(post.author.avatarUrl);
  expect(icon.options.iconSize).toEqual([40,48]);
  expect(node.querySelector('.lime-map-avatar-pin-rim circle')?.getAttribute('stroke-width')).toBe('2');
  expect(node.querySelector('.lime-map-avatar-pin-rim circle')?.getAttribute('r')).toBe('18');
  expect(node.querySelector('img')?.referrerPolicy).toBe('no-referrer');
 });
 it('keeps a simple fallback for missing or failed icons and rejects unsafe URLs',()=>{
  const node=createMapPostIcon({...post,author:{displayName:'<script>',avatarUrl:'javascript:alert(1)'}}).options.html as HTMLElement;
  expect(node.querySelector('img')).toBeNull();expect(node.querySelector('script')).toBeNull();expect(node.textContent).toBe('<');
  const imageNode=createMapPostIcon(post).options.html as HTMLElement;
  imageNode.querySelector('img')!.dispatchEvent(new Event('error'));expect(imageNode.querySelector('img')).toBeNull();expect(imageNode.textContent).toBe('作');
 });
 it('retains the image node when zoom changes the cluster count',()=>{
  const root=document.createElement('div');root.append(createMapPostIcon(post,2).options.html as HTMLElement);const image=root.querySelector('img');
  updateMapPostIcon(root,post,1);expect(root.querySelector('img')).toBe(image);expect(root.querySelector('.lime-map-avatar-pin-count')).toBeNull();
  updateMapPostIcon(root,post,3);expect(root.querySelector('img')).toBe(image);expect(root.querySelector('.lime-map-avatar-pin-count')?.textContent).toBe('3');
 });
 it('adds only a small count when posts overlap',()=>{
  expect((createMapPostIcon(post).options.html as HTMLElement).querySelector('.lime-map-avatar-pin-count')).toBeNull();
  expect((createMapPostIcon(post,5).options.html as HTMLElement).querySelector('.lime-map-avatar-pin-count')?.textContent).toBe('5');
 });
});
});

describe("highwayLabels", () => {
describe('combined highway labels',()=>{
    it('reads complete names and numbers from coarse split-character annotations',()=>{
        expect(highwayAnnotationName({annoChar:'阪和自動車道',knj:'自'})).toBe('阪和自動車道');
        expect(highwayAnnotationName({knj:'中国自動車道'})).toBe('中国自動車道');
        expect(highwayAnnotationNumber({ftCode:2904,nRNo:'E26'})).toBe('E26');
        expect(highwayAnnotationNumber({uRNo:'',nRNo:'E2A'})).toBe('E2A');
        expect(highwayAnnotationNumber({nRNo:163})).toBeNull();
        expect(highwayAnnotationNumber({ftCode:2903,uRNo:'11'})).toBe('11');
        expect(highwayIdentity('阪神高速１１号池田線')).toEqual({number:'11',name:'池田線'});
        expect(highwayIdentity(highwayAnnotationName({annoChar:'京奈和自動車道',knj:'動'}),['E24'])).toEqual({number:'E24',name:'京奈和道'});
    });
    it('pairs actual road names with the official route number and concise display name',()=>{
        expect(highwayIdentity('中国自動車道',['E2A'])).toEqual({number:'E2A',name:'中国道'});
        expect(highwayIdentity('山陽自動車道')).toEqual({number:'E2',name:'山陽道'});
        expect(highwayIdentity('播磨自動車道')).toEqual({number:'E29',name:'播磨道'});
        expect(highwayIdentity('第二京阪道路')).toEqual({number:'E89',name:'第二京阪'});
        expect(highwayIdentity('名神高速道路')).toEqual({number:'E1',name:'名神'});
    });
    it('does not invent a number for unrecognised road names',()=>{
        expect(highwayIdentity('商店街通り',['E2A'])).toBeNull();
        expect(highwayIdentity('阪神高速湾岸線',['E2'])).toBeNull();
    });
    it('uses nearby actual numbering for routes with section-dependent numbers',()=>{
        expect(highwayIdentity('松山自動車道')).toBeNull();
        expect(highwayIdentity('松山自動車道',['E2','E56'])).toEqual({number:'E56',name:'松山道'});
    });
});
});

describe("limeMapStyle", () => {
const matches = (id: string, properties: Record<string, unknown>) => {
    const layer = createLimeMapStyle(false).layers.find(layer => layer.id === id);
    return featureFilter('filter' in layer ? layer.filter : undefined, 'layers[0].filter').filter({zoom:13}, {type:1, properties});
};
describe('LimeMaps transport style', () => {
    it('validates light and dark styles without remote style files or paid credentials', () => {
        for(const dark of [false,true]) expect(validateStyleMin(createLimeMapStyle(dark))).toEqual([]);
    });
    it('keeps highways, ordinary roads and railways while excluding closed tracks', () => {
        expect(matches('highway',{ftCode:2701,motorway:1})).toBe(true);
        expect(matches('highway',{ftCode:52703})).toBe(true);
        expect(matches('highway',{ftCode:2701,motorway:0,rdCtg:2})).toBe(false);
        expect(matches('ordinary-roads',{ftCode:2701,motorway:0,rdCtg:2})).toBe(true);
        expect(matches('highway-facilities',{ftCode:2941,name:'吹田IC'})).toBe(true);
        expect(matches('railway',{ftCode:8201,railState:0,opeState:0})).toBe(true);
        expect(matches('railway',{ftCode:8201,railState:100,opeState:1})).toBe(false);
    });
    it('places station dots on station track geometry rather than annotation positions',()=>{
        const layer=createLimeMapStyle(false).layers.find(layer=>layer.id==='station-points');
        expect(layer['source-layer']).toBe('railway');
        expect(layer.layout['symbol-placement']).toBe('line-center');
        expect(matches('station-points',{annoCtg:422})).toBe(false);
        expect(matches('station-points',{ftCode:8201,staCode:'123',opeState:0})).toBe(true);
        expect(matches('station-points',{ftCode:8201,staCode:'0',opeState:0})).toBe(false);
    });
    it('keeps city, station and major facility names without residential labels or shops', () => {
        expect(matches('cities',{annoCtg:110})).toBe(true);
        expect(matches('cities',{annoCtg:210})).toBe(false);
        expect(matches('stations',{annoCtg:422})).toBe(true);
        expect(matches('major-facilities',{annoCtg:681})).toBe(true);
        expect(matches('major-facilities',{annoCtg:671})).toBe(false);

    });
});
});
});

describe("stickers", () => {
it('persists a sticker-only post and a mixed text reply without changing normal emoji syntax',()=>{
 const body=appendSticker('ありがとう','ねこ');
 expect(splitStickers(body)).toEqual([{text:'ありがとう '},{text:'[[stamp:%E3%81%AD%E3%81%93]]',name:'ねこ'}]);
 expect(hasStickers(':cat:')).toBe(false);
 expect(hasStickers(appendSticker('','cat'))).toBe(true);
});
it('keeps invalid tokens as text and supports multiple stamps in stored bodies',()=>{
 expect(splitStickers('[[stamp:%ZZ]]')).toEqual([{text:'[[stamp:%ZZ]]'}]);
 expect(splitStickers('[[stamp:a]] [[stamp:b]]').filter(p=>p.name)).toHaveLength(2);
});
it('allows only existing Cloudinary image asset formats and safe paths',()=>{
 const base={id:'1',name:'cat',public_id:'cat',format:'gif'};
 expect(stickerUrl(base)).toBe('https://res.cloudinary.com/dveiikhhw/image/upload/custom_emojis/cat.gif');
 expect(stickerUrl({...base,public_id:'https://evil.test/a'})).toBeNull();
 expect(stickerUrl({...base,format:'svg'})).toBeNull();
});

it('uses normal emoji size only when the body also contains text',()=>{
 expect(stickersAreInline('[[stamp:cat]]')).toBe(false);
 expect(stickersAreInline('  [[stamp:cat]]\n')).toBe(false);
 expect(stickersAreInline(appendSticker('こんにちは','cat'))).toBe(true);
});

it('stores multiple inline emoji separately from a standalone stamp',()=>{
 const character=draftEmojiCharacter('cat');
 expect(character).toHaveLength(1);
 expect(serializeDraftEmojis(`a${character}b${character}`)).toBe('a[[emoji:cat]]b[[emoji:cat]]');
 expect(splitStickers(serializeDraftEmojis(character))[0]).toMatchObject({name:'cat',inline:true});
 expect(appendSticker(character,null)).toBe('[[emoji:cat]]');
});
it('replaces the selected text with one inline emoji at the cursor',()=>{
 const input=document.createElement('textarea');input.value='abcd';input.setSelectionRange(1,3);
 let changed='';insertDraftEmoji(input,input.value,'cat',value=>changed=value);
 expect(serializeDraftEmojis(changed)).toBe('a[[emoji:cat]]d');
});
});


describe('bounded query retries', () => {
 it('does not repeat permanent permission, schema or throttling failures', () => {
  for(const error of [{status:401},{status:403},{status:404},{status:429},{code:'PGRST202'},{code:'42501'},{code:'23505'},{name:'AbortError'}])expect(shouldRetryRead(0,error)).toBe(false);
 });
 it('retains the existing three retries for transient connectivity and server failures', () => {
  for(const error of [new TypeError('Failed to fetch'),{status:503},{status:408},{code:'PGRST000'}]) {expect(shouldRetryRead(0,error)).toBe(true);expect(shouldRetryRead(2,error)).toBe(true);expect(shouldRetryRead(3,error)).toBe(false);}
 });
});

describe('social content link destinations',()=>{
 it.each([
  ['https://x.com/artist/status/123456?ref=share','/post/'+encodeURIComponent('x:123456')],
  ['https://mobile.twitter.com/artist/status/123456/photo/1','/post/'+encodeURIComponent('x:123456')],
  ['https://twitter.com/i/web/status/123456','/post/'+encodeURIComponent('x:123456')],
  ['https://x.com/artist','/u/artist%40twitter.com'],
  ['https://bsky.app/profile/artist.bsky.social/post/3abc','/post/'+encodeURIComponent('bsky:at://artist.bsky.social/app.bsky.feed.post/3abc')],
  ['https://bsky.app/profile/did:plc:abc/post/3abc','/post/'+encodeURIComponent('bsky:at://did:plc:abc/app.bsky.feed.post/3abc')],
  ['https://bsky.app/profile/artist.bsky.social','/u/artist.bsky.social'],
  ['https://misskey.io/notes/abc123','/post/'+encodeURIComponent('misskey:https://misskey.io/notes/abc123')],
  ['https://misskey.io/@artist','/u/artist%40misskey.io'],
  ['https://misskey.io/@artist@remote.example','/u/artist%40remote.example'],
 ])('routes %s to the existing LimeNote reader',async(url,path)=>{
  const {socialLinkPath}=await import('@/lib/utils');expect(socialLinkPath(url)).toBe(path);
 });
 it.each(['https://x.com.evil.test/artist/status/123456','https://evil.test/notes/abc123','https://x.com@evil.test/artist/status/123456','javascript:alert(1)','https://twitter.com/settings','https://bsky.app/profile/artist.bsky.social/lists/abc','https://example.com/story'])('preserves unsupported and spoofed links: %s',async url=>{
  const {socialLinkPath}=await import('@/lib/utils');expect(socialLinkPath(url)).toBeNull();
 });
 it('resolves a Bluesky web handle to the canonical DID before fetching its thread',async()=>{
  const fetcher=vi.fn().mockImplementation(async(input:string)=>({ok:true,status:200,json:async()=>String(input).includes('getProfile')?{did:'did:plc:resolved',handle:'artist.bsky.social',displayName:'Artist'}:{thread:{post:{uri:'at://did:plc:resolved/app.bsky.feed.post/3abc',author:{did:'did:plc:resolved',handle:'artist.bsky.social'},record:{text:'linked post',createdAt:'2026-10-19'}}}}}));
  vi.stubGlobal('fetch',fetcher);
  try{
   const result=await fetchBlueskyPostThread('bsky:at://artist.bsky.social/app.bsky.feed.post/3abc');
   expect(result.post?.id).toBe('bsky:at://did:plc:resolved/app.bsky.feed.post/3abc');
   expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('uri')).toBe('at://did:plc:resolved/app.bsky.feed.post/3abc');
  }finally{vi.unstubAllGlobals();}
 });
});
