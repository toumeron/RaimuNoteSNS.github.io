import { afterEach, expect, it, vi, beforeEach } from "vitest";
import { mapXPost, searchX, xFeed, xPostId, xThread, xProfile, xConversationPage, searchXPage, mapXUser, fetchTwitterPostActivity } from "@/lib/fxTwitter";
import { twitterAvatarUrl } from "@/components/ui/avatar";
import { fetchBlueskyPostActivity, fetchBlueskyTopicPosts, fetchBlueskyAuthorFeed, fetchBlueskyPostThread, fetchBlueskyProfile, likeBlueskyPost, unlikeBlueskyPost, followBlueskyUser, unfollowBlueskyUser, getConfiguredExternalHandles, fetchTrendingJapaneseBlueskyPosts, searchExternalUsers, mapBlueskyFeedItemToPost, discoverBlueskyTopicFeeds, fetchBlueskyTopicFeed, refreshBlueskySession, getStoredBlueskySession, authorizedBlueskyFetch, logoutFromBluesky } from "@/lib/bluesky";
import { splitMentionText, mentionProfileHandle, externalRead, externalFetch } from "@/lib/utils";
import { searchMisskeyPostPage, configuredMisskeyHandles, mapMisskeyNote, type MisskeyNote, searchMisskey } from "@/lib/misskey";
import { normalizeTimelineBlueskyPost } from "@/lib/utils";
import { ACTIVE_ACCOUNT_KEY } from "@/lib/savedAccounts";
vi.mock("@/lib/externalAccounts", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/externalAccounts")>(),
  searchSavedAccounts:vi.fn(async()=>[])
}));

