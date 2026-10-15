import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({enrich:vi.fn(),saveLike:vi.fn(async()=>{}),saveNegative:vi.fn(async()=>{})}));
const work=(id:string,userId:string):PostWithAuthor=>({id,userId,content:'',imageUrls:[`https://example.com/${id}.jpg`],createdAt:'2026-10-09T00:00:00Z',likesCount:0,repostsCount:0,commentsCount:0,likedByMe:false,repostedByMe:false,languages:['ja'],recommendationTopics:['digital-illustration'],author:{id:userId,username:userId} as any});
const positive=work('bsky:positive','favorite');
const negative=work('bsky:negative','unwanted');
const candidate=work('bsky:candidate','unfamiliar');
vi.mock('./useAuth',()=>({useAuth:()=>({user:{id:'pixel-viewer'},loading:false})}));
vi.mock('./useRecommendationImpressions',()=>({useRecommendationImpressions:()=>{}}));
vi.mock('@/lib/bluesky',()=>({getConfiguredExternalHandles:()=>[],fetchBlueskyPost:async()=>null}));
vi.mock('@/api/external-likes',()=>({enrichExternalLike:mocks.saveLike}));
vi.mock('@/api/recommendation-feedback',async original=>({...await original<typeof import('@/api/recommendation-feedback')>(),enrichRecommendationFeedback:mocks.saveNegative,dismissRecommendation:mocks.saveNegative}));
vi.mock('@/api/recommendations',async original=>{
 const real=await original<typeof import('@/api/recommendations')>();
 const prefs=()=>({authors:{favorite:10},terms:{},followedTopics:['digital-illustration'] as any,likedSamples:[positive],feedback:[{id:negative.id,userId:negative.userId,imageUrls:negative.imageUrls,createdAt:'2026-05-01T00:00:00Z'}]});
 return {...real,getRecommendationPreferences:vi.fn(async()=>prefs()),getRecommendationPage:vi.fn(async()=>({posts:[candidate],preferences:prefs(),next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:1}))};
});
vi.mock('@/lib/recommendationVisualInference',()=>({releaseRecommendationVisualWorker:vi.fn(),enrichRecommendationVisuals:async(posts:PostWithAuthor[],_topics:any,_signal:any,checked:any)=>{
 mocks.enrich(posts);
 return posts.map(post=>{const vector=Array(512).fill(0);vector[post.id===positive.id?0:1]=1;const result={...post,recommendationVisual:{version:1,kind:post.id===positive.id?'moe':'male-character',topics:post.id===positive.id?['digital-illustration']:['art'],confidence:.9,similarity:.3,vector},recommendationVisualStatus:'checked'};checked(result);return result;});
}}));
import {useRecommendedFeed} from './useRecommendedFeed';
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});
it('loads saved preference evidence without invoking or downloading the large image model',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const {result}=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(result.current.data?.pages[0].posts).toHaveLength(1));
 await waitFor(()=>expect(result.current.data?.pages[0].preferences.likedSamples?.[0].id).toBe(positive.id));
 await new Promise(resolve=>setTimeout(resolve,700));
 expect(mocks.enrich).not.toHaveBeenCalled();expect(mocks.saveLike).not.toHaveBeenCalled();expect(mocks.saveNegative).not.toHaveBeenCalled();
});

it('removes an unwanted creator immediately and late history hydration cannot restore their post',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const {result}=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(result.current.data?.pages[0].posts).toHaveLength(1));
 let release!:()=>void;mocks.saveNegative.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 let pending!:Promise<void>;
 await act(async()=>{pending=result.current.dismiss(candidate);await Promise.resolve();});
 await waitFor(()=>expect(result.current.data?.pages[0].posts).toHaveLength(0));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,700));});
 expect(result.current.data?.pages[0].posts).toHaveLength(0);
 expect(result.current.data?.pages[0].preferences.feedback?.some(row=>row.id===candidate.id)).toBe(true);
 await act(async()=>{release();await pending;});
});
it('restores the prior feed when saving a dismissal fails',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const {result}=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(result.current.data?.pages[0].posts).toHaveLength(1));
 mocks.saveNegative.mockRejectedValueOnce(new Error('save failed'));
 await act(async()=>{await expect(result.current.dismiss(candidate)).rejects.toThrow('save failed');});
 await waitFor(()=>expect(result.current.data?.pages[0].posts[0].id).toBe(candidate.id));
});

