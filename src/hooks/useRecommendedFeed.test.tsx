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
 return {...real,getRecommendationPreferences:async()=>prefs(),getRecommendationPage:async()=>({posts:[candidate],preferences:prefs(),next:undefined,pendingAnalysis:false,requestKey:1})};
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
