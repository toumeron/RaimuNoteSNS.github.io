import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  supabase:{auth:{getSession:mocks.session},rpc:mocks.rpc}
}));
import { learnedRecommendationScores, rankingFeatures, recordLearnedRecommendation } from "@/api/topics";
import type {PostWithAuthor} from '@/types';
const post={id:'native-post',userId:'author',source:'lime',content:'猫',createdAt:new Date().toISOString(),likesCount:1,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,imageUrls:[],author:{id:'author',username:'author'}} as PostWithAuthor;
beforeEach(()=>{vi.stubEnv('VITE_RECOMMENDATION_RANKER_ENABLED','true');mocks.session.mockResolvedValue({data:{session:{user:{id:'viewer'},access_token:'token'}}});mocks.rpc.mockReset().mockResolvedValue({error:null});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({scores:{'native-post':.7}})}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('uses a shared numerical schema for all providers and logs only the matching viewer observation',async()=>{
 const preferences={authors:{},terms:{}};
 expect(rankingFeatures(post,preferences,'viewer')).toHaveLength(15);
 expect(rankingFeatures({...post,source:'bluesky'},preferences,'viewer').slice(11,14)).toEqual([0,1,0]);
 expect(await learnedRecommendationScores([post],preferences,'viewer')).toEqual({'native-post':.7});
 recordLearnedRecommendation(post.id,'other',2);expect(mocks.rpc).not.toHaveBeenCalled();
 recordLearnedRecommendation(post.id,'viewer',0);recordLearnedRecommendation(post.id,'viewer',2);
 expect(mocks.rpc).toHaveBeenCalledWith('record_recommendation_training',{p_event:expect.objectContaining({id:post.id,action:'like',active:true,features:expect.any(Array),qid:expect.any(String)})});
});
it('records each explicit action and its removal only for observed candidates',async()=>{
 await learnedRecommendationScores([post],{authors:{},terms:{}},'viewer');
 for(const action of ['repost','bookmark','not_interested']){
  window.dispatchEvent(new CustomEvent('lime:recommendation-engagement',{detail:{id:post.id,viewer:'viewer',action,active:true}}));
  expect(mocks.rpc).toHaveBeenLastCalledWith('record_recommendation_training',{p_event:expect.objectContaining({action,active:true})});
 }
 window.dispatchEvent(new CustomEvent('lime:recommendation-engagement',{detail:{id:post.id,viewer:'viewer',action:'bookmark',active:false}}));
 expect(mocks.rpc).toHaveBeenLastCalledWith('record_recommendation_training',{p_event:expect.objectContaining({action:'bookmark',active:false})});
 const calls=mocks.rpc.mock.calls.length;
 for(const detail of [{id:'unobserved',viewer:'viewer',action:'repost',active:true},{id:post.id,viewer:'other',action:'bookmark',active:true},{id:post.id,viewer:'viewer',action:'invalid',active:true}])window.dispatchEvent(new CustomEvent('lime:recommendation-engagement',{detail}));
 expect(mocks.rpc).toHaveBeenCalledTimes(calls);
});
it('does not send another account credentials for ranking',async()=>{
 mocks.session.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'token'}}});
 expect(await learnedRecommendationScores([post],{authors:{},terms:{}},'viewer')).toEqual({});expect(fetch).not.toHaveBeenCalled();
});
it('keeps the current ranking on errors and backs off subsequent requests',async()=>{
 vi.mocked(fetch).mockRejectedValue(new Error('offline'));
 expect(await learnedRecommendationScores([post],{authors:{},terms:{}},'viewer')).toEqual({});
 expect(await learnedRecommendationScores([post],{authors:{},terms:{}},'viewer')).toEqual({});expect(fetch).toHaveBeenCalledOnce();
});
