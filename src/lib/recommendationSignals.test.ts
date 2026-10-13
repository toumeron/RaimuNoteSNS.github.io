import { describe, beforeEach, expect, it } from "vitest";
import type { PostWithAuthor } from "@/types";
import { TOPICS, type TopicId, matchingTopics, topicAffinity } from "./topics";
import { recommendationTopicSignals, recommendationTopicAffinity, topicAuthorCandidates } from "./recommendationSignals";
import { rankRecommendations, addRecommendationInterest, recordRecommendationLike, readRecommendationLikes, type RecommendationPreferences, recommendationQueries } from "./recommendations";
import { recommendationIsEligible } from "@/lib/recommendationSignals";
import { rankTopicPosts, topicPostRelevance } from "./topicRecommendations";
import { rankPersonalTrends } from "./search-trends";
import { FEATURE_NAMES, predictRank, validFeatures, validRankModel, type RankModel } from "../../supabase/functions/_shared/recommendationModel";

describe("recommendationSignals", () => {
const imagePost=(id:string,extra:Partial<PostWithAuthor>={}):PostWithAuthor=>({id,userId:id,content:'',imageUrls:[`https://images.example/${id}.jpg`],createdAt:new Date().toISOString(),likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:id,bio:''},...extra} as PostWithAuthor);
beforeEach(()=>localStorage.clear());
it.each(TOPICS.map(topic=>[topic.name,topic.id] as const))('%s: a topic feed can recommend an image-only post without a body keyword',(_name,id)=>{
 const candidate=imagePost('topic',{recommendationTopics:[id],...(id==='anime'?{imageAltTexts:['アニメのキャラクター作品']}:{}),...(id==='digital-illustration'?{recommendationVisual:{version:1 as const,kind:'moe',topics:[id],confidence:.8,similarity:.3,vector:Array(512).fill(0)}}:{})});
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
 const visual={version:1 as const,kind:'moe',topics:[id],confidence:.8,similarity:.3,vector:Array.from({length:512},(_,i)=>i===0?1:0)};
 const author='did:plc:creator';const liked=imagePost('liked',{userId:author,source:'bluesky',recommendationTopics:[id],recommendationLanguages:['ja'],recommendationVisual:visual,author:{id:author,username:'creator.bsky.social'} as any});
 recordRecommendationLike(liked,true,'viewer');const prefs:RecommendationPreferences={authors:{},terms:{},followedTopics:[id]};
 for(const sample of readRecommendationLikes('viewer'))addRecommendationInterest(prefs,sample,2);
 const next=imagePost('bsky:next',{recommendationVisual:visual,userId:author,source:'bluesky',recommendationAuthorTopics:[id],author:{id:author,username:'creator.bsky.social'} as any});
 expect(rankRecommendations([next],prefs,'viewer').map(row=>row.id)).toEqual(['bsky:next']);
});

it('does not let a saturated matching body keyword outrank an image-only topic source',()=>{const prefs:RecommendationPreferences={authors:{},terms:{イラスト:10000,猫:10000},recentTerms:{イラスト:10000,猫:10000},followedTopics:['art']};const keyword=imagePost('keyword',{content:'イラスト 猫'});const media=imagePost('source',{recommendationTopics:['art']});expect(rankRecommendations([keyword,media],prefs,null)[0].id).toBe('source');});
});

