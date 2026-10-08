import {splitMentionText,mentionProfileHandle,externalRead} from './utils';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchBlueskyTopicPosts, fetchBlueskyAuthorFeed, fetchBlueskyPostThread, fetchBlueskyProfile, likeBlueskyPost, unlikeBlueskyPost, followBlueskyUser, unfollowBlueskyUser, getConfiguredExternalHandles, fetchTrendingJapaneseBlueskyPosts, searchExternalUsers } from './bluesky';
import { configuredMisskeyHandles, mapMisskeyNote, type MisskeyNote, searchMisskey } from './misskey';
import { normalizeTimelineBlueskyPost } from './timelinePaging';
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
it('searches personalized topics without discarding low-like posts and passes cursor and cancellation',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({posts:[{uri:'at://did:plc:cat/app.bsky.feed.post/new',cid:'cid',author:{did:'did:plc:cat',handle:'cat.bsky.social',displayName:'Cat'},record:{$type:'app.bsky.feed.post',text:'猫の写真',createdAt:new Date().toISOString()},likeCount:0}],cursor:'next'}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  const signal=new AbortController().signal;
  const page=await fetchBlueskyTopicPosts({query:'猫',cursor:'previous',signal});
  const url=new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get('q')).toBe('猫');expect(url.searchParams.get('sort')).toBe('latest');expect(url.searchParams.get('cursor')).toBe('previous');
  expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(page.posts).toHaveLength(1);expect(page.posts[0].likesCount).toBe(0);expect(page.cursor).toBe('next');
});
it('falls back to the second public search host when the first refuses the request',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValueOnce(new Response('{"posts":[]}',{status:200}));
  vi.stubGlobal('fetch',fetcher);
  expect((await fetchBlueskyTopicPosts({query:'猫'})).posts).toEqual([]);
  expect(fetcher.mock.calls[1][0]).toContain('api.bsky.app');
});

const misskeyUser={id:'local-user',username:'cat',name:'Misskey Cat',avatarUrl:'https://media.misskeyusercontent.jp/avatar.png'};
const note:MisskeyNote={id:'note1',createdAt:'2026-10-07T00:00:00Z',text:'猫の写真',visibility:'public',user:misskeyUser,files:[{type:'image/png',url:'https://media.misskeyusercontent.jp/photo.png'}],reactions:{'❤️':3,'👍':2},repliesCount:2};
it('latest and following read only registered Misskey users, never the server-wide timeline',()=>{
  expect(getConfiguredExternalHandles()).toEqual([]);
  localStorage.setItem('lime_misskey_author_handles','["cat@misskey.io"]');
  expect(getConfiguredExternalHandles()).toEqual(['cat@misskey.io']);
  localStorage.setItem('lime_misskey_enabled','false');
  expect(getConfiguredExternalHandles()).toEqual(['cat@misskey.io']);
  expect(configuredMisskeyHandles(false)).toEqual(['cat@misskey.io']);
});
it('continues Misskey timeline pagination past private notes and pure renotes',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify([note,{...note,id:'private',visibility:'specified'},{...note,id:'renote',text:null,files:[],renote:note}])));
  vi.stubGlobal('fetch',fetcher);
  const page=await fetchBlueskyAuthorFeed({actor:'misskey.io',cursor:'before',limit:3});
  expect(fetcher.mock.calls[0][0]).toBe('https://misskey.io/api/notes/local-timeline');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({untilId:'before',limit:3});
  expect(page.cursor).toBe('renote');expect(page.posts).toHaveLength(1);
  const post=normalizeTimelineBlueskyPost(page.posts[0]);
  expect(post).toMatchObject({source:'misskey',id:'misskey:https://misskey.io/notes/note1',likesCount:5,commentsCount:2,cid:'note1'});
  expect(post.imageUrls).toEqual(note.files!.map(file=>file.url));
});
it('uses Misskey profiles and note threads rather than sending their IDs to Bluesky',async()=>{
  const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('users/show') ? misskeyUser : url.endsWith('notes/show') ? note : [note,{...note,id:'hidden',visibility:'followers'}])));
  vi.stubGlobal('fetch',fetcher);
  expect(await fetchBlueskyProfile('cat@misskey.io')).toMatchObject({id:'misskey-user:local-user',username:'cat@misskey.io'});
  const thread=await fetchBlueskyPostThread('misskey:https://misskey.io/notes/note1');
  expect(thread.post?.content).toBe('猫の写真');expect(thread.replies).toHaveLength(1);
  expect(fetcher.mock.calls.every(([url])=>url.startsWith('https://misskey.io/api/'))).toBe(true);
});
it('never publishes non-public Misskey search results or embeds them inside quotes',async()=>{
  const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('users/search') ? [misskeyUser] : [note,{...note,id:'private',visibility:'home'}])));
  vi.stubGlobal('fetch',fetcher);
  expect((await searchMisskey('猫')).posts).toHaveLength(1);
  expect(mapMisskeyNote({...note,renote:{...note,visibility:'specified'}})?.parentPost).toBeUndefined();
  expect(mapMisskeyNote({...note,id:'quote',renote:note})?.parentPost?.id).toBe('misskey:https://misskey.io/notes/note1');
});
it('does not send saved Misskey credentials or offer mutations through the reader',async()=>{
  localStorage.setItem('lime_misskey_session',JSON.stringify({did:'misskey-user:viewer',accessJwt:'old-token'}));
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(note)));vi.stubGlobal('fetch',fetcher);
  await fetchBlueskyPostThread('misskey:https://misskey.io/notes/note1').catch(()=>null);
  expect(fetcher.mock.calls.every(([,request])=>JSON.parse(request.body).i===undefined)).toBe(true);
  await expect(likeBlueskyPost('https://misskey.io/notes/note1','note1')).rejects.toThrow('元のサイト');
  await expect(followBlueskyUser('misskey-user:local-user')).rejects.toThrow('元のサイト');
});

