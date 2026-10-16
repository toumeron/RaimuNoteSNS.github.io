import { afterEach, expect, it, vi } from "vitest";
import { mapXPost, searchX, xFeed, xPostId, xThread, xProfile, xConversationPage, searchXPage, mapXUser, fetchTwitterPostActivity } from "@/lib/fxTwitter";
import { twitterAvatarUrl } from "@/components/ui/avatar";
import { fetchBlueskyPostActivity } from "@/lib/bluesky";

describe("fxTwitter", () => {
const post=(id='2110459743903084926')=>({id,type:'status',text:'アニメの動画',created_timestamp:1792080000,likes:10,reposts:3,author:{id:'783214',screen_name:'X',name:'X',avatar_url:'https://pbs.twimg.com/avatar.jpg'},media:{videos:[{url:'https://video.twimg.com/clip.mp4',thumbnail_url:'https://pbs.twimg.com/thumb.jpg',width:1920,height:1080,duration:16,format:'video/mp4'}]}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('normalizes X URLs and rejects lookalike hosts and invalid IDs',()=>{
 expect(xPostId('https://x.com/X/status/2110459743903084926?s=20')).toBe('x:2110459743903084926');expect(xPostId('https://fxtwitter.com/X/status/20')).toBe('x:20');expect(xPostId('https://x.com.evil.test/X/status/20')).toBeNull();expect(xPostId('x:bad')).toBeNull();
});
it('preserves text, media and quotes without treating X verification as Lime official status',()=>{
 const mapped=mapXPost({...post(),quote:{...post('20'),media:{photos:[{url:'https://pbs.twimg.com/art.jpg',altText:'絵'}]}}})!;
 expect(mapped.source).toBe('x');expect(mapped.author.username).toBe('X@twitter.com');expect(mapped.author.isOfficial).toBe(false);expect(mapped.externalVideo).toMatchObject({format:'mp4',duration:16,width:1920});expect(mapped.parentPost?.imageUrls).toEqual(['https://pbs.twimg.com/art.jpg']);expect('video' in mapped).toBe(false);
});
it('does not expose protected posts or unsafe media',()=>{expect(mapXPost({...post(),author:{...post().author,protected:true}})).toBeNull();expect(mapXPost({...post(),media:{videos:[{url:'javascript:alert(1)'}]}})?.externalVideo).toBeUndefined();});
it('keeps X pagination and uses only the selected provider',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[post()],cursor:{bottom:'next-page'}})));vi.stubGlobal('fetch',fetcher);
 const page=await xFeed({actor:'X@x.com',cursor:'previous',limit:10});expect(page.cursor).toBe('next-page');expect(page.posts[0].id).toBe('x:2110459743903084926');expect(fetcher.mock.calls[0][0]).toContain('/2/profile/X/statuses?');expect(fetcher.mock.calls[0][0]).toContain('cursor=previous');
});
it('loads a URL directly and caches the same post across searches and detail views',async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({code:200,status:post('23')}))));vi.stubGlobal('fetch',fetcher);
 expect((await searchX('https://x.com/X/status/23')).posts[0].id).toBe('x:23');expect((await xThread('x:23')).post?.id).toBe('x:23');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('passes provider errors through instead of caching an empty success',async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{}',{status:429})));vi.stubGlobal('fetch',fetcher);await expect(searchX('limit-test')).rejects.toThrow('429');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('searches X posts and discovers X accounts for following',async()=>{
 const fetcher=vi.fn().mockImplementation((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes('typeahead')?{code:200,users:[post().author]}:{code:200,results:[post()]}))));vi.stubGlobal('fetch',fetcher);
 expect((await searchX('unique-anime-query')).posts[0].source).toBe('x');expect((await searchX('unique-account-query',false)).users[0].id).toBe('x-user:783214');
});
it('marks X reply posts so the chronological timeline excludes them',()=>{const mapped=mapXPost({...post('24'),replying_to:{screen_name:'parent',status:'20'}})!;expect(mapped.externalReplyToId).toBe('x:20');expect(mapped.externalReplyToUsername).toBe('parent@twitter.com');});
it('maps provider verification, polls and repost attribution without assigning Lime certification',()=>{
 const mapped=mapXPost({...post('30'),author:{...post().author,verification:{verified:true,type:'organization'}},views:4811,quotes:0,bookmarks:0,reposted_by:{id:'123',name:'紹介者',screen_name:'reader'},poll:{choices:[{label:'A',count:2},{label:'B',count:3}],total_votes:5,ends_at:'2026-10-20T00:00:00Z'}})!;
 expect(mapped.author.providerVerification).toEqual({provider:'twitter',type:'organization'});expect(mapped.author.isOfficial).toBe(false);expect(mapped.author.username).toBe('X@twitter.com');expect(mapped.externalDetails?.poll?.options[1]).toEqual({label:'B',votes:3});expect(mapped.externalRepostedBy?.displayName).toBe('紹介者');
});

