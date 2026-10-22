vi.mock("@/lib/recommendationVisualInference", async importOriginal => ({...await importOriginal<typeof import("@/lib/recommendationVisualInference")>(), enrichRecommendationVisuals:(...args:unknown[])=>mocks.analyze(...args), releaseRecommendationVisualWorker:mocks.release}));
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({analyze:vi.fn(),release:vi.fn()}));

import { useRecommendationImages } from "@/hooks/useRecommendedFeed";
const post=(id:string)=>({id,userId:id,content:'#ファンアート',imageUrls:['https://images.example/'+id+'.jpg'],recommendationTopics:['digital-illustration'],languages:['ja'],source:'x',createdAt:new Date().toISOString(),likesCount:1,commentsCount:0,repostsCount:0,author:{id,username:'artist@twitter.com',bio:'イラストレーター'}}) as PostWithAuthor;
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('does not hold first paint, checks liked and candidate pixels in one bounded job, and removes a conflicting pet image',async()=>{
 vi.stubGlobal('Worker',class{});const liked=post('liked'),candidate=post('x:501'),client=new QueryClient(),key=['image-recommendations'];
 const data={pages:[{posts:[candidate],preferences:{authors:{},terms:{},followedTopics:['digital-illustration'] as any,likedSamples:[liked]},next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:1}],pageParams:[undefined]};client.setQueryData(key,data);
 mocks.analyze.mockImplementation(async(rows:any[],_topics:any,_signal:any,checked:(post:any)=>void,budget:number)=>{expect(budget).toBeLessThanOrEqual(4);for(const row of rows)checked({...row,recommendationVisual:{version:1,kind:'pets',topics:['pets'],confidence:.95,similarity:.5,vector:Array(512).fill(0)}});return rows;});
 const view=renderHook(()=>useRecommendationImages(true,'viewer',key,data,false),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 expect(client.getQueryData<typeof data>(key)?.pages[0].posts).toHaveLength(1);expect(mocks.analyze).not.toHaveBeenCalled();
 await waitFor(()=>expect(mocks.analyze).toHaveBeenCalledTimes(1),{timeout:2500});
 expect(mocks.analyze.mock.calls[0][0].map((post:any)=>post.id)).toEqual(['liked','x:501']);expect(client.getQueryData<typeof data>(key)?.pages[0].posts).toEqual([]);expect(mocks.release).toHaveBeenCalledTimes(1);view.unmount();client.clear();
});
it('cancels a scheduled analysis when leaving the feed',async()=>{
 vi.stubGlobal('Worker',class{});const client=new QueryClient(),data={pages:[{posts:[post('x:601')],preferences:{authors:{},terms:{},followedTopics:['digital-illustration'] as any},next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:1}],pageParams:[]};
 const view=renderHook(()=>useRecommendationImages(true,'viewer',['cancel-images'],data,false),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});view.unmount();await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1250));});expect(mocks.analyze).not.toHaveBeenCalled();client.clear();
});
it('aborts hidden analysis and retries unfinished images after the app becomes visible',async()=>{
 let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);vi.stubGlobal('Worker',class{});
 const client=new QueryClient(),candidate=post('x:701'),data={pages:[{posts:[candidate],preferences:{authors:{},terms:{},followedTopics:['digital-illustration'] as any},next:undefined,pendingAnalysis:false,automaticPaused:false,requestKey:1}],pageParams:[]};
 mocks.analyze.mockImplementation((_rows:any,_topics:any,signal:AbortSignal)=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve([]),{once:true})));
 const view=renderHook(()=>useRecommendationImages(true,'viewer',['resume-images'],data,false),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 await waitFor(()=>expect(mocks.analyze).toHaveBeenCalledTimes(1),{timeout:2500});const first=mocks.analyze.mock.calls[0][2] as AbortSignal;
 act(()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));});expect(first.aborted).toBe(true);
 act(()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 await waitFor(()=>expect(mocks.analyze).toHaveBeenCalledTimes(2),{timeout:2500});expect(mocks.analyze.mock.calls[1][0].map((row:any)=>row.id)).toEqual([candidate.id]);
 view.unmount();client.clear();vi.restoreAllMocks();
});