it('does not discard Misskey posts when only its user search fails',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('users/search') ? new Response('',{status:503}):new Response(JSON.stringify([note]))));
  const result=await searchMisskey('猫 失敗');
  expect(result.posts).toHaveLength(1);expect(result.users).toEqual([]);
});
it('adding Misskey keeps the existing external recommendation budget',async()=>{
  const blue=Array.from({length:30},(_,i)=>({uri:`at://did:plc:cat/app.bsky.feed.post/${i}`,cid:`cid${i}`,author:{did:'did:plc:cat',handle:'cat.bsky.social'},record:{$type:'app.bsky.feed.post',text:'猫の写真',createdAt:new Date().toISOString()},likeCount:600}));
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('misskey.io') ? Array.from({length:30},(_,i)=>({...note,id:`note${i}`})):{posts:blue,cursor:'next'}))));
  const page=await fetchTrendingJapaneseBlueskyPosts({limit:30});
  expect(page.posts).toHaveLength(30);
  expect(page.posts.filter(post=>post.source==='misskey')).toHaveLength(10);
  expect(page.posts.filter(post=>post.source==='bluesky')).toHaveLength(20);
  expect(Object.values(JSON.parse(page.cursor!))).toEqual(['next','next','next','next']);
});

it('suggestions include both providers within the existing external slots',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('misskey.io') ? (url.endsWith('users/show') ? misskeyUser : [misskeyUser]):{actors:[{did:'did:plc:suggest',handle:'suggest.bsky.social',displayName:'Bluesky Suggest'}]}))));
  const users=await searchExternalUsers('suggest',{signal:new AbortController().signal});
  expect(users.map(user=>user.id)).toEqual(['did:plc:suggest','misskey-user:local-user']);
});
it('excluding Bluesky does not remove Misskey suggestions',async()=>{
  const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('users/show') ? misskeyUser:[misskeyUser])));vi.stubGlobal('fetch',fetcher);
  expect((await searchExternalUsers('cat',{includeBluesky:false}))[0].username).toBe('cat@misskey.io');
  expect(fetcher.mock.calls.every(([url])=>String(url).includes("misskey.io"))).toBe(true);
});
it('federated mention links remain intact and short Misskey mentions stay on their server',()=>{
  expect(splitMentionText('hello @cat@misskey.io and @cat.bsky.social.')).toEqual(['hello ','@cat@misskey.io',' and ','@cat.bsky.social','.']);
  expect(splitMentionText('@cat@misskey.io #猫',true)).toEqual(['','@cat@misskey.io',' ','#猫','']);
  expect(mentionProfileHandle('@cat',{id:'misskey-user:author',username:'author@misskey.io'})).toBe('cat@misskey.io');
  expect(mentionProfileHandle('@cat',{id:'native-user',username:'native'})).toBe('cat');
  expect(mentionProfileHandle('@cat@remote.example',{id:'misskey-user:author'})).toBe('cat@remote.example');
});

it('finds exact Misskey names beyond the server activity ranking and prefers exact handles',async()=>{
  const unrelated=Array.from({length:90},(_,i)=>({id:`unrelated-${i}`,username:`user${i}`,name:`Someone on Misskey.io ${i}`}));
  const official={id:'official',username:'system.proxy',name:'Misskey.io'};
  vi.stubGlobal('fetch',vi.fn(async(url:string,request:RequestInit)=>{
    const query=JSON.parse(String(request.body));
    if(url.endsWith('users/search'))return new Response(JSON.stringify([...unrelated,official]));
    if(query.username==='system.proxy')return new Response(JSON.stringify(official));
    return new Response('{}',{status:404});
  }));
  expect((await searchMisskey('Misskey.io',false)).users[0].username).toBe('system.proxy@misskey.io');
  expect((await searchMisskey('@system.proxy@misskey.io',false)).users[0].id).toBe('misskey-user:official');
});
it('invalid Bluesky handles keep a usable DID profile and post URL',async()=>{
  const actor={did:'did:plc:invalid-test',handle:'handle.invalid',displayName:'Valid Display'};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('getProfile') ? actor : {feed:[{post:{uri:`at://${actor.did}/app.bsky.feed.post/invalid`,cid:'cid',author:actor,record:{text:'hello',createdAt:new Date().toISOString()}}}]}))));
  expect((await fetchBlueskyProfile(actor.did))?.username).toBe(actor.did);
  const page=await fetchBlueskyAuthorFeed({actor:actor.did});
  expect(page.posts[0].author.username).toBe(actor.did);
  expect(page.posts[0].blueskyUrl).toContain(`/profile/${actor.did}/`);
});

it('cancels queued readers before they start and shares a three-request budget',async()=>{
  let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const first=Array.from({length:3},()=>externalRead(()=>waiting));
  await Promise.resolve();
  const controller=new AbortController(),read=vi.fn(async()=>undefined);
  const queued=externalRead(read,controller.signal);
  controller.abort();
  await expect(queued).rejects.toMatchObject({name:'AbortError'});
  expect(read).not.toHaveBeenCalled();
  release();await Promise.all(first);
  await externalRead(read);expect(read).toHaveBeenCalledTimes(1);
});

it('does not log an aborted typeahead search as a provider failure',async()=>{
 const {searchBluesky}=await import('./bluesky');
 const controller=new AbortController();
 const logger=vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async()=>{controller.abort();throw new DOMException('Cancelled','AbortError');}));
 try {
  await expect(searchBluesky('abort-typeahead-check',{includePosts:false,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(logger).not.toHaveBeenCalled();
 } finally {logger.mockRestore();}
});
