vi.mock("@/api/recommendations", async importOriginal => ({...await importOriginal<typeof import("@/api/recommendations")>(), getRecommendationPreferences:mocks.preferences, getRecommendationPage:mocks.general}));
vi.mock('@/lib/fxTwitter',()=>({searchXPage:mocks.twitter}));
import {beforeEach,expect,it,vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({twitter:vi.fn(),native:vi.fn(),blue:vi.fn(),misskey:vi.fn(),discover:vi.fn(),feed:vi.fn(),preferences:vi.fn(),general:vi.fn()}));
vi.mock('./posts',()=>({searchPosts:mocks.native}));
vi.mock('@/lib/bluesky',()=>({fetchBlueskyTopicPosts:mocks.blue,discoverBlueskyTopicFeeds:mocks.discover,fetchBlueskyTopicFeed:mocks.feed}));
vi.mock('@/lib/misskey',()=>({fetchMisskeyTopicPosts:mocks.misskey}));
vi.mock('@/lib/timelinePaging',async importOriginal=>({...await importOriginal<typeof import('@/lib/timelinePaging')>(),normalizeTimelineBlueskyPost:(post:PostWithAuthor)=>post}));

vi.mock('@/lib/recommendationVisual',()=>({applyCachedRecommendationVisuals:(posts:PostWithAuthor[])=>posts}));
import { createTopicCursor, getTopicPage } from "@/api/topics";
const post=(id:string,content:string):PostWithAuthor=>({id,userId:id,content,createdAt:new Date().toISOString(),imageUrls:[],likesCount:1,commentsCount:0,repostsCount:0,author:{id,username:id}} as PostWithAuthor);
beforeEach(()=>{vi.clearAllMocks();mocks.preferences.mockResolvedValue({authors:{},terms:{}});mocks.native.mockResolvedValue([]);mocks.blue.mockResolvedValue({posts:[],cursor:null});mocks.misskey.mockResolvedValue({posts:[],cursor:null});mocks.discover.mockResolvedValue([]);mocks.twitter.mockResolvedValue({posts:[],cursor:null});});
it('loads the selected topic independently, filtering unrelated posts from every service',async()=>{
 mocks.native.mockResolvedValue([post('native','科学の発見')]);mocks.blue.mockResolvedValue({posts:[post('blue','宇宙の話'),post('noise','今日のランチ')],cursor:null});mocks.misskey.mockResolvedValue({posts:[post('misskey','物理の研究')],cursor:null});
 const initial=createTopicCursor('science'),page=await getTopicPage(initial,'viewer');
 expect(page.posts.map(post=>post.id).sort()).toEqual(['blue','misskey','native']);
 expect(mocks.native).toHaveBeenCalledWith('科学',0,12,expect.any(AbortSignal));expect(mocks.blue.mock.calls[0][0].query).toBe('科学');expect(mocks.general).not.toHaveBeenCalled();
 expect(initial.round).toBe(0);expect(initial.seen).toEqual([]);expect(initial.positions[0].native).toBe(0);
 expect(page.next?.seen).toContain('native');
 const second=await getTopicPage(page.next!,'viewer');expect(second.posts).toEqual([]);expect(mocks.native.mock.calls.at(-1)?.[0]).toBe('研究');expect(mocks.preferences).toHaveBeenCalledTimes(1);
});
it('preserves other service results on a failure and keeps the failed source retryable',async()=>{
 mocks.blue.mockRejectedValue(new Error('unavailable'));mocks.native.mockResolvedValue([post('native','猫の写真')]);
 const page=await getTopicPage(createTopicCursor('pets'),'viewer');expect(page.posts).toHaveLength(1);expect(page.next?.positions[0].blueDone).toBe(false);
});
it('uses a topic feed for image-only content without borrowing creator or general recommendation queues',async()=>{
 mocks.discover.mockResolvedValue(['topic-feed']);mocks.feed.mockResolvedValue({posts:[{...post('image',''),imageUrls:['https://example.test/photo.jpg'],languages:['ja'],recommendationTopics:['pets']}],cursor:null});
 const page=await getTopicPage(createTopicCursor('pets'),'viewer');expect(page.posts.map(post=>post.id)).toEqual(['image']);expect(mocks.feed.mock.calls[0][0].topic).toBe('pets');expect(mocks.general).not.toHaveBeenCalled();
});
it('reports retrieval failures instead of pretending a broken service is an empty topic',async()=>{
 mocks.blue.mockRejectedValue(new Error('unavailable'));
 await expect(getTopicPage(createTopicCursor('science'),'viewer')).rejects.toThrow('unavailable');
});
it('never publishes a cancelled topic request',async()=>{
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 await expect(getTopicPage(createTopicCursor('science'),'viewer',controller.signal)).rejects.toThrow('cancelled');
});

