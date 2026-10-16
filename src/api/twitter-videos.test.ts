import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({feed:vi.fn(),search:vi.fn(),preferences:vi.fn(),eq:vi.fn(),in:vi.fn(),rows:[] as any[]}));
vi.mock('@/lib/fxTwitter',()=>({xFeed:(...args:unknown[])=>mocks.feed(...args),searchXPage:(...args:unknown[])=>mocks.search(...args)}));
vi.mock('./recommendations',()=>({getRecommendationPreferences:(...args:unknown[])=>mocks.preferences(...args)}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const b={select:()=>b,eq:(...args:unknown[])=>{mocks.eq(...args);return b;},in:(...args:unknown[])=>{mocks.in(...args);return b;},abortSignal:async()=>({data:mocks.rows,error:null})};return b;}}}));
import {getTwitterVideoPage} from './twitter-videos';
const video=(id:string,content='アニメ',hasVideo=true)=>({id,userId:'x-user:123',source:'x',content,languages:['ja'],imageUrls:[],createdAt:new Date().toISOString(),author:{id:'x-user:123',username:'artist@twitter.com'},...(hasVideo?{externalVideo:{playlist:'https://video.example/'+id+'.m3u8',format:'hls',duration:16,width:1280,height:720}}:{})});
beforeEach(()=>{vi.clearAllMocks();mocks.rows=[{external_profile:{id:'x-user:123'}}];mocks.preferences.mockResolvedValue({authors:{},terms:{},followedTopics:['anime'],dismissedTopics:[]});});
it('combines followed twitter videos with related discoveries, rejects non-videos/unrelated posts, and preserves pagination',async()=>{
 mocks.feed.mockResolvedValue({posts:[video('x:801','フォロー中の日常'),video('x:802','画像',false)],cursor:'next-author'});
 mocks.search.mockResolvedValue({posts:[video('x:803'),video('x:804','ペット')],cursor:'yahoo:2'});
 const first=await getTwitterVideoPage('viewer');expect(first.posts.map(post=>post.id)).toEqual(['x:801','x:803']);expect(mocks.eq).toHaveBeenCalledWith('approved',true);expect(mocks.in).toHaveBeenCalledWith('external_provider',['x','twitter']);expect(mocks.search).toHaveBeenCalledWith('アニメ filter:videos',expect.objectContaining({limit:2,preferAlternative:true}));
 mocks.feed.mockResolvedValue({posts:[video('x:805')],cursor:null});mocks.search.mockResolvedValue({posts:[],cursor:null});
 const second=await getTwitterVideoPage('viewer',first.nextCursor!);expect(second.posts.map(post=>post.id)).toEqual(['x:805']);expect(second.nextCursor?.popular?.done).toBe(false);expect(first.nextCursor?.authors['x-user:123'].cursor).toBe('next-author');expect(mocks.preferences).toHaveBeenCalledTimes(1);
});
it('retains usable followed videos when discovery fails and leaves failed discovery retryable',async()=>{
 mocks.feed.mockResolvedValue({posts:[video('x:811')],cursor:null});mocks.search.mockRejectedValue(new Error('unavailable'));
 const page=await getTwitterVideoPage('viewer');expect(page.posts.map(post=>post.id)).toEqual(['x:811']);expect(page.nextCursor?.topics['アニメ']).toEqual({cursor:null,done:false});
});

it('uses followed account handles and checks multiple creators instead of relying only on numeric profile IDs',async()=>{
 mocks.rows=[{external_profile:{id:'x-user:123',username:'first_artist@twitter.com'}},{external_handle:'second_artist@twitter.com'}];
 mocks.preferences.mockResolvedValue({authors:{},terms:{},followedTopics:[]});mocks.feed.mockResolvedValue({posts:[video('x:821')],cursor:null});
 const page=await getTwitterVideoPage('viewer');
 expect(mocks.feed.mock.calls.map(call=>call[0].actor)).toEqual(['first_artist@twitter.com','second_artist@twitter.com']);expect(mocks.feed).toHaveBeenCalledWith(expect.objectContaining({filter:'posts_with_media',limit:20}));expect(page.posts.map(post=>post.id)).toEqual(['x:821']);
});

it('keeps explicit followed videos available even when recommendation preferences fail',async()=>{
 mocks.preferences.mockRejectedValue(new Error('preferences unavailable'));mocks.feed.mockResolvedValue({posts:[video('x:831','日常')],cursor:null});
 expect((await getTwitterVideoPage('viewer')).posts.map(post=>post.id)).toEqual(['x:831']);
});

it('falls back to top twitter videos when personal sources run out and deduplicates across pages',async()=>{
 mocks.rows=[];mocks.preferences.mockResolvedValue({authors:{},terms:{},followedTopics:[]});
 mocks.search.mockResolvedValueOnce({posts:[video('x:901'),video('x:902','photo',false)],cursor:'yahoo:6'}).mockResolvedValueOnce({posts:[video('x:901'),video('x:903')],cursor:null});
 const first=await getTwitterVideoPage('viewer');expect(first.posts.map(p=>p.id)).toEqual(['x:901']);
 expect(mocks.search).toHaveBeenCalledWith('filter:videos',expect.objectContaining({feed:'top',limit:6,preferAlternative:true}));
 const second=await getTwitterVideoPage('viewer',first.nextCursor!);expect(second.posts.map(p=>p.id)).toEqual(['x:903']);expect(second.nextCursor).toBeNull();
 expect(first.nextCursor?.popular?.cursor).toBe('yahoo:6');
});
it('uses popular videos even when all personalized sources fail',async()=>{
 mocks.feed.mockRejectedValue(new Error('author unavailable'));mocks.search.mockImplementation((q:string)=>q==='filter:videos'?Promise.resolve({posts:[video('x:904')],cursor:null}):Promise.reject(new Error('topic unavailable')));
 expect((await getTwitterVideoPage('viewer')).posts.map(p=>p.id)).toEqual(['x:904']);
});