describe("fxTwitter", () => {
describe("fxTwitter", () => {
const post=(id='2110459743903084926')=>({id,type:'status',text:'アニメの動画',created_timestamp:1792080000,likes:10,reposts:3,author:{id:'783214',screen_name:'X',name:'X',avatar_url:'https://pbs.twimg.com/avatar.jpg'},media:{videos:[{url:'https://video.twimg.com/clip.mp4',thumbnail_url:'https://pbs.twimg.com/thumb.jpg',width:1920,height:1080,duration:16,format:'video/mp4'}]}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('normalizes X URLs and rejects lookalike hosts and invalid IDs',()=>{
 expect(xPostId('https://x.com/X/status/2110459743903084926?s=20')).toBe('x:2110459743903084926');expect(xPostId('https://fxtwitter.com/X/status/20')).toBe('x:20');expect(xPostId('https://x.com.evil.test/X/status/20')).toBeNull();expect(xPostId('x:bad')).toBeNull();
});
it('preserves text, media and quotes without treating X verification as Lime official status',()=>{
 const mapped=mapXPost({...post(),quote:{...post('20'),media:{photos:[{url:'https://pbs.twimg.com/art.jpg',altText:'絵',width:600,height:900}]}}})!;
 expect(mapped.source).toBe('x');expect(mapped.author.username).toBe('X@twitter.com');expect(mapped.author.isOfficial).toBe(false);expect(mapped.externalVideo).toMatchObject({format:'mp4',duration:16,width:1920});expect(mapped.parentPost?.imageUrls).toEqual(['https://pbs.twimg.com/art.jpg']);expect(mapped.parentPost?.imageDimensions).toEqual([{width:600,height:900}]);expect('video' in mapped).toBe(false);
});
it('prefers compatible Twitter MP4 variants and retains an HLS fallback',()=>{
 const source=post();
 const mapped=mapXPost({...source,media:{videos:[{...source.media.videos[0],formats:[
  {url:'https://video.twimg.com/unsupported.mp4',container:'mp4',codec:'hevc'},
  {url:'https://video.twimg.com/compatible.mp4',container:'mp4',codec:'h264'},
  {url:'https://video.twimg.com/stream.m3u8',container:'m3u8'},
 ]}]}})!;
 expect(mapped.externalVideo).toMatchObject({playlist:'https://video.twimg.com/compatible.mp4',format:'mp4',fallback:{playlist:'https://video.twimg.com/stream.m3u8',format:'hls'}});
});
it('chooses the highest compatible rendition regardless of provider order',()=>{
 const source=post();
 const formats=[
  {url:'https://video.twimg.com/vid/320x180/low.mp4',container:'mp4',codec:'h264',bitrate:256000},
  {url:'https://video.twimg.com/vid/1920x1080/high.mp4',container:'mp4',codec:'h264',bitrate:8000000},
  {url:'https://video.twimg.com/vid/1280x720/middle.mp4',container:'mp4',codec:'h264',bitrate:2000000},
  {url:'https://video.twimg.com/vid/3840x2160/incompatible.mp4',container:'mp4',codec:'hevc',bitrate:16000000},
 ];
 for(const list of [formats,[...formats].reverse()])expect(mapXPost({...source,media:{videos:[{...source.media.videos[0],formats:list}]}})?.externalVideo?.playlist).toBe(formats[1].url);
});
it('uses reported bitrate when variant dimensions are absent',()=>{
 const source=post();
 expect(mapXPost({...source,media:{videos:[{...source.media.videos[0],formats:[{url:'https://video.twimg.com/low.mp4',container:'mp4',bitrate:256000},{url:'https://video.twimg.com/high.mp4',container:'mp4',bitrate:8000000}]}]}})?.externalVideo?.playlist).toBe('https://video.twimg.com/high.mp4');
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
 const {normalizeTimelineBlueskyPost}=await import("@/lib/utils");
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
});

describe("bluesky.recommendations", () => {
describe("bluesky.recommendations", () => {
it('preserves image descriptions and labels without adding text to the visible post',()=>{
 const mapped=mapBlueskyFeedItemToPost({post:{uri:'at://did:plc:artist/app.bsky.feed.post/image',author:{did:'did:plc:artist',handle:'artist.bsky.social'},record:{text:''},embed:{images:[{fullsize:'https://images.example/art.jpg',alt:'水彩の絵',aspectRatio:{width:600,height:900}}]},labels:[{val:'ai-generated'}]}});
 expect(mapped?.content).toBe('');expect(mapped?.imageAltTexts).toEqual(['水彩の絵']);expect(mapped?.imageDimensions).toEqual([{width:600,height:900}]);expect(mapped?.contentLabels).toEqual(['ai-generated']);
});
it('uses the feed subject rather than incidental AI mentions in an art feed description',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({feeds:[
  {uri:'at://did:plc:art/app.bsky.feed.generator/art',displayName:'Art',description:'Filters out AI',likeCount:99999},
  {uri:'at://did:plc:tech/app.bsky.feed.generator/ai',displayName:'AI',description:'日本のArtificial intelligence research',likeCount:10},
 ]}))));
 expect(await discoverBlueskyTopicFeeds('ai')).toEqual(['at://did:plc:tech/app.bsky.feed.generator/ai']);
});
it('retains a keyword-free image from a non-art topic feed with source context and pagination',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({feed:[{post:{uri:'at://did:plc:food/app.bsky.feed.post/new',author:{did:'did:plc:food',handle:'food.bsky.social'},record:{text:''},embed:{images:[{fullsize:'https://images.example/food.jpg',alt:''}]}}}],cursor:'next'})));
 vi.stubGlobal('fetch',fetcher);
 const page=await fetchBlueskyTopicFeed({topic:'food',feed:'at://did:plc:food/app.bsky.feed.generator/food',cursor:'previous'});
 expect(page.posts[0].content).toBe('');expect(page.posts[0].recommendationTopics).toEqual(['food']);expect(page.cursor).toBe('next');
 expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('cursor')).toBe('previous');
});
it('preserves Misskey image comments for topic relevance when there is no body',()=>{
 const mapped=mapMisskeyNote({id:'media',createdAt:'2026-10-08T00:00:00Z',text:null,visibility:'public',user:{id:'photographer',username:'photo'},files:[{type:'image/jpeg',url:'https://images.example/view.jpg',comment:'旅行先の景色',properties:{width:900,height:600}}]});
 expect(mapped?.content).toBe('');expect(mapped?.imageAltTexts).toEqual(['旅行先の景色']);expect(mapped?.imageDimensions).toEqual([{width:900,height:600}]);
});
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
it('sends post searches directly to the search AppView instead of the public CDN',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{"posts":[]}',{status:200}));
  vi.stubGlobal('fetch',fetcher);
  expect((await fetchBlueskyTopicPosts({query:'JR東日本'})).posts).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(new URL(fetcher.mock.calls[0][0]).hostname).toBe('api.bsky.app');
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
  expect(fetcher.mock.calls.every(([url])=>!String(url).includes("bsky.app"))).toBe(true);
});
it('finds an inactive Misskey account by display name using verified cross-provider search matches',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{
  if(url.includes('api.fxtwitter.com'))return Response.json({code:200,users:[{id:'name-hint',screen_name:'Nakkar7',name:'かなめなか'},{id:'wrong-hint',screen_name:'other_artist',name:'かなめなか'}]});
  if(url.endsWith('/users/search'))return Response.json([]);
  if(url.endsWith('/users/show')){const body=JSON.parse(String(init.body));return Response.json({id:body.username,username:body.username,name:body.username==='Nakkar7'?'かなめなか':'別の人'});}
  return Response.json({actors:[]});
 }));
 const result=await searchExternalUsers('かなめなか',{source:'misskey',limit:25});
 expect(result.map(user=>user.username)).toEqual(['Nakkar7@misskey.io']);
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
 const {searchBluesky}=await import("@/lib/bluesky");
 const controller=new AbortController();
 const logger=vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async()=>{controller.abort();throw new DOMException('Cancelled','AbortError');}));
 try {
  await expect(searchBluesky('abort-typeahead-check',{includePosts:false,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(logger).not.toHaveBeenCalled();
 } finally {logger.mockRestore();}
});

it('does not discover an AI illustration feed as ordinary art',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({feeds:[{uri:'at://did:plc:ai-art/app.bsky.feed.generator/art',displayName:'AIイラスト(日本)',likeCount:999999},{uri:'at://did:plc:jp-art/app.bsky.feed.generator/art',displayName:'日本のアート',likeCount:5}]}))));
 expect(await discoverBlueskyTopicFeeds('art')).toEqual(['at://did:plc:jp-art/app.bsky.feed.generator/art']);
});
it('requests a creator media feed without any text query and preserves image-only works',async()=>{
 const request=vi.fn(async(_url:string)=>new Response(JSON.stringify({feed:[{post:{uri:'at://did:plc:media/app.bsky.feed.post/pure',author:{did:'did:plc:media',handle:'media.bsky.social'},record:{text:''},embed:{images:[{fullsize:'https://images.example/pure.jpg',alt:''}]}}}]})));vi.stubGlobal('fetch',request);
 const page=await fetchBlueskyAuthorFeed({actor:'did:plc:media',filter:'posts_with_media'});
 expect(new URL(request.mock.calls[0][0]).searchParams.get('filter')).toBe('posts_with_media');expect(page.posts[0].content).toBe('');expect(page.posts[0].imageUrls).toHaveLength(1);
});
it('reads only the authenticated account likes with the existing AppView proxy',async()=>{
 const {fetchBlueskyLikedPosts}=await import("@/lib/bluesky");
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({feed:[{post:{uri:'at://did:plc:liked-author/app.bsky.feed.post/liked',author:{did:'did:plc:liked-author',handle:'artist.bsky.social'},record:{text:''},embed:{images:[{fullsize:'https://images.example/liked.jpg',alt:''}]}}}]})));
 vi.stubGlobal('fetch',fetcher);expect(await fetchBlueskyLikedPosts()).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
 localStorage.setItem('lime_bluesky_session',JSON.stringify({did:'did:plc:own-likes-test',handle:'owner.bsky.social',accessJwt:'test-access',refreshJwt:'test-refresh'}));
 const rows=await fetchBlueskyLikedPosts();expect(rows[0].imageUrls).toEqual(['https://images.example/liked.jpg']);
 const url=new URL(fetcher.mock.calls[0][0]);expect(url.searchParams.get('actor')).toBe('did:plc:own-likes-test');expect(url.searchParams.get('limit')).toBe('100');expect(url.pathname).toContain('getActorLikes');expect(fetcher.mock.calls[0][1].headers['atproto-proxy']).toBe('did:web:api.bsky.app#bsky_appview');
});