it('keeps original posts and repost activities separate, but removes repeated copies of the same activity',async()=>{
 const original=post('89001'),repost={...original,reposted_by:{id:'999',name:'Reader',screen_name:'reader'}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[original,repost,{...repost}],cursor:{bottom:'activity-next'}}))));
 const page=await xFeed({actor:'activity_reader@twitter.com',includeReposts:true});
 expect(page.posts).toHaveLength(2);expect(page.posts[0].profileRepostedBy).toBeUndefined();expect(page.posts[1].profileRepostedBy).toBe('x-user:999');expect(page.cursor).toBe('activity-next');
});
it('excludes reposted media while retaining the original and authored quote media',async()=>{
 const repost={...post('89002'),reposted_by:{id:'999',name:'Reader',screen_name:'reader'}};
 const original=post('89002'),quote={...post('89003'),quote:post('89004')};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[repost,original,quote],cursor:{bottom:'media-next'}}))));
 const page=await xFeed({actor:'media_reader@twitter.com',filter:'posts_with_media',includeReposts:true});
 expect(page.posts.map(p=>p.id)).toEqual(['x:89002','x:89003']);expect(page.posts.every(p=>!p.profileRepostedBy)).toBe(true);expect(page.posts[1].isQuote).toBe(true);expect(page.cursor).toBe('media-next');
});
it('honors an explicit no-reposts profile request',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[{...post('89005'),reposted_by:{id:'999',name:'Reader',screen_name:'reader'}},post('89006')]}))));
 expect((await xFeed({actor:'no_reposts@twitter.com',includeReposts:false})).posts.map(p=>p.id)).toEqual(['x:89006']);
});

it('preserves source repost totals in the post, quote, and normalized timeline',async()=>{
 const {normalizeTimelineBlueskyPost}=await import('./timelinePaging');
 const mapped=mapXPost({...post('880001'),reposts:150,quote:{...post('880002'),reposts:35}})!;
 expect(mapped.repostsCount).toBe(150);expect(mapped.externalDetails?.reposts).toBe(150);expect(mapped.parentPost?.repostsCount).toBe(35);expect(normalizeTimelineBlueskyPost(mapped).repostsCount).toBe(150);
});
it('removes a phantom continuation when the source declares zero replies',async()=>{
 const {xConversationPage}=await import('./fxTwitter');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,status:{...post('880003'),replies:0},replies:[post('880004')],cursor:{bottom:'phantom'}}))));
 const result=await xConversationPage('x:880003');expect(result.totalReplies).toBe(0);expect(result.cursor).toBeNull();
});

it('omits automatic reply recipients while retaining reply routing and deliberate inline mentions',()=>{
 const mapped=mapXPost({...post('880011'),text:'@recipient @another 返信本文 @friend',replying_to:{screen_name:'recipient',status:'880010'}})!;
 expect(mapped.content).toBe('返信本文 @friend');expect(mapped.externalReplyToId).toBe('x:880010');expect(mapped.externalReplyToUsername).toBe('recipient@twitter.com');
 expect(mapXPost({...post('880012'),text:'@friend 通常の呼びかけ'})!.content).toBe('@friend 通常の呼びかけ');
});
});