describe("recommendationEligibility", () => {
const post=(extra:Partial<PostWithAuthor>={}):PostWithAuthor=>({id:'bsky:post',userId:'did:creator',source:'bluesky',content:'',imageUrls:['image'],author:{id:'did:creator',username:'artist.bsky.social',displayName:'Artist',bio:''},...extra} as PostWithAuthor);
it('excludes English posts for local topics even if returned by a Japanese feed',()=>{
 expect(recommendationIsEligible(post({content:'My cute cat today',languages:['en'],recommendationTopics:['pets'],recommendationLanguages:['ja']}),['pets'])).toBe(false);
});
it('requires actual global topic relevance, not merely following finance',()=>{
 expect(recommendationIsEligible(post({content:'Markets and stocks',languages:['en'],recommendationTopics:['economy']}),['economy'])).toBe(true);
 expect(recommendationIsEligible(post({content:'My cute cat',languages:['en'],recommendationTopics:['pets']}),['economy'])).toBe(false);
});
it('accepts Japanese and preserves image-only posts from Japanese creators and feeds',()=>{
 expect(recommendationIsEligible(post({languages:['ja']}),['pets'])).toBe(true);
 expect(recommendationIsEligible(post({author:{id:'creator',username:'creator',bio:'猫を描いています'}} as any),['pets'])).toBe(true);
 expect(recommendationIsEligible(post({recommendationLanguages:['ja']}),['art'])).toBe(true);
 expect(recommendationIsEligible(post(),['art'])).toBe(false);
});
it('digital illustration requires images and media/source context without requiring an initial model download and rejects declared AI',()=>{
 const character=post({recommendationVisual:{version:1,kind:'moe',topics:['digital-illustration'],confidence:.8,similarity:.3,vector:Array(512).fill(0)},recommendationTopics:['digital-illustration'],recommendationLanguages:['ja']});
 expect(recommendationIsEligible(character,['digital-illustration'])).toBe(true);
 expect(recommendationIsEligible({...character,imageUrls:[]},['digital-illustration'])).toBe(false);
 expect(recommendationIsEligible({...character,content:'#AIart'},['digital-illustration','ai'])).toBe(false);
 expect(recommendationIsEligible(post({content:'猫の写真',recommendationTopics:['art'],languages:['ja']}),['digital-illustration'])).toBe(false);
 expect(recommendationIsEligible(post({content:'ファンアート',languages:['ja']}),['digital-illustration'])).toBe(false);
});

it('Japanese hashtags do not disguise an otherwise English post',()=>{expect(recommendationIsEligible(post({content:'Here is my beautiful illustration of an anime character #猫 #イラスト',languages:['en'],recommendationLanguages:['ja']}),['art'])).toBe(false);});

it('rejects replies from ranked feeds even when language and topic match',()=>{
 expect(recommendationIsEligible(post({content:'科学のニュース',languages:['ja'],externalReplyToId:'bsky:parent'}),['science'])).toBe(false);
 expect(recommendationIsEligible(post({id:'native',source:undefined,replyId:'comment'}),[])).toBe(false);
});
});

describe("topicRecommendations", () => {
const now=Date.parse('2026-10-12T00:00:00Z');
const post=(id:string,content:string,source='bluesky'):PostWithAuthor=>({id,userId:id,source,content,createdAt:new Date(now-3600000).toISOString(),imageUrls:[],likesCount:1,commentsCount:0,repostsCount:0,author:{id,username:id},likedByMe:false,repostedByMe:false} as PostWithAuthor);
it('prioritizes actual topic content over popular retrieval hints and rejects unrelated creators',()=>{
 const exact=post('exact','科学の新しい研究結果');
 const noisy={...post('hint','今日はいい天気'),recommendationTopics:['science'],likesCount:1000000};
 const unrelated={...post('bio','昼ごはん'),author:{...post('bio','').author,bio:'科学研究者'}};
 expect(rankTopicPosts([noisy,unrelated,exact],'science',{authors:{bio:100},terms:{}},now).map(post=>post.id)).toEqual(['exact','hint']);
 expect(topicPostRelevance(unrelated,'science')).toBe(0);
});
it('uses personal affinity within the topic and treats all providers alike with deterministic ties',()=>{
 const native=post('native','科学の実験をしました','native'),blue=post('blue','研究の成果を発表しました'),misskey=post('misskey','宇宙についての新しい発見','misskey');
 const prefs={authors:{misskey:10},terms:{},dismissedTopics:['science'] as const};
 const rank=(rows:PostWithAuthor[])=>rankTopicPosts(rows,'science',{...prefs,dismissedTopics:['science']},now).map(post=>post.id);
 expect(rank([native,blue,misskey])[0]).toBe('misskey');expect(rank([native,blue,misskey])).toEqual(rank([misskey,native,blue]));
});
it('rejects a feed hint contradicted by verified image evidence and removes duplicates',()=>{
 const wrong={...post('wrong','写真'),recommendationTopics:['science'],recommendationVisual:{kind:'photo',topics:['pets'],confidence:.9}} as PostWithAuthor;
 const exact=post('exact','科学の研究');
 expect(topicPostRelevance(wrong,'science')).toBe(0);
 expect(rankTopicPosts([exact,exact,wrong],'science',{authors:{},terms:{}},now)).toHaveLength(1);
});
});

