import {beforeEach,expect,it,vi} from 'vitest';
const {search,authorFeed}=vi.hoisted(()=>({search:vi.fn(),authorFeed:vi.fn()}));vi.mock('@/lib/fxTwitter',()=>({searchXPage:search,xFeed:authorFeed}));
import {writeVisualCache} from '@/lib/recommendationVisual';
import {getRecommendationTwitterPage} from './recommendation-twitter';
const preferences={authors:{},terms:{},followedTopics:['anime','digital-illustration'] as any};
beforeEach(()=>{authorFeed.mockReset();search.mockReset().mockResolvedValue({posts:[],cursor:'yahoo:2'});});
it('starts with specific artwork, reads media directly, and carries its independent cursor without mutating the previous page',async()=>{
 const first=await getRecommendationTwitterPage(preferences);expect(search).toHaveBeenCalledWith('ファンアート',expect.objectContaining({feed:'media-top',preferAlternative:true,limit:6}));
 await getRecommendationTwitterPage(preferences,first.next);expect(search.mock.calls[1][0]).toBe('オリキャラ');expect(first.next?.round).toBe(1);
});
it('uses a repeated liked work tag as retrieval evidence, without trusting an unrelated result or a single like',async()=>{
 const sample=(id:string,tag:string)=>({id,userId:'artist',content:tag,imageUrls:['https://images.example/'+id+'.jpg'],recommendationTopics:['digital-illustration']}) as any;
 search.mockResolvedValue({posts:[{...sample('x:123','#好きな作品'),author:{id:'x-user:123',bio:'お絵描きしています'},languages:['ja'],content:'#好きな作品'},{...sample('x:124','無関係'),author:{id:'x-user:124',bio:'お絵描きしています'},languages:['ja'],content:'無関係'}],cursor:null});
 const page=await getRecommendationTwitterPage({...preferences,likedSamples:[sample('one','#好きな作品'),sample('two','#好きな作品'),sample('three','#一度だけ')]});
 expect(search.mock.calls[0][0]).toBe('#好きな作品');expect(page.posts[0].recommendationSources).toContain('twitter-interest:#好きな作品');expect(page.posts.map(post=>post.id)).toEqual(['x:123']);
});

it('rejects cached pet pixels and promotional biographies despite fan-art text and high popularity',async()=>{
 const candidate=(id:string,bio:string)=>({id,userId:id,source:'x',content:'#ファンアート アニメ',imageUrls:['https://images.example/'+id+'.jpg'],languages:['ja'],createdAt:new Date().toISOString(),likesCount:99999,author:{id,username:'test@twitter.com',bio}});
 const pet=candidate('x:601','イラストレーター'),shop=candidate('x:602','アニメ・漫画グッズ販売店');
 writeVisualCache(pet.imageUrls[0],{version:1,kind:'pets',topics:['pets'],confidence:.99,similarity:.5,vector:Array(512).fill(0)});
 search.mockResolvedValue({posts:[pet,shop],cursor:null});expect((await getRecommendationTwitterPage(preferences)).posts).toEqual([]);
});
it('uses a learned twitter creator before a broad keyword search and retains their cursor',async()=>{
 authorFeed.mockResolvedValue({posts:[],cursor:'artist-next'});
 const page=await getRecommendationTwitterPage({...preferences,authors:{'x-user:555':10},authorTopics:{'x-user:555':{'digital-illustration':10}}});
 expect(authorFeed).toHaveBeenCalledWith(expect.objectContaining({actor:'x-user:555',filter:'posts_with_media',limit:8}));expect(search).not.toHaveBeenCalled();expect(page.next?.authors?.['x-user:555'].cursor).toBe('artist-next');
});
it('reads an explicitly followed handle even without learned affinity and rotates to the next followed creator',async()=>{
 authorFeed.mockResolvedValue({posts:[],cursor:'more'});
 const prefs={...preferences,authors:{},followedAuthors:['first@twitter.com','second@twitter.com']};
 let page=await getRecommendationTwitterPage(prefs);
 page=await getRecommendationTwitterPage(prefs,page.next);
 await getRecommendationTwitterPage(prefs,page.next);
 expect(authorFeed.mock.calls.map(([options])=>options.actor)).toEqual(['first@twitter.com','second@twitter.com']);
});
it('moves past a failed followed creator to topic discovery without immediately retrying that creator',async()=>{
 authorFeed.mockRejectedValue(new Error('profile unavailable'));
 const prefs={...preferences,followedAuthors:['missing@twitter.com']};
 const failed=await getRecommendationTwitterPage(prefs);
 expect(failed.error).toBeInstanceOf(Error);
 const next=await getRecommendationTwitterPage(prefs,failed.next);
 await getRecommendationTwitterPage(prefs,next.next);
 expect(search).toHaveBeenCalled();expect(authorFeed).toHaveBeenCalledTimes(1);
});
it('excludes exhausted creators from author retrieval and searches, resetting offsets for the changed query',async()=>{
 const prefs={...preferences,authors:{'x-user:55':10},followedAuthors:['x-user:55']};
 const previous={round:2,positions:{'ファンアート':{cursor:'old-offset',done:true,query:'ファンアート'}},authors:{'x-user:55':{cursor:'more',done:false}}};
 await getRecommendationTwitterPage(prefs,previous,undefined,'viewer',{'x-user:55':'repeat_artist@twitter.com'});
 expect(authorFeed).not.toHaveBeenCalled();
 expect(search).toHaveBeenCalledWith('ファンアート -from:repeat_artist',expect.objectContaining({cursor:null}));
 expect(previous.positions['ファンアート'].cursor).toBe('old-offset');
});
it('continues with recent media after popular media is exhausted rather than permanently ending discovery',async()=>{
 search.mockResolvedValue({posts:[],cursor:null});
 let page=await getRecommendationTwitterPage({...preferences,followedTopics:['science']});
 expect(page.next).toBeDefined();
 expect(search.mock.calls[0][1].feed).toBe('media-top');
 page=await getRecommendationTwitterPage({...preferences,followedTopics:['science']},page.next);
 expect(search.mock.calls[1][1]).toMatchObject({feed:'media',cursor:null});
 expect(page.next).toBeUndefined();
});
it('includes recent work immediately for the second topic query without waiting for every popular result',async()=>{
 const first=await getRecommendationTwitterPage(preferences);
 await getRecommendationTwitterPage(preferences,first.next);
 expect(search.mock.calls[0][1].feed).toBe('media-top');
 expect(search.mock.calls[1][0]).toBe('オリキャラ');expect(search.mock.calls[1][1].feed).toBe('media');
});
it('never performs caption or hashtag searches in visual-only home recommendations',async()=>{
 authorFeed.mockResolvedValue({posts:[],cursor:null});
 await getRecommendationTwitterPage({...preferences,visualOnly:true,followedAuthors:['artist@twitter.com'],terms:{ファンアート:9999},likedSamples:[{id:'liked',userId:'artist',content:'#作品タグ',imageUrls:['https://images.example/liked.jpg']}] as any});
 expect(authorFeed).not.toHaveBeenCalled();
 expect(search).toHaveBeenCalledWith('from:artist',expect.objectContaining({feed:'media'}));
 expect(search.mock.calls.every(([query])=>/^from:[a-z0-9_]+$/i.test(query))).toBe(true);
});
