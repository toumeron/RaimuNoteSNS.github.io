import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({feed:vi.fn(),search:vi.fn(),preferences:vi.fn(),eq:vi.fn(),rows:[] as any[]}));
vi.mock('@/lib/fxTwitter',()=>({xFeed:(...args:unknown[])=>mocks.feed(...args),searchXPage:(...args:unknown[])=>mocks.search(...args)}));
vi.mock('./recommendations',()=>({getRecommendationPreferences:(...args:unknown[])=>mocks.preferences(...args)}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const b={select:()=>b,eq:(...args:unknown[])=>{mocks.eq(...args);return b;},abortSignal:async()=>({data:mocks.rows,error:null})};return b;}}}));
import {getTwitterVideoPage} from './twitter-videos';
const video=(id:string,content='アニメ',hasVideo=true)=>({id,userId:'x-user:123',source:'x',content,languages:['ja'],imageUrls:[],createdAt:new Date().toISOString(),author:{id:'x-user:123',username:'artist@twitter.com'},...(hasVideo?{externalVideo:{playlist:'https://video.example/'+id+'.m3u8',format:'hls',duration:16,width:1280,height:720}}:{})});
beforeEach(()=>{vi.clearAllMocks();mocks.rows=[{external_profile:{id:'x-user:123'}}];mocks.preferences.mockResolvedValue({authors:{},terms:{},followedTopics:['anime'],dismissedTopics:[]});});
it('combines followed twitter videos with related discoveries, rejects non-videos/unrelated posts, and preserves pagination',async()=>{
 mocks.feed.mockResolvedValue({posts:[video('x:801','フォロー中の日常'),video('x:802','画像',false)],cursor:'next-author'});
 mocks.search.mockResolvedValue({posts:[video('x:803'),video('x:804','ペット')],cursor:'yahoo:2'});
 const first=await getTwitterVideoPage('viewer');expect(first.posts.map(post=>post.id)).toEqual(['x:801','x:803']);expect(mocks.eq).toHaveBeenCalledWith('approved',true);expect(mocks.eq).toHaveBeenCalledWith('external_provider','x');expect(mocks.search).toHaveBeenCalledWith('アニメ filter:videos',expect.objectContaining({limit:2,preferAlternative:true}));
 mocks.feed.mockResolvedValue({posts:[video('x:805')],cursor:null});mocks.search.mockResolvedValue({posts:[],cursor:null});
 const second=await getTwitterVideoPage('viewer',first.nextCursor!);expect(second.posts.map(post=>post.id)).toEqual(['x:805']);expect(second.nextCursor).toBeNull();expect(first.nextCursor?.authors['x-user:123'].cursor).toBe('next-author');expect(mocks.preferences).toHaveBeenCalledTimes(1);
});
it('retains usable followed videos when discovery fails and leaves failed discovery retryable',async()=>{
 mocks.feed.mockResolvedValue({posts:[video('x:811')],cursor:null});mocks.search.mockRejectedValue(new Error('unavailable'));
 const page=await getTwitterVideoPage('viewer');expect(page.posts.map(post=>post.id)).toEqual(['x:811']);expect(page.nextCursor?.topics['アニメ']).toEqual({cursor:null,done:false});
});