it('keeps cached pages on remount instead of restarting the entire infinite feed',async()=>{
 const {getRecommendationPage}=await import('@/api/recommendations');
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const wrapper=({children}:any)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const first=renderHook(()=>useRecommendedFeed(true),{wrapper});
 await waitFor(()=>expect(first.result.current.data?.pages[0].posts).toHaveLength(1));
 const key=client.getQueryCache().getAll().find(query=>query.queryKey[0]==='feed')!.queryKey;
 first.unmount();client.setQueryData(key,client.getQueryData(key),{updatedAt:1});
 const second=renderHook(()=>useRecommendedFeed(true),{wrapper});
 await waitFor(()=>expect(second.result.current.data?.pages[0].posts).toHaveLength(1));
 await new Promise(resolve=>setTimeout(resolve,50));expect(getRecommendationPage).toHaveBeenCalledTimes(1);
});

it('does not eagerly fetch twenty posts once the first screen has six usable cards',async()=>{
 const {getRecommendationPage,createRecommendationCursor}=await import('@/api/recommendations');
 vi.mocked(getRecommendationPage).mockResolvedValueOnce({posts:Array.from({length:6},(_,i)=>({...candidate,id:`card-${i}`,imageUrls:[`https://images.example/card-${i}.jpg`]})),preferences:{authors:{},terms:{}},next:createRecommendationCursor([]),pendingAnalysis:false,automaticPaused:false,requestKey:2});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(view.result.current.data?.pages[0].posts).toHaveLength(6));
 await new Promise(resolve=>setTimeout(resolve,100));
 expect(getRecommendationPage).toHaveBeenCalledTimes(1);expect(view.result.current.isFilling).toBe(false);
 view.unmount();client.clear();
});

 it('warms only one small page and reuses it on the second and third visible loads',async()=>{
 const {getRecommendationPage,createRecommendationCursor}=await import('@/api/recommendations');
 const {readRecommendationDeliveries}=await import('@/lib/recommendations');
 const firstCursor={...createRecommendationCursor([]),pageKey:101},secondCursor={...createRecommendationCursor([]),pageKey:102};
 const make=(prefix:string,count:number,next:any,key:number)=>({posts:Array.from({length:count},(_,i)=>({...candidate,id:`${prefix}-${i}`,imageUrls:[`https://example.com/${prefix}-${i}.jpg`]})),preferences:{authors:{},terms:{}},next,pendingAnalysis:false,automaticPaused:false,requestKey:key});
 vi.mocked(getRecommendationPage).mockResolvedValueOnce(make('first',6,firstCursor,101)).mockResolvedValueOnce(make('second',8,secondCursor,102)).mockResolvedValueOnce(make('third',8,undefined,103));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(view.result.current.data?.pages).toHaveLength(1));
 await waitFor(()=>expect(getRecommendationPage).toHaveBeenCalledTimes(2));
 expect(view.result.current.data?.pages).toHaveLength(1);expect(readRecommendationDeliveries('pixel-viewer')['second-0']).toBeUndefined();
 await act(async()=>{await view.result.current.fetchNextPage({cancelRefetch:false});});
 await waitFor(()=>expect(view.result.current.data?.pages).toHaveLength(2));expect(getRecommendationPage).toHaveBeenCalledTimes(2);
 await waitFor(()=>expect(getRecommendationPage).toHaveBeenCalledTimes(3));
 expect(view.result.current.data?.pages).toHaveLength(2);
 await act(async()=>{await view.result.current.fetchNextPage({cancelRefetch:false});});
 await waitFor(()=>expect(view.result.current.data?.pages).toHaveLength(3));expect(getRecommendationPage).toHaveBeenCalledTimes(3);
 expect(view.result.current.data?.pages.map(page=>page.posts.length)).toEqual([6,8,8]);
 view.unmount();client.clear();
 });

