import { uniqueProfileMediaPosts } from './profileReplyThreads';
import { describe, expect, it, vi, afterEach } from "vitest";
import { buildProfileReplyThreads } from "./profileReplyThreads";
import { profilePostIdentity, selectProfilePosts, collectProfilePages, externalProfileReplyThread } from "@/lib/profileReplyThreads";
import { fetchBlueskyAuthorFeed, fetchBlueskyPostThread, mapBlueskyFeedItemToPost } from "./bluesky";
import { mapMisskeyNote } from "./misskey";
import type { PostWithAuthor } from "@/types";

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