it('includes related twitter posts in the initial topic page alongside other services',async()=>{
 mocks.native.mockResolvedValue([post('native-science','科学の発見')]);
 mocks.blue.mockResolvedValue({posts:[post('blue-science','宇宙の研究')],cursor:null});
 mocks.twitter.mockResolvedValue({posts:[{...post('x:7101','科学の発見'),source:'x'}, {...post('x:7102','ランチの写真'),source:'x'}],cursor:'yahoo:6'});
 const first=await getTopicPage(createTopicCursor('science'),'viewer');
 expect(new Set(first.posts.map(p=>p.id))).toEqual(new Set(['native-science','blue-science','x:7101']));
 expect(mocks.twitter).toHaveBeenCalledWith('科学',expect.objectContaining({feed:'top',preferAlternative:true,limit:6,signal:expect.any(AbortSignal)}));
 expect(first.next?.positions[0].twitter).toBe('yahoo:6');expect(first.next?.positions[0].twitterDone).toBe(false);
});
it('retains twitter pagination independently and deduplicates previously delivered posts',async()=>{
 const initial=createTopicCursor('science');initial.positions=initial.positions.map(p=>({...p,nativeDone:true,blueDone:true,misskeyDone:true,twitterDone:true}));initial.positions[0].twitterDone=false;
 mocks.twitter.mockResolvedValueOnce({posts:[{...post('x:7201','科学の発見'),source:'x'}],cursor:'yahoo:6'}).mockResolvedValueOnce({posts:[{...post('x:7201','科学の発見'),source:'x'},{...post('x:7202','物理の研究'),source:'x'}],cursor:null});
 const first=await getTopicPage(initial,'viewer');expect(first.posts.map(p=>p.id)).toEqual(['x:7201']);
 const between=await getTopicPage(first.next!,'viewer');
 const next=await getTopicPage(between.next!,'viewer');expect(next.posts.map(p=>p.id)).toEqual(['x:7202']);expect(next.next).toBeUndefined();
 expect(mocks.twitter.mock.calls[1][1].cursor).toBe('yahoo:6');expect(initial.positions[0].twitter).toBeNull();
});
it('keeps other topic results on twitter failure and retries the same twitter cursor',async()=>{
 mocks.twitter.mockRejectedValueOnce(new Error('twitter unavailable')).mockImplementation((term:string)=>Promise.resolve({posts:term==='科学'?[{...post('x:7301','科学の発見'),source:'x'}]:[],cursor:null}));
 mocks.native.mockResolvedValue([post('local-science','科学の発見')]);
 const first=await getTopicPage(createTopicCursor('science'),'viewer');expect(first.posts.map(p=>p.id)).toEqual(['local-science']);expect(first.next?.positions[0].twitterDone).toBe(false);
 const second=await getTopicPage(first.next!,'viewer');const third=await getTopicPage(second.next!,'viewer');
 expect(third.posts.map(p=>p.id)).toEqual(['x:7301']);expect(mocks.twitter.mock.calls[2][1].cursor).toBeNull();
});