it('keeps an external response body abortable after fetch has returned headers',async()=>{
 const controller=new AbortController();let received!:AbortSignal;
 const fetcher=vi.fn(async(_url:any,init:any)=>{received=init.signal;return new Response(new ReadableStream({start(stream){received.addEventListener('abort',()=>stream.error(received.reason),{once:true});}}));});
 vi.stubGlobal('fetch',fetcher);
 const response=await externalFetch('https://example.com/slow-body',{signal:controller.signal});
 const stopped=expect(response.json()).rejects.toMatchObject({name:'AbortError'});
 controller.abort();await stopped;expect(received.aborted).toBe(true);
});

 it('limits recommendation trending discovery to one eight-row query per continuation',async()=>{
 const fetcher=vi.fn(async(_url:string)=>new Response(JSON.stringify({posts:[],cursor:'next'})));vi.stubGlobal('fetch',fetcher);
 const first=await fetchTrendingJapaneseBlueskyPosts({limit:8,queryLimit:1});
 const firstSearch=fetcher.mock.calls.filter(([url])=>String(url).includes('searchPosts'));
 expect(firstSearch).toHaveLength(1);expect(new URL(String(firstSearch[0][0])).searchParams.get('limit')).toBe('8');
 const before=fetcher.mock.calls.length;await fetchTrendingJapaneseBlueskyPosts({limit:8,queryLimit:1,cursor:first.cursor});
 const secondSearch=fetcher.mock.calls.slice(before).filter(([url])=>String(url).includes('searchPosts'));
 expect(secondSearch).toHaveLength(1);expect(new URL(String(secondSearch[0][0])).searchParams.get('q')).not.toBe(new URL(String(firstSearch[0][0])).searchParams.get('q'));
 });