describe("fxTwitter.conversation", () => {
const raw=(id:string,parent?:string)=>({id,type:'status',text:id,created_at:'2026-10-15T00:00:00Z',author:{id:'123',screen_name:'artist',verification:{verified:true,type:'individual'}},replying_to:parent?{screen_name:'artist',status:parent}:null});
afterEach(()=>vi.unstubAllGlobals());
it('keeps ancestors separate from replies and pages through replies without duplicates',async()=>{
 const fetcher=vi.fn().mockImplementation((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes('cursor=next')?{code:200,status:raw('102','101'),thread:[raw('100'),raw('101','100'),raw('102','101')],replies:[raw('104','103')],cursor:{bottom:'next'}}:{code:200,status:raw('102','101'),thread:[raw('100'),raw('101','100'),raw('102','101'),raw('103','102')],replies:[raw('103','102'),raw('103','102')],cursor:{bottom:'next'}}))));vi.stubGlobal('fetch',fetcher);
 const first=await xConversationPage('x:102');expect(first.post?.externalReplyParent?.id).toBe('x:101');expect(first.post?.externalReplyParent?.externalReplyParent?.id).toBe('x:100');expect(first.replies.map(post=>post.id)).toEqual(['x:103']);expect(first.cursor).toBe('next');
 const next=await xConversationPage('x:102','next');expect(next.replies.map(post=>post.id)).toEqual(['x:104']);expect(next.cursor).toBeNull();
 expect(fetcher.mock.calls[0][0]).toContain('/conversation/102');
});
it('retains parent context from grouped profile replies and keeps cursors',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[{type:'thread',statuses:[raw('111'),raw('112','111')]}],cursor:{bottom:'more'}}))));
 const page=await xFeed({actor:'artist@twitter.com',filter:'posts_with_replies'});expect(page.posts[1].externalReplyParent?.id).toBe('x:111');expect(page.cursor).toBe('more');
});
it('uses the correct Twitter search feed, full operators, pagination and cancellation',async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({code:200,results:[raw('121')],cursor:{bottom:'after'}}))));vi.stubGlobal('fetch',fetcher);const signal=new AbortController().signal;
 const page=await searchXPage('anime from:artist@twitter.com filter:videos',{cursor:'before',feed:'top',signal});const url=new URL(fetcher.mock.calls[0][0]);expect(url.searchParams.get('q')).toBe('anime from:artist filter:videos');expect(url.searchParams.get('feed')).toBe('top');expect(url.searchParams.get('cursor')).toBe('before');expect(page.cursor).toBe('after');
});
it('uses the author timeline for an author-only search even when global search is unavailable',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[raw('131')],cursor:{bottom:null}})));vi.stubGlobal('fetch',fetcher);
 expect((await searchXPage('(from:uniqueartist)')).posts[0].id).toBe('x:131');expect(fetcher.mock.calls[0][0]).toContain('/profile/uniqueartist/statuses?');
});
it('reports upstream search unavailability instead of silently claiming there are no posts',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:404,results:[]}),{status:404})));await expect(searchXPage('unavailable-global-query')).rejects.toThrow('LimeNoteへのログインが必要です');
});
it('uses the conversation endpoint through the shared external thread loader too',async()=>{
 const {fetchBlueskyPostThread}=await import("@/lib/bluesky");
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,status:raw('151'),thread:[raw('151')],replies:[raw('152','151')]})));vi.stubGlobal('fetch',fetcher);
 const thread=await fetchBlueskyPostThread('x:151');expect(thread.replies.map(post=>post.id)).toEqual(['x:152']);expect(fetcher.mock.calls[0][0]).toContain('/conversation/151');
});
it('ends reply pagination when the response contains only the post and ancestors even if a cursor is present',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,status:raw('171','170'),thread:[raw('170'),raw('171','170')],replies:[],cursor:{bottom:'phantom-next'}}))));
 const page=await xConversationPage('x:171');expect(page.replies).toEqual([]);expect(page.cursor).toBeNull();expect(page.post?.externalReplyParent?.id).toBe('x:170');
});
});

describe("twitterAvatar", () => {
it.each(['normal','bigger','mini','200x200','400x400'])('uses the full avatar instead of the %s thumbnail',size=>{const url=`https://pbs.twimg.com/profile_images/123/avatar_${size}.jpg`;expect(twitterAvatarUrl(url)).toBe('https://pbs.twimg.com/profile_images/123/avatar.jpg');expect(mapXUser({id:'123',screen_name:'artist',avatar_url:url}).avatarUrl).toBe('https://pbs.twimg.com/profile_images/123/avatar.jpg');});
it('does not modify other providers, media or lookalike domains',()=>{for(const url of ['https://example.com/profile_images/123/avatar_normal.jpg','https://pbs.twimg.com.evil.test/profile_images/123/avatar_normal.jpg','https://pbs.twimg.com/media/photo_200x200.jpg','https://pbs.twimg.com/profile_images/123/avatar.jpg'])expect(twitterAvatarUrl(url)).toBe(url);});
});

describe("externalPostActivity", () => {
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
});
