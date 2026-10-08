import {beforeEach,expect,it} from 'vitest';
import type {PostWithAuthor} from '@/types';
import {TOPICS,type TopicId} from './topics';
import {recommendationTopicSignals,recommendationTopicAffinity,topicAuthorCandidates} from './recommendationSignals';
import {rankRecommendations,addRecommendationInterest,recordRecommendationLike,readRecommendationLikes,type RecommendationPreferences} from './recommendations';
const imagePost=(id:string,extra:Partial<PostWithAuthor>={}):PostWithAuthor=>({id,userId:id,content:'',imageUrls:[`https://images.example/${id}.jpg`],createdAt:new Date().toISOString(),likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:id,bio:''},...extra} as PostWithAuthor);
beforeEach(()=>localStorage.clear());
it.each(TOPICS.map(topic=>[topic.name,topic.id] as const))('%s: a topic feed can recommend an image-only post without a body keyword',(_name,id)=>{
 const candidate=imagePost('topic',{recommendationTopics:[id],...(id==='digital-illustration'?{recommendationVisual:{version:1 as const,kind:'moe',topics:[id],confidence:.8,similarity:.3,vector:Array(512).fill(0)}}:{})});
 expect(recommendationTopicSignals(candidate)).toContain(id);
 expect(rankRecommendations([imagePost('unrelated'),candidate],{authors:{},terms:{},followedTopics:[id]},null)[0].id).toBe('topic');
});
it('uses media alt text and link title instead of requiring a matching body',()=>{
 expect(recommendationTopicSignals(imagePost('sports',{imageAltTexts:['サッカーの試合']}))).toContain('sports');
 expect(recommendationTopicSignals(imagePost('science',{linkPreview:{url:'https://example.com',domain:'example.com',title:'宇宙の研究',image:''}}))).toContain('science');
});
it('rates source context above a keyword and caps bonus for keyword stuffing',()=>{
 const prefs={followed:['science','sports'] as TopicId[]};
 expect(recommendationTopicAffinity(imagePost('feed',{recommendationTopics:['science']}),prefs)).toBeGreaterThan(recommendationTopicAffinity(imagePost('keyword',{content:'科学'}),prefs));
 expect(recommendationTopicAffinity(imagePost('stuffed',{recommendationTopics:['science','sports']}),prefs)).toBeCloseTo(.4);
});
it('does not let saturated unrelated text likes override an explicitly followed topic source',()=>{
 const old=imagePost('old',{content:'猫の写真',userId:'old-favorite',likesCount:10000});
 const source=imagePost('new',{recommendationTopics:['science']});
 const prefs:RecommendationPreferences={authors:{'old-favorite':10000},recentAuthors:{'old-favorite':10000},terms:{猫:10000,写真:10000},recentTerms:{猫:10000,写真:10000},followedAuthors:['old-favorite'],followedTopics:['science']};
 expect(rankRecommendations([old,source],prefs,null)[0].id).toBe('new');
});
it('learns author topic context from prior likes and retains context when the liked post has no body',()=>{
 const liked=imagePost('liked',{userId:'did:plc:science',recommendationTopics:['science']});
 recordRecommendationLike(liked,true,'viewer');
 const prefs:RecommendationPreferences={authors:{},terms:{},followedTopics:['science']};
 for(const post of readRecommendationLikes('viewer'))addRecommendationInterest(prefs,post,2);
 const next=imagePost('next',{userId:'did:plc:science'});
 expect(recommendationTopicAffinity(next,{followed:['science']},prefs.authorTopics?.[next.userId])).toBeGreaterThan(0);
});
it('keeps discovery metadata when the same post was first returned by general discovery',()=>{
 const post=imagePost('same');
 expect(rankRecommendations([post,{...post,recommendationTopics:['music']},imagePost('other')],{authors:{},terms:{},followedTopics:['music']},null).map(p=>p.id)).toEqual(['same']);
});
it('needs distinct topic works before expanding an author and limits expansion to one per provider',()=>{
 const post=imagePost('one',{userId:'misskey-user:creator',recommendationVisual:{version:1,kind:'food',topics:['food'],confidence:.8,similarity:.3,vector:Array(512).fill(0)},recommendationTopics:['food']});
 expect(topicAuthorCandidates([post,post],['food'])).toEqual([]);
 expect(topicAuthorCandidates([post,{...post,id:'two'}],['food'])).toEqual([{actor:'misskey-user:creator',topics:['food']}]);
});
it('filters declared AI art from art recommendations and preserves anti-AI declarations',()=>{
 const ai=imagePost('ai',{content:'#AIart'}),altAi=imagePost('alt-ai',{imageAltTexts:['Stable Diffusion generated picture']}),bioAi=imagePost('bio-ai',{author:{id:'artist',username:'artist',bio:'AIイラストを投稿しています'} as any});
 const human=imagePost('human',{content:'AI学習禁止・No AI・AI生成ではありません',recommendationTopics:['art']});
 expect(rankRecommendations([ai,altAi,bioAi,human],{authors:{},terms:{},followedTopics:['art']},null).map(p=>p.id)).toEqual(['human']);
 expect(rankRecommendations([ai],{authors:{},terms:{},followedTopics:['ai']},null)).toHaveLength(1);
});
it.each(TOPICS.map(topic=>[topic.name,topic.id] as const))('%s: an image-only liked creator retains language context without body or alt text',(_name,id)=>{
 const author='did:plc:creator';const liked=imagePost('liked',{userId:author,source:'bluesky',recommendationTopics:[id],recommendationLanguages:['ja'],author:{id:author,username:'creator.bsky.social'} as any});
 recordRecommendationLike(liked,true,'viewer');const prefs:RecommendationPreferences={authors:{},terms:{},followedTopics:[id]};
 for(const sample of readRecommendationLikes('viewer'))addRecommendationInterest(prefs,sample,2);
 const next=imagePost('bsky:next',{...(id==='digital-illustration'?{recommendationVisual:{version:1 as const,kind:'moe',topics:[id],confidence:.8,similarity:.3,vector:Array(512).fill(0)}}:{}),userId:author,source:'bluesky',recommendationAuthorTopics:[id],author:{id:author,username:'creator.bsky.social'} as any});
 expect(rankRecommendations([next],prefs,'viewer').map(row=>row.id)).toEqual(['bsky:next']);
});

it('does not let a saturated matching body keyword outrank an image-only topic source',()=>{const prefs:RecommendationPreferences={authors:{},terms:{イラスト:10000,猫:10000},recentTerms:{イラスト:10000,猫:10000},followedTopics:['art']};const keyword=imagePost('keyword',{content:'イラスト 猫'});const media=imagePost('source',{recommendationTopics:['art']});expect(rankRecommendations([keyword,media],prefs,null)[0].id).toBe('source');});