it('uses the public Discover feed when anonymous search is refused and preserves its pagination',async()=>{
 const feedPost=(id:string,language:string,likes=200)=>({post:{uri:`at://did:plc:recovery/app.bsky.feed.post/${id}`,author:{did:'did:plc:recovery',handle:'recovery.bsky.social'},record:{text:language==='ja'?'日本語のニュース':'English news',langs:[language],createdAt:new Date().toISOString()},likeCount:likes}});
 const fetcher=vi.fn(async(url:string)=>{
  if(url.includes('searchPosts'))return new Response('',{status:403});
  if(url.includes('getFeed?'))return Response.json({feed:[feedPost('ja','ja'),feedPost('en','en'),feedPost('low','ja',3)],cursor:'discover-next'});
  return Response.json([]);
 });vi.stubGlobal('fetch',fetcher);
 const first=await fetchTrendingJapaneseBlueskyPosts({limit:8,queryLimit:1});
 expect(first.posts.map(post=>post.content)).toEqual(['日本語のニュース']);
 expect(JSON.parse(first.cursor!)).toEqual({discover:'discover-next'});
 const before=fetcher.mock.calls.length;await fetchTrendingJapaneseBlueskyPosts({limit:8,queryLimit:1,cursor:first.cursor});
 const follow=fetcher.mock.calls.slice(before).map(([url])=>new URL(url));
 expect(follow).toHaveLength(1);expect(follow[0].pathname).toContain('getFeed');expect(follow[0].searchParams.get('cursor')).toBe('discover-next');
});
it('reports unavailable external sources instead of a successful empty feed when search and public feed both fail',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:403})));
 await expect(fetchTrendingJapaneseBlueskyPosts({limit:8,queryLimit:1})).rejects.toThrow('public feed unavailable');
});
});

describe("bluesky.session", () => {
const session={did:'did:plc:test',handle:'test.bsky.social',accessJwt:'access',refreshJwt:'refresh'};
const rotated={...session,accessJwt:'rotated-access',refreshJwt:'rotated-refresh'};
beforeEach(()=>{localStorage.clear();localStorage.setItem(ACTIVE_ACCOUNT_KEY,'owner');localStorage.setItem('lime_bluesky_session',JSON.stringify(session));});
afterEach(()=>vi.unstubAllGlobals());
it.each([429,500,502,503])('does not delete login on a temporary %s response',async status=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Unavailable'}),{status})));
 await expect(refreshBlueskySession()).rejects.toThrow();expect(getStoredBlueskySession()).toEqual(session);
});
it('keeps login on network loss',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('network failed');}));await expect(refreshBlueskySession()).rejects.toThrow();expect(getStoredBlueskySession()).toEqual(session);});
it.each(['ExpiredToken','InvalidToken'])('clears only a genuinely rejected refresh token: %s',async error=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error}),{status:400})));await expect(refreshBlueskySession()).rejects.toThrow();expect(getStoredBlueskySession()).toBeNull();});
it('shares one refresh across parallel requests and stores the rotated session',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 const request=vi.fn(async()=>{await pending;return new Response(JSON.stringify(rotated));});vi.stubGlobal('fetch',request);
 const a=refreshBlueskySession(),b=refreshBlueskySession();release();expect(await a).toEqual(rotated);expect(await b).toEqual(rotated);expect(request).toHaveBeenCalledTimes(1);expect(getStoredBlueskySession()).toEqual(rotated);
});
it('does not restore credentials after logout while refresh is in flight',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.includes('refreshSession')){await pending;return new Response(JSON.stringify(rotated));}return new Response('{}');}));
 const refresh=refreshBlueskySession();await logoutFromBluesky();release();expect(await refresh).toBeNull();expect(getStoredBlueskySession()).toBeNull();
});
it('does not publish another LimeNote account’s credentials after an account switch',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 vi.stubGlobal('fetch',vi.fn(async()=>{await pending;return new Response(JSON.stringify(rotated));}));
 const refresh=refreshBlueskySession();localStorage.setItem(ACTIVE_ACCOUNT_KEY,'other');release();expect(await refresh).toBeNull();expect(getStoredBlueskySession()).toEqual(session);
});
it('retries an authenticated operation with rotated access credentials',async()=>{
 const request=vi.fn(async(url:string,init:RequestInit)=>url.includes('refreshSession')?new Response(JSON.stringify(rotated)):init.headers&& (init.headers as any).Authorization==='Bearer access'?new Response(JSON.stringify({error:'ExpiredToken'}),{status:400}):new Response('{}'));
 vi.stubGlobal('fetch',request);expect((await authorizedBlueskyFetch('test')).ok).toBe(true);expect(getStoredBlueskySession()).toEqual(rotated);
});
});

