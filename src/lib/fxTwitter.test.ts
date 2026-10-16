import {afterEach,expect,it,vi} from 'vitest';
import {mapXPost,searchX,xFeed,xPostId,xThread,xProfile} from './fxTwitter';
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
