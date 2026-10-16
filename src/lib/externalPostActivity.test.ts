import {afterEach,expect,it,vi} from 'vitest';
import {fetchBlueskyPostActivity} from './bluesky';
import {fetchTwitterPostActivity} from './fxTwitter';
afterEach(()=>vi.unstubAllGlobals());
it('reads Bluesky likes, reposters and quotes using the post URI and provider cursors',async()=>{
 const uri='at://did:plc:owner/app.bsky.feed.post/record';
 const actor={did:'did:plc:actor',handle:'actor.bsky.social',displayName:'Actor',avatar:'https://cdn.bsky.app/avatar.jpg'};
 const fetcher=vi.fn().mockImplementation((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes('getLikes')?{likes:[{actor}],cursor:'likes-next'}:url.includes('getRepostedBy')?{repostedBy:[actor]}:{posts:[{uri:'at://did:plc:actor/app.bsky.feed.post/quote',cid:'cid',author:actor,record:{text:'Quote',createdAt:'2026-10-17T00:00:00Z'},indexedAt:'2026-10-17T00:00:00Z'}]}))));vi.stubGlobal('fetch',fetcher);
 const likes=await fetchBlueskyPostActivity('bsky:'+uri,'likes');expect(likes.users[0].username).toBe('actor.bsky.social');expect(likes.cursor).toBe('likes-next');
 expect((await fetchBlueskyPostActivity('bsky:'+uri,'reposts','previous')).users[0].id).toBe(actor.did);
 expect((await fetchBlueskyPostActivity('bsky:'+uri,'quotes')).posts[0].content).toBe('Quote');
 expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('uri')).toBe(uri);expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('cursor')).toBe('previous');
});
it('maps twitter quotes/reposters and retains provider pagination without ever fetching likes',async()=>{
 const author={id:'123',screen_name:'actor',name:'Actor',avatar_url:'https://pbs.twimg.com/avatar_normal.jpg'};
 const fetcher=vi.fn().mockImplementation((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes('/quotes')?{code:200,results:[{id:'90102',type:'status',text:'Quote',author}],cursor:{bottom:'more'}}:{code:200,results:[{...author,type:'profile'}],cursor:{bottom:'previous'}}))));vi.stubGlobal('fetch',fetcher);
 const quotes=await fetchTwitterPostActivity('x:90101','quotes');expect(quotes.posts[0].id).toBe('x:90102');expect(quotes.cursor).toBe('more');
 const users=await fetchTwitterPostActivity('x:90101','reposts','previous');expect(users.users[0].username).toBe('actor@twitter.com');expect(users.cursor).toBeNull();expect(fetcher.mock.calls.every(call=>!call[0].includes('/likes'))).toBe(true);
});

it('does not interpret an unavailable twitter activity endpoint as an empty activity list',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:404,results:[],cursor:{}}),{status:404})));
 await expect(fetchTwitterPostActivity('x:90103','quotes')).rejects.toThrow('404');
});

it('does not expose an empty twitter reposter cursor to automatic paging',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[],cursor:{bottom:'empty-next'}}))));
 const page=await fetchTwitterPostActivity('x:90104','reposts');expect(page.users).toEqual([]);expect(page.cursor).toBeNull();
});