it.each([true,false])('resumes an empty first screen with pending sources=%s when full history discovers a new creator',async(hasNext)=>{
 const api=await import('@/api/recommendations');
 const cursor=api.createRecommendationCursor([]);cursor.preferences={authors:{},terms:{}};cursor.stalledPages=3;
 const pages=Array.from({length:8},(_,i)=>({posts:[],preferences:{authors:{},terms:{}},next:hasNext?cursor:undefined,pendingAnalysis:false,automaticPaused:i===7,requestKey:100+i}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const key=['feed','recommended','scoring-v38-curated-discovery','pixel-viewer',[]];
 client.setQueryData(key,{pages,pageParams:Array(8).fill(cursor)});
 vi.mocked(api.getRecommendationPreferences).mockResolvedValueOnce({authors:{'new-creator':10},terms:{}});
 vi.mocked(api.getRecommendationPage).mockResolvedValueOnce({posts:[work('bsky:restored','new-creator')],preferences:{authors:{'new-creator':10},terms:{}},next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:200});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 expect(api.getRecommendationPage).not.toHaveBeenCalled();
 await waitFor(()=>expect(view.result.current.data?.pages.flatMap(page=>page.posts).map(post=>post.id)).toEqual(['bsky:restored']),{timeout:3000});
 expect(api.getRecommendationPage).toHaveBeenCalledTimes(1);expect(view.result.current.automaticPaused).toBe(false);
 view.unmount();client.clear();
});

it('does not lose hydrated creator preferences when an older empty read completes later',async()=>{
 const api=await import('@/api/recommendations');const cursor=api.createRecommendationCursor([]);cursor.preferences={authors:{},terms:{}};
 let release!:(value:any)=>void;
 vi.mocked(api.getRecommendationPage).mockResolvedValueOnce({posts:[],preferences:{authors:{},terms:{}},next:cursor,pendingAnalysis:false,automaticPaused:false,requestKey:300}).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValueOnce({posts:[work('bsky:late-history','new-creator')],preferences:{authors:{'new-creator':10},terms:{}},next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:302});
 vi.mocked(api.getRecommendationPreferences).mockResolvedValueOnce({authors:{'new-creator':10},terms:{}});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(api.getRecommendationPage).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(view.result.current.data?.pages[0].preferences.authors['new-creator']).toBe(10),{timeout:3000});
 await act(async()=>{release({posts:[],preferences:{authors:{},terms:{}},next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:301});});
 await waitFor(()=>expect(view.result.current.data?.pages.flatMap(page=>page.posts).map(post=>post.id)).toEqual(['bsky:late-history']));
 expect(api.getRecommendationPage).toHaveBeenCalledTimes(3);
 view.unmount();client.clear();
});

it('uses fresh initial preferences on refresh instead of an older cached dismissal',async()=>{
 const api=await import('@/api/recommendations');const cursor=api.createRecommendationCursor([]);
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const key=['feed','recommended','scoring-v38-curated-discovery','pixel-viewer',[]];
 const old={authors:{},terms:{},feedback:[{id:'old-dismissal',userId:'new-creator',createdAt:'2026-10-01T00:00:00Z'}]};
 client.setQueryData(key,{pages:[{posts:[],preferences:old,next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:400}],pageParams:[cursor]});
 vi.mocked(api.getRecommendationPage).mockResolvedValueOnce({posts:[work('bsky:fresh-initial','new-creator')],preferences:{authors:{'new-creator':10},terms:{}},next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:401});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await act(async()=>{await client.refetchQueries({queryKey:key});});
 await waitFor(()=>expect(view.result.current.data?.pages[0].posts.map(post=>post.id)).toEqual(['bsky:fresh-initial']));
 view.unmount();client.clear();
});

it('finishes an empty initial scan with retained source cursors and allows a visible empty state',async()=>{
 const api=await import('@/api/recommendations');
 const {showTimelineEmpty}=await import("@/lib/timelinePaging");
 const cursor=api.createRecommendationCursor([]);cursor.preferences={authors:{},terms:{}};
 const pages=Array.from({length:8},(_,i)=>({posts:[],preferences:{authors:{},terms:{}},next:cursor,pendingAnalysis:false,automaticPaused:false,requestKey:500+i}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 client.setQueryData(['feed','recommended','scoring-v38-curated-discovery','pixel-viewer',[]],{pages,pageParams:Array(8).fill(cursor)});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 expect(view.result.current.hasNextPage).toBe(true);
 expect(view.result.current.isFilling).toBe(false);
 const count=view.result.current.data!.pages.reduce((sum,page)=>sum+page.posts.length,0);
 expect(showTimelineEmpty(view.result.current.isPending||view.result.current.isFilling,view.result.current.isFetching,view.result.current.isError,count)).toBe(true);
 expect(api.getRecommendationPage).not.toHaveBeenCalled();
 view.unmount();client.clear();
});

it('continues beyond the initial empty-scan budget when only a few posts are visible and sources remain',async()=>{
 const api=await import('@/api/recommendations');const cursor=api.createRecommendationCursor([]);cursor.preferences={authors:{},terms:{}};
 const pages=Array.from({length:8},(_,i)=>({posts:i===0?[{...candidate,id:'shown-one'},{...candidate,id:'shown-two'}]:[],preferences:cursor.preferences!,next:cursor,pendingAnalysis:false,automaticPaused:false,requestKey:800+i}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['feed','recommended','scoring-v38-curated-discovery','pixel-viewer',[]],{pages,pageParams:Array(8).fill(cursor)});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(api.getRecommendationPage).toHaveBeenCalled());
 await waitFor(()=>expect(view.result.current.data?.pages.length).toBeGreaterThan(8));view.unmount();client.clear();
});

it('drops work already shown when a warmed or resumed continuation returns it again',async()=>{
 const api=await import('@/api/recommendations');const cursor=api.createRecommendationCursor([]);cursor.pageKey=90;
 const shown={...candidate,id:'already-shown'};
 const prefs={authors:{},terms:{}};
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 client.setQueryData(['feed','recommended','scoring-v38-curated-discovery','pixel-viewer',[]],{pages:[{posts:[shown],preferences:prefs,next:cursor,pendingAnalysis:false,automaticPaused:true,requestKey:1}],pageParams:[api.createRecommendationCursor([])]});
 vi.mocked(api.getRecommendationPage).mockResolvedValueOnce({posts:[shown,{...candidate,id:'another-copy'}],preferences:prefs,next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:2});
 const view=renderHook(()=>useRecommendedFeed(true),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await act(async()=>{await view.result.current.fetchNextPage();});
 expect(view.result.current.data!.pages.flatMap(page=>page.posts).map(post=>post.id)).toEqual(['already-shown']);
 view.unmount();client.clear();
});

it('continues past two filtered pages without another gesture and stops an empty cursor stream',async()=>{
 const api=await import('@/api/recommendations');
 const {useTimelineContinuation}=await import('./useTimelineContinuation');
 let reads=0;
 vi.mocked(api.getRecommendationPage).mockImplementation(async()=>{
  const key=++reads,cursor=api.createRecommendationCursor([]);cursor.pageKey=key;cursor.lime.page=key;cursor.preferences={authors:{},terms:{}};
  return {posts:key===3?Array.from({length:6},(_,i)=>work(`continued-${i}`,'creator')):[],next:cursor,preferences:cursor.preferences,pendingAnalysis:false,automaticPaused:key>=6,requestKey:key};
 });
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=renderHook(({intent})=>{
  const feed=useRecommendedFeed(true);
  useTimelineContinuation({enabled:true,inView:true,hasNextPage:!!feed.hasNextPage,isFetching:feed.isFetching,isFetchNextPageError:feed.isFetchNextPageError,automaticPaused:feed.automaticPaused,scrollIntent:intent,pageCount:feed.data?.pages.length??0,fetchNextPage:feed.fetchNextPage});
  return feed;
 },{initialProps:{intent:0},wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect({paused:view.result.current.automaticPaused,reads,pages:view.result.current.data?.pages.map(p=>({count:p.posts.length,paused:p.automaticPaused,key:p.next?.pageKey}))}).toMatchObject({paused:true}));
 expect(view.result.current.data?.pages.flatMap(page=>page.posts)).toHaveLength(6);
 expect(reads).toBe(6);
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,500));});expect(reads).toBe(6);
 view.rerender({intent:1});await waitFor(()=>expect(reads).toBe(7));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,500));});expect(reads).toBe(7);
 view.unmount();client.clear();
});