describe("topics", () => {
const post=(id:string,content:string,source:'bluesky'|'misskey'):PostWithAuthor=>({id,userId:id,source,content,createdAt:new Date().toISOString(),imageUrls:[],likesCount:1,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:id}} as PostWithAuthor);
describe('explicit topic preferences',()=>{
 it('contains exactly the requested topics with unique IDs',()=>{expect(TOPICS).toHaveLength(22);expect(new Set(TOPICS.map(t=>t.id)).size).toBe(22);});
 it('matches Japanese and English content without matching AI inside an unrelated word or URL',()=>{
  expect(matchingTopics('猫と犬の写真')).toContain('pets');expect(matchingTopics('AI research')).toContain('ai');
  expect(matchingTopics('daily email https://example.org/AI')).not.toContain('ai');
 });
 it('uses explicit interests for discovery even without likes and never searches dismissed learned interests',()=>{
  const prefs:RecommendationPreferences={authors:{},terms:{猫:100,音楽:2},followedTopics:['games'],dismissedTopics:['pets']};
  expect(recommendationQueries(prefs)).toContain('ゲーム');expect(recommendationQueries(prefs)).not.toContain('猫');
 });
 it('promotes both external providers for a followed topic and excludes unrelated dismissed interests',()=>{
  const prefs:RecommendationPreferences={authors:{},terms:{},followedTopics:['pets'],dismissedTopics:['sports']};
  const ranked=rankRecommendations([post('sports','サッカーの試合','bluesky'),post('blue-cat','猫の写真','bluesky'),post('misskey-cat','犬の写真','misskey')],prefs,null);
  expect(ranked.slice(0,2).map(p=>p.id)).toEqual(expect.arrayContaining(['blue-cat','misskey-cat']));
  expect(ranked.map(post=>post.id)).not.toContain('sports');expect(topicAffinity('サッカー速報',{dismissed:['sports']})).toBeLessThan(0);
 });
 it('personalizes explore trends but preserves the source volume and rank metadata',()=>{
  const rows=[{title:'選挙',traffic:'100万',rank:1},{title:'猫の写真',traffic:'100',rank:2}];
  const ranked=rankPersonalTrends(rows,{authors:{},terms:{},followedTopics:['pets']});
  expect(ranked[0]).toEqual(rows[1]);expect(rows[0].rank).toBe(1);
 });
});
});

describe("recommendationModel", () => {
const model:RankModel={version:1,featureNames:FEATURE_NAMES,trainedAt:new Date().toISOString(),metrics:{baselineNdcg:.4,modelNdcg:.5,validationGroups:6},trees:[{split_feature:0,threshold:.5,default_left:true,decision_type:'<=',left_child:{leaf_value:-.1},right_child:{leaf_value:.2}},{leaf_value:.1}]};
it('scores numeric LightGBM trees including missing/default directions and sums baked-in leaf weights',()=>{
 const row=Array(15).fill(0);expect(predictRank(model,row)).toBeCloseTo(0);row[0]=1;expect(predictRank(model,row)).toBeCloseTo(.3);row[0]=NaN;expect(predictRank(model,row)).toBeCloseTo(0);
});
it('rejects incompatible features, unsafe trees, and unvalidated models',()=>{
 expect(validRankModel(model)).toBe(true);expect(validFeatures(Array(15).fill(0))).toBe(true);expect(validFeatures([NaN])).toBe(false);
 expect(validRankModel({...model,featureNames:['wrong']})).toBe(false);
 expect(validRankModel({...model,trees:[{leaf_value:Infinity}]})).toBe(false);
 expect(validRankModel({...model,metrics:{...model.metrics,modelNdcg:.3}})).toBe(false);
 expect(validRankModel({...model,trees:[{...model.trees[0],decision_type:'=='}]})).toBe(false);
});
});