describe("bluesky.video", () => {
const video={$type:'app.bsky.embed.video#view',playlist:'https://video.bsky.app/watch/abc/playlist.m3u8',thumbnail:'https://video.bsky.app/thumb.jpg',aspectRatio:{width:1080,height:1920},alt:'動画の説明'};
const map=(embed:typeof video|{$type:string;media:typeof video})=>mapBlueskyFeedItemToPost({post:{uri:'at://did:plc:artist/app.bsky.feed.post/video',author:{did:'did:plc:artist',handle:'artist.bsky.social'},record:{text:'動画'},embed}})!;
it('preserves native Bluesky HLS video and dimensions instead of displaying a still image',()=>{
 const post=map(video);expect(post.imageUrls).toEqual([]);expect(post.externalVideo).toEqual({playlist:video.playlist,thumbnail:video.thumbnail,width:1080,height:1920,duration:0,alt:video.alt});
 expect(normalizeTimelineBlueskyPost(post).externalVideo).toEqual(post.externalVideo);
});
it('retains videos attached to quote posts',()=>{expect(map({$type:'app.bsky.embed.recordWithMedia#view',media:video}).externalVideo?.playlist).toBe(video.playlist);});
it('keeps the thumbnail fallback when there is no usable playlist',()=>{const post=map({...video,playlist:'javascript:alert(1)'});expect(post.externalVideo).toBeUndefined();expect(post.imageUrls).toEqual([video.thumbnail]);});

it('retains source repost counts through timeline normalization',()=>{
 const mapped=mapBlueskyFeedItemToPost({post:{uri:'at://did:plc:artist/app.bsky.feed.post/count',author:{did:'did:plc:artist',handle:'artist.bsky.social'},record:{text:'投稿'},repostCount:123}})!;
 expect(mapped.repostsCount).toBe(123);expect(mapped.externalDetails?.reposts).toBe(123);expect(normalizeTimelineBlueskyPost(mapped).repostsCount).toBe(123);
});
});
});

it('paginates Misskey search with the last raw note ID even when the page has no media',async()=>{
 const notes=Array.from({length:30},(_,i)=>({id:'page'+i,createdAt:'2026-10-20',text:'アニメ',visibility:'public',user:{id:'artist',username:'artist'},files:[]}));
 const request=vi.fn().mockResolvedValueOnce(Response.json(notes)).mockResolvedValueOnce(Response.json([{...notes[0],id:'next-page',files:[{type:'image/jpeg',url:'https://image.test/art.jpg',properties:{width:600,height:900}}]}]));
 vi.stubGlobal('fetch',request);
 const first=await searchMisskeyPostPage('アニメ');expect(first.cursor).toBe('page29');
 const next=await searchMisskeyPostPage('アニメ',first.cursor);expect(next.cursor).toBeNull();expect(next.posts[0].imageDimensions).toEqual([{width:600,height:900}]);
 expect(JSON.parse(request.mock.calls[1][1].body).untilId).toBe('page29');vi.unstubAllGlobals();
});