it('does not silently stop after three healthy empty continuation pages',async()=>{
 const api=await import('@/api/recommendations');const {useTimelineContinuation}=await import('./useTimelineContinuation');let reads=0;
 vi.mocked(api.getRecommendationPage).mockImplementation(async()=>{
  const key=++reads,cursor=api.createRecommendationCursor([]);cursor.pageKey=key;cursor.lime.page=key;cursor.preferences={authors:{},terms:{}};
  return {posts:key===5?Array.from({length:6},(_,i)=>work(`after-four-empty-${i}`,'creator')):[],next:key<5?cursor:undefined,preferences:cursor.preferences,pendingAnalysis:false,automaticPaused:false,requestKey:key};
 });
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=renderHook(()=>{const feed=useRecommendedFeed(true);useTimelineContinuation({enabled:true,inView:true,hasNextPage:!!feed.hasNextPage,isFetching:feed.isFetching,isFetchNextPageError:feed.isFetchNextPageError,automaticPaused:feed.automaticPaused,scrollIntent:0,pageCount:feed.data?.pages.length??0,fetchNextPage:feed.fetchNextPage});return feed;},{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(view.result.current.data?.pages.flatMap(page=>page.posts)).toHaveLength(6));expect(reads).toBe(5);view.unmount();client.clear();
});
