import { describe, expect, it, vi } from "vitest";
import type { PostWithAuthor } from "@/types";
import type { BlueskyAuthorFeedPage } from "./bluesky";
import { createTimelineCursor, loadTimelinePage, type TimelineCursor, type TimelineSources } from "./timelinePaging";
import { showTimelineEmpty, isTimelinePost } from "@/lib/timelinePaging";
import { mergeAccountPage } from "@/lib/accountReadClient";

describe("timelinePaging", () => {
const post = (id: string, minute: number): PostWithAuthor => ({
  id, userId: 'author', content: id, createdAt: new Date(Date.UTC(2026, 9, 2, 0, minute)).toISOString(),
  imageUrls: [], likesCount: 3, commentsCount: 0, repostsCount: 0, likedByMe: false, repostedByMe: false,
  visibility: 'public', author: { id: 'author', username: 'author', displayName: 'Author', avatarUrl: '', coverUrl: '', bio: '', createdAt: '' },
});
const mapped = (posts: PostWithAuthor[]): BlueskyAuthorFeedPage['posts'] => posts as unknown as BlueskyAuthorFeedPage['posts'];
function sourcesFor(lime: PostWithAuthor[], bluesky: Record<string, PostWithAuthor[]>): TimelineSources {
  return {
    lime: vi.fn(async (page, limit, before) => {
      const eligible = before ? lime.filter(post => post.createdAt < before.createdAt || (post.createdAt === before.createdAt && post.id < before.id)) : lime;
      return eligible.slice(before ? 0 : page * limit, before ? limit : (page + 1) * limit);
    }),
    bluesky: vi.fn(async (handle, cursor, limit) => {
      const start = Number(cursor ?? 0), end = start + limit;
      const all = bluesky[handle] ?? [];
      return { posts: mapped(all.slice(start, end)), cursor: end < all.length ? String(end) : null };
    }),
  };
}

it('starts followed twitter accounts alongside Bluesky instead of behind the entire account list',()=>{
 const cursor=createTimelineCursor(['a.bsky.social','b.bsky.social','c.bsky.social','artist@twitter.com','other@twitter.com']);
 expect(Object.keys(cursor.bluesky)).toEqual(['artist@twitter.com','a.bsky.social','other@twitter.com','b.bsky.social','c.bsky.social']);
});

describe('paired chronological timeline pagination', () => {
  it('continues both sources past the third load with no lost posts or reordered earlier pages', async () => {
    const lime = Array.from({ length: 80 }, (_, i) => post(`lime-${i}`, 200 - i * 2));
    const blue = Array.from({ length: 80 }, (_, i) => post(`bsky-${i}`, 199 - i * 2));
    const sources = sourcesFor(lime, { author: blue });
    let cursor: TimelineCursor | undefined = createTimelineCursor(['author']);
    const all: PostWithAuthor[] = [];
    for (let pageIndex = 0; cursor; pageIndex++) {
      const page = await loadTimelinePage(cursor, sources);
      if (pageIndex < 8) {
        expect(page.posts.filter(post => post.id.startsWith('lime-'))).toHaveLength(10);
        expect(page.posts.filter(post => post.id.startsWith('bsky-'))).toHaveLength(10);
      }
      if (all.length && page.posts.length) expect(all[all.length - 1].createdAt >= page.posts[0].createdAt).toBe(true);
      all.push(...page.posts); cursor = page.next;
      expect(pageIndex).toBeLessThan(10);
    }
    expect(all).toHaveLength(160);
    expect(new Set(all.map(post => post.id)).size).toBe(160);
  });
  it('starts Lime and Bluesky together and does not publish the faster response alone', async () => {
    const lime = Array.from({ length: 10 }, (_, i) => post(`lime-${i}`, 40 - i * 2));
    const blue = Array.from({ length: 10 }, (_, i) => post(`bsky-${i}`, 39 - i * 2));
    let release!: (posts: PostWithAuthor[]) => void;
    const limeCall = vi.fn((page: number) => page === 0
      ? new Promise<PostWithAuthor[]>(resolve => { release = resolve; })
      : Promise.resolve([]));
    const blueCall = vi.fn(async () => ({ posts: mapped(blue), cursor: null }));
    let published = false;
    const request = loadTimelinePage(createTimelineCursor(['author']), { lime: limeCall, bluesky: blueCall }).then(page => { published = true; return page; });
    expect(limeCall).toHaveBeenCalledTimes(1); expect(blueCall).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve(); expect(published).toBe(false);
    release(lime); const page = await request;
    expect(page.posts).toHaveLength(20);
  });
  it('keeps enough lookahead for sources with very different dates', async () => {
    const lime = Array.from({ length: 65 }, (_, i) => post(`lime-${i}`, 200 - i));
    const blue = Array.from({ length: 65 }, (_, i) => post(`bsky-${i}`, 100 - i));
    const sources = sourcesFor(lime, { author: blue });
    let cursor: TimelineCursor | undefined = createTimelineCursor(['author']);
    const all: PostWithAuthor[] = [];
    while (cursor) { const page = await loadTimelinePage(cursor, sources); all.push(...page.posts); cursor = page.next; }
    expect(all.slice(0, 65).map(post => post.id)).toEqual(lime.map(post => post.id));
    expect(all.slice(65).map(post => post.id)).toEqual(blue.map(post => post.id));
    expect(sources.bluesky).toHaveBeenCalledTimes(7);
  });
  it('keeps paging empty filtered Bluesky pages that still have a cursor', async () => {
    const sources = sourcesFor([], {});
    sources.bluesky = vi.fn(async (_, cursor) => cursor === null
      ? { posts: [], cursor: 'next' }
      : { posts: mapped([post('bsky-valid', 1)]), cursor: null });
    const page = await loadTimelinePage(createTimelineCursor(['author']), sources);
    expect(page.posts.map(post => post.id)).toEqual(['bsky-valid']); expect(page.next).toBeUndefined();
  });
  it('does not advance the saved cursor on source failure, allowing a complete retry', async () => {
    const cursor = createTimelineCursor(['author']);
    const saved = structuredClone(cursor);
    const sources = sourcesFor([post('lime', 2)], { author: [post('blue', 1)] });
    const real = sources.lime;
    sources.lime = vi.fn(async () => { throw new Error('offline'); });
    const first=await loadTimelinePage(cursor,sources);
    expect(first.posts.map(post=>post.id)).toEqual(['blue']);
    expect(first.next?.lime).toEqual(saved.lime);expect(cursor).toEqual(saved);
    sources.lime=real;expect((await loadTimelinePage(first.next!,sources)).posts.map(post=>post.id)).toEqual(['lime']);
  });
  it('continues Lime normally when no Bluesky accounts are configured', async () => {
    const lime = Array.from({ length: 47 }, (_, i) => post(`lime-${i}`, 100 - i));
    const sources = sourcesFor(lime, {}); let cursor: TimelineCursor | undefined = createTimelineCursor([]);
    const all: PostWithAuthor[] = [];
    while (cursor) { const page = await loadTimelinePage(cursor, sources); all.push(...page.posts); cursor = page.next; }
    expect(all).toEqual(lime); expect(sources.bluesky).not.toHaveBeenCalled();
  });
  it('merges multiple authors without skipping Lime or prematurely ending other sources', async () => {
    const lime = Array.from({ length: 22 }, (_, i) => post(`lime-${i}`, 99 - i * 3));
    const first = Array.from({ length: 23 }, (_, i) => post(`blue-a-${i}`, 98 - i * 3));
    const second = Array.from({ length: 25 }, (_, i) => post(`blue-b-${i}`, 97 - i * 3));
    const sources = sourcesFor(lime, { first, second }); let cursor: TimelineCursor | undefined = createTimelineCursor(['first', 'second']);
    const all: PostWithAuthor[] = [];
    while (cursor) { const page = await loadTimelinePage(cursor, sources); all.push(...page.posts); cursor = page.next; }
    expect(all).toHaveLength(70);
    expect(all.filter(post => post.id.startsWith('lime-'))).toEqual(lime);
    expect(all.every((post, index) => !index || all[index - 1].createdAt >= post.createdAt)).toBe(true);
  });
  it('uses a timestamp/ID boundary so new real-time inserts do not shift later Lime pages', async () => {
    const lime = Array.from({ length: 45 }, (_, i) => post(`lime-${i}`, 100 - i));
    const sources = sourcesFor(lime, {});
    const first = await loadTimelinePage(createTimelineCursor([]), sources);
    lime.unshift(post('new-realtime', 101));
    const second = await loadTimelinePage(first.next!, sources);
    expect(second.posts.map(post => post.id)).toEqual(lime.slice(21, 41).map(post => post.id));
    expect(second.posts.some(post => first.posts.some(previous => previous.id === post.id))).toBe(false);
  });
});

it('returns a resumable cursor after two filtered source pages instead of scanning indefinitely',async()=>{
 const sources=sourcesFor([post('native-waiting',5)],{});
 let calls=0;
 sources.bluesky=vi.fn(async()=>{calls++;return calls<=2?{posts:[],cursor:String(calls)}:{posts:mapped([post('blue-ready',6)]),cursor:null};});
 const first=await loadTimelinePage(createTimelineCursor(['author']),sources);
 expect(sources.bluesky).toHaveBeenCalledTimes(2);expect(first.posts.map(post=>post.id)).toEqual(['native-waiting']);
 const second=await loadTimelinePage(first.next!,sources);
 expect(second.posts.map(post=>post.id)).toEqual(['blue-ready']);expect(second.next).toBeUndefined();
});

it('publishes ready native posts at one second and reuses the same slow external request',async()=>{
 vi.useFakeTimers();
 let release!:(page:BlueskyAuthorFeedPage)=>void;
 const sources:TimelineSources={lime:vi.fn(async()=>[post('fast-native',3)]),bluesky:vi.fn(()=>new Promise<BlueskyAuthorFeedPage>(resolve=>{release=resolve;}))};
 try{
 let ready=false;const firstRequest=loadTimelinePage(createTimelineCursor(['slow']),sources).then(page=>{ready=true;return page;});
 await vi.advanceTimersByTimeAsync(999);expect(ready).toBe(false);
 await vi.advanceTimersByTimeAsync(1);const first=await firstRequest;
 expect(first.posts.map(post=>post.id)).toEqual(['fast-native']);expect(sources.bluesky).toHaveBeenCalledTimes(1);
 const secondRequest=loadTimelinePage(first.next!,sources);
 release({posts:mapped([post('slow-external',2)]),cursor:null});
 expect((await secondRequest).posts.map(post=>post.id)).toEqual(['slow-external']);expect(sources.bluesky).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});

it('bounds supplementary reads while publishing a single chronological page',async()=>{
  let active=0,maximum=0;
  const sources:TimelineSources={
    lime:async()=>[],
    bluesky:async(handle)=>{
      active++;maximum=Math.max(maximum,active);
      await new Promise(resolve=>setTimeout(resolve,5));active--;
      return {posts:mapped([post(handle,Number(handle))]),cursor:null};
    },
  };
  const result=await loadTimelinePage(createTimelineCursor(Array.from({length:12},(_,i)=>String(i))),sources);
  expect(maximum).toBeLessThanOrEqual(2);
  expect(result.posts).toHaveLength(12);
  expect(result.posts.map(post=>post.id)).toEqual(Array.from({length:12},(_,i)=>String(11-i)));
});

it('omits native, Bluesky and Misskey replies while retaining quotes and advancing cursors',async()=>{
 const native=[{...post('reply',10),parentId:'root'},{...post('quote',9),parentId:'root',isQuote:true},post('root',8)];
 const external=[{...post('bsky:reply',12),externalReplyToId:'bsky:parent'},{...post('misskey:reply',11),externalReplyToId:'misskey:parent'},post('bsky:root',7)];
 const page=await loadTimelinePage(createTimelineCursor(['external']),sourcesFor(native,{external}));
 expect(page.posts.map(post=>post.id)).toEqual(['quote','root','bsky:root']);
 expect(page.next).toBeUndefined();
});
});

describe("timelinePosts", () => {
it('shows an empty state after a bounded recommended scan, even when source cursors remain',()=>{
 expect(showTimelineEmpty(false,false,false,0)).toBe(true);
 expect(showTimelineEmpty(true,false,false,0)).toBe(false);
 expect(showTimelineEmpty(false,true,false,0)).toBe(false);
 expect(showTimelineEmpty(false,false,true,0)).toBe(false);
 expect(showTimelineEmpty(false,false,false,1)).toBe(false);
});
it('excludes reply reposts as well as external replies, but keeps quotes',()=>{
 expect(isTimelinePost({replyId:'reply'} as PostWithAuthor)).toBe(false);
 expect(isTimelinePost({replyPostId:'post'} as PostWithAuthor)).toBe(false);
 expect(isTimelinePost({parentId:'post',isQuote:true} as PostWithAuthor)).toBe(true);
});
});

describe("mergeAccountPages", () => {
type Item = {id:string;time:number};
const compare=(a:Item,b:Item)=>b.time-a.time||a.id.localeCompare(b.id);
it('merges all account streams in order, keeps a stable prefix, and deduplicates bookmarks across pages',async()=>{
 const data={a:[[{id:'same',time:9},{id:'a',time:7}],[{id:'later-a',time:3}]],b:[[{id:'b',time:10},{id:'same',time:8}],[{id:'later-b',time:5}]]};
 const load=vi.fn(async(id:string,offset:number)=>({items:data[id as 'a'|'b'][offset],next:offset===0?1:undefined}));
 const first=await mergeAccountPage(['a','b'],null,load,compare,item=>item.id,3);
 expect(first.items.map(i=>i.id)).toEqual(['b','same','a']);
 const saved=JSON.stringify(first.next);
 const second=await mergeAccountPage(['a','b'],first.next!,load,compare,item=>item.id,3);
 expect(second.items.map(i=>i.id)).toEqual(['later-b','later-a']);
 expect(second.next).toBeUndefined();expect(JSON.stringify(first.next)).toBe(saved);
});
it('continues past unavailable originals and stops exhausted sources',async()=>{
 const load=vi.fn(async(id:string,offset:number)=>({items:offset===1?[{id,time:1}]:[],next:id==='a'&&offset===0?1:undefined}));
 const page=await mergeAccountPage(['a','empty'],null,load,compare,item=>item.id,20);
 expect(page.items).toEqual([{id:'a',time:1}]);expect(page.next).toBeUndefined();expect(load).toHaveBeenCalledTimes(3);
});
it('does not silently omit an account when authentication or a read fails',async()=>{
 await expect(mergeAccountPage(['a','b'],null,async id=>{if(id==='b')throw new Error('login required');return {items:[{id,time:1}]};},compare,i=>i.id,20)).rejects.toThrow('login required');
});
it('aborts before reading any account',async()=>{
 const c=new AbortController();c.abort();const load=vi.fn();
 await expect(mergeAccountPage(['a'],null,load,compare,i=>i.id,20,c.signal)).rejects.toThrow();expect(load).not.toHaveBeenCalled();
});
it('retains distinct notification events even when IDs coincide across owners',async()=>{
 const page=await mergeAccountPage(['a','b'],null,async id=>({items:[{id,time:id==='a'?2:1}]}),compare,i=>i.id,20);
 expect(page.items).toHaveLength(2);
});
});

it('never labels an empty recommendation scan as no recommendations',()=>{
 for(const loading of [true,false])for(const fetching of [true,false])for(const error of [true,false])expect(showTimelineEmpty(loading,fetching,error,0,'recommended')).toBe(false);
 expect(showTimelineEmpty(false,false,false,0,'all')).toBe(true);
});

it('excludes external sources from latest while retaining LimeNote quotes of them',async()=>{
 const {isLimeNoteTimelinePost}=await import('./timelinePaging');
 expect(isLimeNoteTimelinePost({id:'native',isQuote:true,parentPost:{id:'x:20'}} as any)).toBe(true);
 for(const source of ['x','bluesky','misskey'])expect(isLimeNoteTimelinePost({id:'post',source} as any)).toBe(false);
 for(const id of ['x:20','bsky:at://post','misskey:https://misskey.io/notes/test'])expect(isLimeNoteTimelinePost({id} as any)).toBe(false);
});

it('does not mistake an empty or failed trend scan for absence of trend posts',()=>{
 for(const loading of [true,false])for(const fetching of [true,false])for(const error of [true,false]){
  expect(showTimelineEmpty(loading,fetching,error,0,'trending')).toBe(false);
 }
 expect(showTimelineEmpty(false,false,false,0,'all')).toBe(true);
});

it('keeps a failed external account resumable without hiding ready accounts',async()=>{
 const sources:TimelineSources={lime:async()=>[],bluesky:vi.fn(async handle=>{if(handle==='failed')throw new Error('429');return {posts:[{id:'ready',createdAt:'2026-10-20',author:{id:'ready',username:'ready'}} as any],cursor:null};})};
 const first=await loadTimelinePage(createTimelineCursor(['failed','ready']),sources);
 expect(first.posts.map(p=>p.id)).toEqual(['ready']);expect(first.next?.bluesky.failed).toMatchObject({cursor:null,done:false});
 expect(sources.bluesky).toHaveBeenCalledTimes(2);
 sources.bluesky=async()=>({posts:[{id:'recovered',createdAt:'2026-10-21',author:{id:'recovered',username:'recovered'}} as any],cursor:null});
 expect((await loadTimelinePage(first.next!,sources)).posts.map(p=>p.id)).toEqual(['recovered']);
});
it('surfaces a complete outage without marking every source as exhausted',async()=>{
 const sources:TimelineSources={lime:async()=>{throw new Error('offline');},bluesky:async()=>{throw new Error('offline');}};
 const cursor=createTimelineCursor(['account']);await expect(loadTimelinePage(cursor,sources)).rejects.toThrow('offline');
 expect(cursor.lime.done).toBe(false);expect(cursor.bluesky.account.done).toBe(false);
});
