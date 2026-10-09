import {beforeEach,expect,it} from 'vitest';
import fixtures from './fixtures/recommendationVisual.json';
import {classifyRecommendationVisual} from './recommendationVisualInference';
import {visualSimilarity,createVisualSimilarityComparator} from './recommendationVisual';
import {recommendationIsEligible} from './recommendationEligibility';
import {addRecommendationInterest,rankRecommendations,recordRecommendationLike,readRecommendationLikes,type RecommendationPreferences} from './recommendations';
import {topicAuthorCandidates} from './recommendationSignals';
import type {PostWithAuthor} from '@/types';
import type {TopicId} from './topics';
// Embeddings measured from real pixels: public original artwork, a male
// character sketch, the Luanti project's game screenshot, and the official
// Transformers.js cats/football images. No caption/alt/tag is encoded here.
const visual=(name:string)=>classifyRecommendationVisual(fixtures.find(row=>row.name===name)!.vector);
const post=(id:string,name:string,extra:Partial<PostWithAuthor>={}):PostWithAuthor=>({id,userId:id,content:'',imageUrls:[`https://images.example/${id}.jpg`],createdAt:new Date().toISOString(),source:'bluesky',languages:['ja'],likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:id},recommendationVisual:visual(name),...extra} as PostWithAuthor);
beforeEach(()=>localStorage.clear());
it.each([['original-moe','moe'],['game-screen','game-screen'],['pets','pets'],['sports','sports']])('classifies measured %s pixels as %s without post text',(name,kind)=>expect(visual(name).kind).toBe(kind));
it('does not certify male characters, screenshots or unknown images as moe artwork merely because of a feed label',()=>{
 const expected=post('original','original-moe',{recommendationTopics:['digital-illustration']});
 expect(recommendationIsEligible(expected,['digital-illustration'])).toBe(true);
 for(const kind of ['male-character','game-screen','pets'])expect(recommendationIsEligible(post(kind,kind,{content:'ファンアート オリキャラ イラスト',recommendationTopics:['digital-illustration']}),['digital-illustration'])).toBe(false);
 expect(recommendationIsEligible({...expected,recommendationVisual:undefined,recommendationVisualStatus:'unavailable'},['digital-illustration'])).toBe(false);
});
it.each([['pets','pets'],['sports','sports'],['games','game-screen']] as const)('%s ranks genuine image context above a keyword-stuffed post retrieved from the same feed',(topic,name)=>{
 const genuine=post('genuine',name,{recommendationTopics:[topic]});
 const misleading=post('misleading','original-moe',{content:'ペット 猫 スポーツ サッカー ゲーム',recommendationTopics:[topic],likesCount:999999});
 expect(rankRecommendations([misleading,genuine],{authors:{},terms:{猫:99999,サッカー:99999,ゲーム:99999},followedTopics:[topic]},'viewer')[0].id).toBe('genuine');
});
it('keeps a mistaken finance source label from admitting English pet pictures',()=>expect(recommendationIsEligible(post('cat','pets',{languages:['en'],recommendationTopics:['economy']}),['economy'])).toBe(false));
it('learns visual interests from an image-only like and keeps them scoped to the viewer',()=>{
 const liked=post('liked','original-moe');recordRecommendationLike(liked,true,'alice');const prefs:RecommendationPreferences={authors:{},terms:{}};
 for(const sample of readRecommendationLikes('alice'))addRecommendationInterest(prefs,sample,2);
 expect(prefs.visualInterests).toHaveLength(1);expect(readRecommendationLikes('bob')).toEqual([]);
 expect(visualSimilarity(prefs.visualInterests![0],visual('original-moe').vector)).toBeCloseTo(1);
});
it('does not expand a creator from two keyword-only matches or an ambiguous image',()=>{
 const make=(id:string)=>({...post(id,'original-moe'),userId:'did:plc:creator',recommendationVisual:undefined,content:'料理 レシピ'});
 expect(topicAuthorCandidates([make('one'),make('two')],['food'])).toEqual([]);
 const unknown={...visual('original-moe'),kind:'unknown',topics:[] as TopicId[]};
 expect(topicAuthorCandidates([{...make('one'),recommendationVisual:unknown,recommendationTopics:['food']},{...make('two'),recommendationVisual:unknown,recommendationTopics:['food']}],['food'])).toEqual([]);
});
it('spreads the first page across independent sources even when a large source has more popular posts',()=>{
 const dominant=Array.from({length:30},(_,i)=>post(`dominant-${i}`,'pets',{recommendationSources:['dominant'],likesCount:100000}));
 const alternatives=Array.from({length:6},(_,i)=>post(`alternative-${i}`,'pets',{recommendationSources:[`source-${i}`]}));
 const page=rankRecommendations([...dominant,...alternatives],{authors:{},terms:{},followedTopics:['pets']},'viewer').slice(0,20);
 expect(page.filter(row=>row.id.startsWith('alternative-')).length).toBeGreaterThanOrEqual(4);
});
it('learns image preferences for any topic without using a caption or character gender label',()=>{
 const liked=post('liked','original-moe');const prefs:RecommendationPreferences={authors:{},terms:{},followedTopics:['art']};addRecommendationInterest(prefs,liked,2);
 const preferred=post('preferred','original-moe',{recommendationVisual:{...visual('original-moe'),kind:'illustration',topics:['art'],confidence:.8},recommendationSources:['one']});
 const different=post('different','male-character',{recommendationVisual:{...visual('male-character'),kind:'illustration',topics:['art'],confidence:.8},likesCount:999999,recommendationSources:['two']});
 expect(rankRecommendations([different,preferred],prefs,'viewer')[0].id).toBe('preferred');
 const opposite:RecommendationPreferences={authors:{},terms:{},followedTopics:['art'],visualInterests:[visual('male-character').vector]};
 expect(rankRecommendations([preferred,different],opposite,'viewer')[0].id).toBe('different');
});
it('retains a liked image URL and full sample when an ID-only state synchronization follows',()=>{
 const original=post('liked','original-moe');recordRecommendationLike(original,true,'viewer');
 recordRecommendationLike({id:'liked',content:''} as PostWithAuthor,true,'viewer');
 const [sample]=readRecommendationLikes('viewer');expect(sample.imageUrls).toEqual(original.imageUrls);expect(sample.userId).toBe(original.userId);expect(sample.recommendationVisual?.vector).toEqual(original.recommendationVisual?.vector);
});

 it('reuses vector comparisons within a pass and creates fresh comparisons for changed evidence',()=>{
 const a=Array.from({length:512},(_,i)=>Math.sin(i)),b=Array.from({length:512},(_,i)=>Math.cos(i));
 const compare=createVisualSimilarityComparator();
 expect(compare(a,b)).toBeCloseTo(visualSimilarity(a,b),12);expect(compare(b,a)).toBeCloseTo(visualSimilarity(b,a),12);
 b.fill(0);b[0]=1;
 expect(createVisualSimilarityComparator()(a,b)).toBeCloseTo(visualSimilarity(a,b),12);
 expect(compare(a,Array(512).fill(NaN))).toBe(0);expect(compare(a,[])).toBe(0);
 });
