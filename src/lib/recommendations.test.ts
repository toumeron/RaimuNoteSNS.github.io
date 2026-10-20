import { recommendationFingerprint, preserveRecommendationHistory, uniqueRecommendationPosts, readRecommendationReserve, saveRecommendationReserve, clearRecommendationReserve, recommendationTopicSignals, recommendationTopicAffinity, topicAuthorCandidates, recommendationIsEligible, rankTopicPosts, topicPostRelevance } from "@/lib/recommendations";
import { beforeEach, expect, it, afterEach, vi, describe } from "vitest";
import { addRecommendationInterest, rankRecommendations, recommendationTerms, recordRecommendationLike, readRecommendationLikes, recordRecommendationImpression, readRecommendationImpressions, scoreRecommendation, type RecommendationPreferences, recommendationQueries } from "@/lib/recommendations";
import { type PostWithAuthor } from "@/types/index";
import { createRecommendationCursor } from "@/api/recommendations";
import visuals from "@/lib/fixtures/recommendationVisual.json";
import document from "@/lib/fixtures/recommendationDocument.json";
import { classifyRecommendationVisual, visualSimilarity, createVisualSimilarityComparator } from "@/lib/recommendationVisual";
import { TOPICS, type TopicId, matchingTopics, topicAffinity, rankPersonalTrends } from "@/lib/topics";
import { FEATURE_NAMES, predictRank, validFeatures, validRankModel, type RankModel } from "./../../supabase/functions/_shared/recommendationModel.ts";
import { classifyRecommendationVisual as recommendationVisualTestClassifyRecommendationVisual, createRecommendationVisualQueue } from "@/lib/recommendationVisualInference";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

describe("recommendations", () => {
describe("recommendations", () => {
const post=(id:string,content:string,userId='author'):PostWithAuthor=>({id,content,userId,createdAt:'2026-10-03T00:00:00Z',likesCount:1,commentsCount:0,repostsCount:0,repostedByMe:false,likedByMe:false,imageUrls:[],author:{id:userId,username:userId} as any});
beforeEach(()=>localStorage.clear());
it('prioritizes subjects learned from engagement over unrelated popular posts',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫の写真とイラスト'),2);
  const ranked=rankRecommendations([{...post('sports','サッカー速報'),likesCount:50000},post('cats','猫の写真')],preferences,'viewer');
  expect(ranked[0].id).toBe('cats');
});
it('responds to different user preferences and followed authors',()=>{
  const posts=[post('cats','猫の写真','cats-author'),post('sports','サッカー速報','sports-author')];
  expect(rankRecommendations(posts,{authors:{'sports-author':3},terms:{}},'viewer')[0].id).toBe('sports');
  expect(rankRecommendations(posts,{authors:{},terms:{写真:3}},'viewer')[0].id).toBe('cats');
});
it('deduplicates posts and avoids runs of one service or author when alternatives exist',()=>{
  const posts=[post('l1','猫'),post('l2','猫'),post('l3','猫'),post('bsky:1','猫','b1'),post('bsky:2','猫','b2'),post('bsky:3','猫','b3')];
  const ranked=rankRecommendations([...posts,posts[0]],{authors:{author:5},terms:{}},'viewer');
  expect(ranked).toHaveLength(6);
  expect(ranked.slice(0,3).some(p=>p.id.startsWith('bsky:'))).toBe(true);
});
it('uses meaningful Japanese terms without treating shared URL domains as interests',()=>{
  expect(recommendationTerms('猫の写真 https://example.com/sports です')).toContain('写真');
  expect(recommendationTerms('猫の写真 https://example.com/sports です')).not.toContain('sports');
});
it('isolates local Bluesky likes by viewer and removes unliked signals',()=>{
  recordRecommendationLike(post('bsky:cat','猫の写真'),true,'alice');
  expect(readRecommendationLikes('alice')).toHaveLength(1);
  expect(readRecommendationLikes('bob')).toEqual([]);
  recordRecommendationLike(post('bsky:cat','猫の写真'),false,'alice');
  expect(readRecommendationLikes('alice')).toEqual([]);
});

it('weights recent behavior separately from old interests and adapts to a new subject',()=>{
  const now=Date.parse('2026-10-03T00:00:00Z');
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('old','サッカー速報','sports'),10,'2026-07-01T00:00:00Z',now);
  addRecommendationInterest(preferences,post('new','猫の写真','cats'),2,'2026-10-02T00:00:00Z',now);
  expect(rankRecommendations([post('sports','サッカー速報','other-sport'),post('cats','猫の写真','other-cat')],preferences,'viewer',now)[0].id).toBe('cats');
});
it('recognizes a small set of equivalent topic expressions across Japanese and English',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫'),2);
  expect(rankRecommendations([post('cats','cute kitten'),post('sport','soccer')],preferences,'viewer')[0].id).toBe('cats');
});
it('does not boost a post just for repeating preferred words or adding many hashtags',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫'),2);
  expect(rankRecommendations([post('stuffed','猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫'),post('natural','猫')],preferences,'viewer')[0].id).toBe('natural');
});
it('allows an excellent relevant post even when it comes from the same service twice',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫'),2);
  const ranked=rankRecommendations([post('c1','猫','a'),post('c2','猫','b'),post('c3','猫','c'),post('bsky:sport','サッカー速報','sport')],preferences,'viewer');
  expect(ranked.slice(0,3).map(p=>p.id)).toEqual(['c1','c2','c3']);
});
it('suppresses exact repeated text but retains different media with the same caption',()=>{
  const content='同じ内容の長い文章です。この本文は同じ投稿が何回も表示されないかのテストです。';
  const ranked=rankRecommendations([post('one',content),post('duplicate',content),{...post('photo',content),imageUrls:['different.png']}],{authors:{},terms:{}},'viewer');
  expect(ranked).toHaveLength(2);
});
it('balances authors across page boundaries',()=>{
  const preferences={authors:{author:3},terms:{}};
  const history=[post('h1','猫'),post('h2','猫')];
  expect(rankRecommendations([post('same','猫'),post('new','猫','new-author')],preferences,'viewer',Date.now(),history)[0].id).toBe('new');
});

it('reduces recently seen posts, with a penalty that fades over time and stays viewer-specific',()=>{
  const now=Date.parse('2026-10-03T00:00:00Z');
  recordRecommendationImpression('seen','viewer',now);
  const preferences={authors:{},terms:{}};
  expect(rankRecommendations([post('seen','猫'),post('new','猫')],preferences,'viewer',now)[0].id).toBe('new');
  expect(readRecommendationImpressions('other',now)).toEqual({});
  const recent=scoreRecommendation(post('seen','猫'),preferences,'viewer',{now,impressions:readRecommendationImpressions('viewer',now)});
  const later=scoreRecommendation(post('seen','猫'),preferences,'viewer',{now:now+6*86400000,impressions:readRecommendationImpressions('viewer',now+6*86400000)});
  expect(later.seenPenalty).toBeLessThan(recent.seenPenalty);
});
it('returns inspectable component scores without NaN from incomplete stats',()=>{
  const score=scoreRecommendation({...post('one','猫'),createdAt:'invalid',likesCount:undefined as any},{authors:{},terms:{}},'viewer');
  expect(Number.isFinite(score.total)).toBe(true);
  expect(score).toHaveProperty('recentInterest');expect(score).toHaveProperty('seenPenalty');
});

it('excludes an actually viewed post on future fetches across visits',()=>{
  const now=Date.now();const candidate=post('repeat','猫の写真');const preferences={authors:{},terms:{猫:2}};
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(0);
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(0);
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(0);
  expect(rankRecommendations([candidate],preferences,'other-viewer',now)).toHaveLength(1);
});
it('excludes liked candidates from server flags, stored preference IDs, and new successful likes',()=>{
  const candidates=[{...post('flagged','猫'),likedByMe:true},post('saved','猫'),post('bsky:new','猫'),post('fresh','猫')];
  const preferences={authors:{},terms:{猫:5},likedPostIds:['saved']};
  recordRecommendationLike(candidates[2],true,'viewer');
  expect(rankRecommendations(candidates,preferences,'viewer').map(p=>p.id)).toEqual(['fresh']);
  recordRecommendationLike(candidates[2],false,'viewer');
  expect(rankRecommendations(candidates,preferences,'viewer').map(p=>p.id)).toContain('bsky:new');
});

it('remembers liked IDs beyond the 100-post interest sample and permits confirmed unlikes',()=>{
  recordRecommendationLike(post('bsky:older-like','猫'),true,'viewer');
  for(let i=0;i<101;i++) recordRecommendationLike(post(`bsky:new-${i}`,'猫'),true,'viewer');
  expect(readRecommendationLikes('viewer').some(p=>p.id==='bsky:older-like')).toBe(false);
  expect(rankRecommendations([post('bsky:older-like','猫')],{authors:{},terms:{}},'viewer')).toHaveLength(0);
  recordRecommendationLike(post('bsky:older-like','猫'),false,'viewer');
  expect(rankRecommendations([post('bsky:older-like','猫')],{authors:{},terms:{}},'viewer')).toHaveLength(1);
});
it('remembers the same media across copied IDs and CDN resize variants on later reloads',async()=>{
 const {recommendationFingerprint}=await import("@/lib/recommendations");
 const original={...post('original',''),imageUrls:['https://cdn.example/work.png?width=800']};
 recordRecommendationImpression(original.id,'viewer',Date.now(),recommendationFingerprint(original));
 const copied={...original,id:'copied',content:'キャプションを変えた再投稿',imageUrls:['https://cdn.example/work.png?width=400']};
 expect(rankRecommendations([copied],{authors:{},terms:{}},'viewer')).toHaveLength(0);
 expect(rankRecommendations([copied],{authors:{},terms:{}},'another-viewer')).toHaveLength(1);
});
it('merges canonical Bluesky URIs and excludes duplicate works across page history',()=>{
 const work={...post('alias',''),blueskyUri:'at://did:plc:artist/app.bsky.feed.post/work',imageUrls:['https://cdn.example/work.png']};
 expect(rankRecommendations([work,{...work,id:'bsky:at://did:plc:artist/app.bsky.feed.post/work'}],{authors:{},terms:{}},null)).toHaveLength(1);
 expect(rankRecommendations([{...work,id:'copy'}],{authors:{},terms:{}},null,Date.now(),[work])).toHaveLength(0);
});
it('uses the viewer’s own creator history across subjects rather than treating all topic posts as interchangeable',()=>{
 const prefs={authors:{favorite:20},recentAuthors:{favorite:20},terms:{},followedTopics:['music'] as any};
 const favorite={...post('favorite-work','','favorite'),recommendationTopics:['music']};
 const generic={...post('generic','','generic'),recommendationTopics:['music'],likesCount:100000};
 expect(rankRecommendations([generic,favorite],prefs,'viewer')[0].id).toBe('favorite-work');
});
it('recognizes the same Bluesky media blob shared by different creators and formats',async()=>{
 const {recommendationFingerprint}=await import("@/lib/recommendations");
 const a={...post('one',''),imageUrls:['https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:one/bafkreiexampleimage@jpeg']};
 const b={...post('two',''),imageUrls:['https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:two/bafkreiexampleimage@webp']};
 expect(recommendationFingerprint(a)).toBe(recommendationFingerprint(b));
 expect(rankRecommendations([a,b],{authors:{},terms:{}},'viewer')).toHaveLength(1);
});

it('removes the exact dismissed work, including resized copies, without banning its topic',()=>{
 const dismissed={...post('bsky:original','','artist'),imageUrls:['https://example.com/work.jpg?w=300'],recommendationTopics:['pets'] as any,languages:['ja']};
 const copy={...dismissed,id:'bsky:copy',imageUrls:['https://example.com/work.jpg?w=900']};
 const alternative={...post('bsky:other','','other'),imageUrls:['https://example.com/other.jpg'],recommendationTopics:['pets'] as any,languages:['ja']};
 const preferences={authors:{},terms:{},feedback:[{id:dismissed.id,userId:dismissed.userId,fingerprint:recommendationFingerprint(dismissed),createdAt:new Date().toISOString()}]};
 expect(rankRecommendations([dismissed,copy,alternative],preferences,'viewer').map(row=>row.id)).toEqual(['bsky:other']);
});
it('lowers similar image-only work from negative feedback across topics',()=>{
 const candidate={...post('bsky:new','','other'),imageUrls:['https://example.com/new.jpg'],recommendationVisual:{vector:Array.from({length:512},(_,i)=>i===0?1:0),topics:['pets'],confidence:1}} as any;
 const base={authors:{},terms:{}};
 expect(scoreRecommendation(candidate,{...base,feedback:[{id:'old',userId:'different',vector:Array.from({length:512},(_,i)=>i===0?1:0),createdAt:new Date().toISOString()}]},'viewer').total).toBeLessThan(scoreRecommendation(candidate,base,'viewer').total);
});

it.each(['music','science','digital-illustration'])('mixes a few related creators into a strongly preferred %s author without caption keywords',topic=>{
 const make=(id:string,author:string)=>({...post(id,'',author),imageUrls:[`https://example.com/${id}.jpg`],languages:['ja'],recommendationTopics:[topic],recommendationSources:[`feed:${topic}`],recommendationVisual:{version:1,kind:topic==='digital-illustration'?'moe':topic,topics:[topic],confidence:1,similarity:1,vector:Array.from({length:512},(_,i)=>i===0?1:0)}}) as any;
 const familiar=Array.from({length:30},(_,i)=>make(`favorite-${i}`,'favorite'));
 const neighbours=Array.from({length:6},(_,i)=>make(`related-${i}`,`new-${i}`));
 const prefs={authors:{favorite:100},recentAuthors:{favorite:100},terms:{},followedTopics:[topic] as any,likedSamples:[make('liked-reference','favorite')]};
 const ranked=rankRecommendations([...familiar,...neighbours],prefs,'viewer').slice(0,20);
 expect(ranked).toHaveLength(20);expect(ranked[0].userId).toBe('favorite');
 for(const index of [5,11,17])expect(ranked[index].userId).not.toBe('favorite');
 expect(ranked.filter(row=>row.userId==='favorite').length).toBeGreaterThan(10);
 expect(new Set(ranked.filter(row=>row.userId!=='favorite').map(row=>row.userId)).size).toBeGreaterThanOrEqual(3);
});
it('does not force unrelated or dismissed creators into discovery positions',()=>{
 const make=(id:string,author:string,topic='music')=>({...post(id,'',author),languages:['ja'],recommendationTopics:[topic],imageUrls:[`https://example.com/${id}.jpg`]}) as any;
 const favourite=Array.from({length:25},(_,i)=>make(`known-${i}`,'favorite'));
 const prefs={authors:{favorite:100},terms:{},followedTopics:['music'] as any,feedback:[{id:'old',userId:'dismissed',createdAt:new Date().toISOString()}]};
 const ranked=rankRecommendations([...favourite,make('unrelated','new','sports'),make('negative','dismissed')],prefs,'viewer').slice(0,20);
 expect(ranked.every(row=>row.userId==='favorite')).toBe(true);
});
it('keeps related-author choices diverse across page boundaries',()=>{
 const make=(id:string,author:string)=>({...post(id,'',author),languages:['ja'],recommendationTopics:['science'],imageUrls:[`https://example.com/${id}.jpg`],recommendationVisual:{version:1,kind:'science',topics:['science'],confidence:1,similarity:1,vector:Array.from({length:512},(_,i)=>i===0?1:0)}}) as any;
 const prefs={authors:{favorite:100},terms:{},followedTopics:['science'] as any,likedSamples:[make('liked-reference','favorite')]};
 const history=Array.from({length:20},(_,i)=>make(`previous-${i}`,i===5?'already-related':'favorite'));
 const rows=[...Array.from({length:25},(_,i)=>make(`next-${i}`,'favorite')),make('old-related','already-related'),...Array.from({length:4},(_,i)=>make(`new-related-${i}`,`new-${i}`))];
 const ranked=rankRecommendations(rows,prefs,'viewer',Date.now(),history).slice(0,20);
 expect(ranked[5].userId).not.toBe('already-related');expect(ranked[5].userId).not.toBe('favorite');
});

it('does not use a shared broad feed or topic alone to force unclassified images into related slots',()=>{
 const make=(id:string,author:string)=>({...post(id,'',author),languages:['ja'],imageUrls:[`https://example.com/${id}.jpg`],recommendationTopics:['art'],recommendationSources:['broad-art-feed']}) as any;
 const liked=make('liked','favorite'),prefs={authors:{favorite:100},terms:{},followedTopics:['art'] as any,likedSamples:[liked]};
 const rows=[...Array.from({length:25},(_,i)=>make(`known-${i}`,'favorite')),...Array.from({length:5},(_,i)=>make(`unknown-${i}`,`new-${i}`))];
 expect(rankRecommendations(rows,prefs,'viewer').slice(0,20).every(row=>row.userId==='favorite')).toBe(true);
});
it.each(['music','science','art'])('uses negative image evidence to reject similar %s works even from a new author',topic=>{
 const vector=Array.from({length:512},(_,i)=>i===0?1:0);
 const row={...post('new-work','','new-author'),languages:['ja'],imageUrls:['https://example.com/next.jpg'],recommendationVisual:{version:1,kind:topic,topics:[topic],confidence:1,similarity:1,vector}} as any;
 const prefs={authors:{'new-author':100},terms:{},followedTopics:[topic] as any,feedback:[{id:'dismissed-work',userId:'old-author',vector,createdAt:new Date().toISOString()}]};
 expect(rankRecommendations([row],prefs,'viewer')).toEqual([]);
});
it('excludes repeatedly dismissed authors while allowing a later explicit like to supersede older dismissals',()=>{
 const now=Date.now(),row={...post('next','猫','author'),languages:['ja']};
 const feedback=[{id:'bad-1',userId:'author',createdAt:new Date(now-2000).toISOString()},{id:'bad-2',userId:'author',createdAt:new Date(now-1000).toISOString()}];
 const prefs={authors:{author:100},terms:{},feedback};
 expect(rankRecommendations([row],prefs,'viewer',now)).toEqual([]);
 expect(rankRecommendations([row],{...prefs,likedSamples:[{...post('liked','猫','author'),engagedAt:new Date(now).toISOString()}]},'viewer',now)).toHaveLength(1);
});

it('retains repeated negative author feedback until a newer explicit like rather than expiring it',()=>{
 const now=Date.now(),row={...post('new','猫','old-disliked-author'),languages:['ja']};
 const feedback=['one','two'].map((id,i)=>({id,userId:row.userId,createdAt:new Date(now-(180+i)*86400000).toISOString()}));
 expect(rankRecommendations([row],{authors:{[row.userId]:100},terms:{},feedback},'viewer',now)).toEqual([]);
});

it('reserves delivered IDs and image copies briefly in this document, per viewer',async()=>{
 const {recordRecommendationDelivery}=await import('./recommendations');
 const work={...post('delivered','', 'liked-author'),imageUrls:['https://cdn.example/art.png']};
 const prefs={authors:{'liked-author':4},terms:{}};
 const now=Date.now();recordRecommendationDelivery([work],'delivery-viewer',now);
 expect(rankRecommendations([work,{...work,id:'other-copy'}],prefs,'delivery-viewer')).toEqual([]);
 expect(rankRecommendations([work],prefs,'different-viewer')).toHaveLength(1);
 expect(rankRecommendations([work],prefs,'delivery-viewer',now+120001)).toHaveLength(1);
});
it('does not treat legacy persisted delivery records as actual views',()=>{
 const work={...post('unseen','猫','favorite'),imageUrls:['https://cdn.example/unseen.png']};
 const viewer='legacy-delivery-viewer',prefs={authors:{favorite:4},terms:{}};
 localStorage.setItem(`lime_recommendation_deliveries:${viewer}`,JSON.stringify({[work.id]:{at:Date.now(),userId:work.userId,fingerprint:recommendationFingerprint(work)}}));
 expect(rankRecommendations([work],prefs,viewer)).toHaveLength(1);
 recordRecommendationImpression(work.id,viewer,Date.now(),recommendationFingerprint(work));
 expect(rankRecommendations([work],prefs,viewer)).toEqual([]);
});
it('prefers a different related creator without ending a page when only the favorite remains',async()=>{
 const {selectRecommendationPage}=await import('./recommendations');
 const works=Array.from({length:12},(_,i)=>post(`favorite-${i}`,'science','favorite'));
 const other=post('other','science','other');
 const prefs={authors:{favorite:8,other:4},terms:{}};
 const selected=selectRecommendationPage([...works,other],prefs,works.slice(0,3));
 expect(selected.posts[0].userId).toBe('other');expect(selected.posts).toHaveLength(13);
 expect(selected.blocked).toBe(false);expect(selected.remaining).toHaveLength(0);
});
it('visual enrichment preserves the original like date instead of overriding a later dismissal',()=>{
 const old=post('old-like','','artist');
 recordRecommendationLike(old,true,'viewer','2026-05-01T00:00:00Z');
 const enriched={...old,recommendationVisual:{version:1 as const,kind:'science',topics:['science'] as any,confidence:.8,similarity:.3,vector:Array(512).fill(.01)}};
 recordRecommendationLike(enriched,true,'viewer','2026-05-01T00:00:00Z');
 expect(readRecommendationLikes('viewer')[0].engagedAt).toBe('2026-05-01T00:00:00Z');
 const prefs={authors:{artist:30},terms:{},likedSamples:readRecommendationLikes('viewer'),feedback:[1,2].map(i=>({id:`negative-${i}`,userId:'artist',createdAt:'2026-10-09T00:00:00Z'}))};
 expect(rankRecommendations([post('new-work','','artist')],prefs,'viewer')).toEqual([]);
});
it.each(['science','music','pets','digital-illustration'] as const)('uses repeated negative image neighbors for %s rather than caption words',async topic=>{
 const {recommendationIsDismissed}=await import('./recommendations');
 const vec=(a:number,b:number)=>[a,b,...Array(510).fill(0)];
 const visual={version:1 as const,kind:topic,topics:[topic],confidence:.9,similarity:.3,vector:vec(1,0)};
 const candidate={...post('candidate','', 'new-creator'),imageUrls:['https://example.com/candidate.jpg'],recommendationVisual:visual};
 const feedback=[1,2,3].map(i=>({id:`negative-${i}`,userId:`unwanted-${i}`,vector:vec(.75,Math.sqrt(1-.75**2)),createdAt:'2026-10-01T00:00:00Z'}));
 expect(recommendationIsDismissed(candidate,{authors:{},terms:{},feedback,visualInterests:[vec(0,1)]})).toBe(true);
 expect(recommendationIsDismissed(candidate,{authors:{},terms:{},feedback:feedback.slice(0,1),visualInterests:[vec(0,1)]})).toBe(false);
 expect(recommendationIsDismissed(candidate,{authors:{},terms:{},feedback,visualInterests:[vec(.9,Math.sqrt(1-.9**2))]})).toBe(false);
});

it('does not fill followed topic recommendations with unrelated Japanese discovery',()=>{
 const candidates=[post('unrelated','今日は良い天気ですね','stranger'),post('related','猫の写真','pet-author'),{...post('media','', 'known-creator'),imageUrls:['art.jpg']}];
 const ranked=rankRecommendations(candidates,{authors:{'known-creator':3},terms:{},followedTopics:['pets']},'viewer');
 expect(ranked.map(row=>row.id)).toEqual(['related']);
 expect(ranked.map(row=>row.id)).not.toContain('unrelated');
});
it('keeps keyword-free posts with followed source context across topics',()=>{
 for(const topic of ['science','sports','food','music','art'] as const){
  const media={...post('media',''),imageUrls:['media.jpg'],recommendationTopics:[topic]};
  expect(rankRecommendations([media],{authors:{},terms:{},followedTopics:[topic]},'viewer')).toHaveLength(1);
 }
});

it('rejects an author immediately even when older likes have high weights',()=>{
 const candidate=post('different-work','', 'rejected');
 expect(rankRecommendations([candidate],{authors:{rejected:1000},terms:{},feedback:[{id:'rejected-work',userId:'rejected',createdAt:new Date().toISOString()}]},'viewer')).toEqual([]);
});
it.each(['digital-illustration','food','sports','music'] as const)('individual %s dismissals do not ban fresh image creators across the followed topic',topic=>{
 const now=new Date().toISOString();
 const vector=Array(512).fill(0);vector[0]=1;
 const visual={version:1 as const,kind:'moe',topics:[topic],confidence:.9,similarity:.5,vector};
 const unknown={...post('unknown',topic==='digital-illustration'?'キャラクターイラスト':'', 'stranger'),imageUrls:['unknown.jpg'],recommendationTopics:[topic],languages:['ja'],recommendationVisual:visual};
 const familiar={...unknown,id:'familiar',userId:'liked-creator',imageUrls:['familiar.jpg']};
 const preferences={authors:{'liked-creator':5},terms:{},followedTopics:[topic],likedSamples:[{...unknown,id:'reference',userId:'reference-artist',imageUrls:['reference.jpg']}],feedback:[1,2,3].map(i=>({id:`negative-${i}`,userId:`bad-${i}`,topics:[topic],createdAt:now}))};
 expect(rankRecommendations([unknown,familiar],preferences,'viewer').map(row=>row.id)).toEqual(expect.arrayContaining(['familiar','unknown']));
});

it('retains older distinct authors as references instead of only the latest prolific author',async()=>{
 const {selectRecommendationLikeSamples}=await import('./recommendations');
 const recent=Array.from({length:200},(_,i)=>({...post(`recent-${i}`,'','prolific'),imageUrls:['https://images.example/recent.jpg'],engagedAt:new Date(Date.now()-i*1000).toISOString()}));
 const older=Array.from({length:80},(_,i)=>({...post(`older-${i}`,'',`artist-${i}`),imageUrls:['https://images.example/older.jpg'],engagedAt:new Date(Date.now()-86400000-i*1000).toISOString()}));
 const samples=selectRecommendationLikeSamples([...recent,...older]);
 expect(samples).toHaveLength(128);expect(new Set(samples.map(row=>row.userId)).size).toBe(81);
 expect(samples.some(row=>row.id==='older-79')).toBe(true);
});


it('learns creator topics from a liked keyword-free image and preserves them in compact history',async()=>{
 const {selectRecommendationLikeSamples}=await import('./recommendations');
 const liked={...post('liked-image','','did:plc:favorite'),imageUrls:['https://images.example/liked.jpg'],languages:['ja'],recommendationAuthorTopics:['digital-illustration'],recommendationSources:['creator:did:plc:favorite'],recommendationVisual:{version:1 as const,kind:'moe',topics:['digital-illustration'] as any,confidence:.9,similarity:.5,vector:Array.from({length:512},(_,i)=>i===0?1:0)}};
 const preferences:import('./recommendations').RecommendationPreferences={authors:{},terms:{},followedTopics:['digital-illustration']};
 const samples=selectRecommendationLikeSamples([liked]);
 expect(samples[0].recommendationAuthorTopics).toEqual(['digital-illustration']);
 expect(samples[0].recommendationSources).toEqual(liked.recommendationSources);
 addRecommendationInterest(preferences,samples[0],4);
 expect(preferences.authorTopics?.[liked.userId]?.['digital-illustration']).toBe(4);
 const candidate={...liked,id:'new-image',imageUrls:['https://images.example/new.jpg'],recommendationAuthorTopics:undefined,recommendationSources:undefined};
 expect(rankRecommendations([candidate],preferences,'viewer').map(row=>row.id)).toEqual(['new-image']);
});
it('does not replace confident visual evidence with a liked creators broader topic hint',()=>{
 const preferences:import('./recommendations').RecommendationPreferences={authors:{},terms:{}};
 addRecommendationInterest(preferences,{userId:'artist',recommendationAuthorTopics:['digital-illustration'],recommendationVisual:{version:1,kind:'food',topics:['food'],confidence:.9,similarity:.5,vector:Array(512).fill(0)}},4);
 expect(preferences.authorTopics?.artist.food).toBe(4);
 expect(preferences.authorTopics?.artist['digital-illustration']).toBeUndefined();
});

 it('bounds scoring work with a large preference profile on successive small pages',()=>{
 const vector=(seed:number)=>Array.from({length:512},(_,i)=>i===seed%512?1:0);
 const make=(id:string,i:number)=>({...post(id,`猫の写真 ${i}`,`author-${i}`),languages:['ja'],imageUrls:[`https://example.com/${id}.jpg`],recommendationVisual:{version:1,kind:'pets',topics:['pets'],confidence:.9,similarity:1,vector:vector(i)}}) as any;
 const samples=Array.from({length:128},(_,i)=>make(`liked-${i}`,i));
 const prefs={authors:{},terms:Object.fromEntries(Array.from({length:10000},(_,i)=>[`word${i}`,i+1])),likedSamples:samples,visualInterests:samples.map(post=>post.recommendationVisual.vector),feedback:Array.from({length:200},(_,i)=>({id:`bad-${i}`,userId:`bad-author-${i}`,createdAt:new Date().toISOString(),vector:vector(i+256)}))};
 for(let page=0;page<6;page++){
  const started=performance.now();const ranked=rankRecommendations(Array.from({length:32},(_,i)=>make(`page-${page}-${i}`,i)),prefs,'viewer',Date.now(),[],40);expect(ranked).toHaveLength(32);
  console.log(`scoring small page ${page+1}: ${Math.round(performance.now()-started)} ms`);
  expect(performance.now()-started).toBeLessThan(1000);
 }
 });

it('can reuse unviewed reserved candidates on a fresh first screen while keeping actual views excluded',async()=>{
 const {recordRecommendationDelivery,recordRecommendationImpression}=await import('./recommendations');
 const work={...post('reserved-first-screen','猫','favorite'),imageUrls:['https://cdn.example/reserved.png']};
 const viewer='first-screen-regression',prefs={authors:{favorite:4},terms:{猫:2}};
 recordRecommendationDelivery([work],viewer);
 expect(rankRecommendations([work],prefs,viewer)).toEqual([]);
 expect(rankRecommendations([work],prefs,viewer,Date.now(),[],40,true)).toHaveLength(1);
 recordRecommendationImpression(work.id,viewer);
 expect(rankRecommendations([work],prefs,viewer,Date.now(),[],40,true)).toEqual([]);
});

it('does not recommend real pet posts to anime followers just because the artist was liked or has an anime bio',()=>{
 const pet={...post('pet','うちの猫と犬の写真','favorite'),imageUrls:['pet.jpg'],author:{id:'favorite',username:'favorite',bio:'アニメとファンアートを描いています'},recommendationTopics:['digital-illustration'],recommendationAuthorTopics:['digital-illustration']};
 const art={...post('art','ファンアートのイラスト','favorite'),imageUrls:['art.jpg'],recommendationTopics:['digital-illustration']};
 expect(rankRecommendations([pet,art] as PostWithAuthor[],{authors:{favorite:100},followedAuthors:['favorite'],terms:{'topic:pets':100},followedTopics:['anime','digital-illustration']},'viewer').map(row=>row.id)).toEqual(['art']);
});
it('does not use a creator biography or popularity as the topic of an unrelated post',()=>{
 const unknown={...post('unrelated','今日のご飯です','favorite'),imageUrls:['food.jpg'],author:{id:'favorite',username:'favorite',displayName:'Favorite',avatarUrl:'',coverUrl:'',createdAt:'2026-10-13',bio:'アニメとイラストが好き'}};
 expect(rankRecommendations([unknown],{authors:{favorite:1000},terms:{},followedTopics:['anime','digital-illustration']},'viewer')).toEqual([]);
});

it('does not label a vague daily photograph as illustration through learned author context alone',()=>{
 const daily={...post('daily','おはようございます','favorite'),imageUrls:['daily.jpg'],recommendationAuthorTopics:['digital-illustration']};
 expect(rankRecommendations([daily] as PostWithAuthor[],{authors:{favorite:100},terms:{},followedTopics:['anime','digital-illustration']},'viewer')).toEqual([]);
});

it('does not turn a general illustration feed label into anime or character-art evidence',()=>{
 const car={...post('car-linework','線画','unfamiliar'),imageUrls:['car-linework.jpg'],recommendationTopics:['digital-illustration'],recommendationSources:['general-illustration-feed']};
 const character={...post('character','キャラクターイラスト','new-artist'),imageUrls:['character.jpg'],recommendationTopics:['digital-illustration'],recommendationSources:['general-illustration-feed']};
 expect(rankRecommendations([car,character] as PostWithAuthor[],{authors:{},terms:{},followedTopics:['anime','digital-illustration']},'viewer').map(row=>row.id)).toEqual(['character']);
});

it('does not infer character relevance from broad role words or generic art-feed tags',()=>{
 const characters=['#人外娘','柑子色の狐耳を描きました','#OC リンカ','リン / Belle #ゼンゼロ'].map((content,i)=>({...post(`character-subject-${i}`,content,`artist-${i}`),imageUrls:[`https://images.example/character-${i}.jpg`],recommendationTopics:['digital-illustration']}));
 const generic={...post('generic-line','線画','other'),imageUrls:['https://images.example/generic.jpg'],recommendationTopics:['digital-illustration']};
 expect(rankRecommendations([...characters,generic] as PostWithAuthor[],{authors:{},terms:{},followedTopics:['anime','digital-illustration']},'viewer').map(row=>row.id)).toEqual([]);
 expect(rankRecommendations([generic] as PostWithAuthor[],{authors:{},terms:{},followedTopics:['anime','digital-illustration']},'viewer')).toEqual([]);
});

it('rejects unfamiliar fairy tales and keyword matches while retaining genuinely related works and followed creators',()=>{
 const vector=Array(512).fill(0);vector[0]=1;const unrelated=Array(512).fill(0);unrelated[1]=1;
 const visual={version:1 as const,kind:'moe',topics:['digital-illustration'] as any,confidence:.9,similarity:.5,vector};
 const reference={...post('liked-reference','ファンアート','liked-artist'),imageUrls:['reference.jpg'],recommendationVisual:visual};
 const story={...post('fairy-tale','昔あるところに少女がいました。アニメの童話 #ファンアート','unknown-storyteller'),imageUrls:['storybook.jpg'],recommendationTopics:['digital-illustration'],likesCount:100000};
 const likedCreatorStory={...story,id:'liked-creator-story',userId:'liked-artist'};
 const wrongImage={...story,id:'different-image',imageUrls:['different.jpg'],recommendationVisual:{...visual,vector:unrelated}};
 const neighbour={...post('related-new-artist','','new-artist'),imageUrls:['related.jpg'],recommendationVisual:visual};
 const followed={...post('followed-new-work','','followed-artist'),imageUrls:['followed.jpg'],recommendationAuthorTopics:['digital-illustration']};
 const prefs={authors:{'liked-artist':10},terms:{アニメ:10000,少女:10000,童話:10000},followedTopics:['anime','digital-illustration'] as any,followedAuthors:['followed-artist'],likedSamples:[reference]};
 expect(rankRecommendations([story,likedCreatorStory,wrongImage,neighbour,followed] as PostWithAuthor[],prefs,'viewer').map(row=>row.id).sort()).toEqual(['followed-new-work','related-new-artist']);
 const prose={...story,id:'prose-only',imageUrls:[],recommendationTopics:['anime']};
 expect(rankRecommendations([prose] as PostWithAuthor[],prefs,'viewer')).toEqual([]);
});

it.each([true,false])('keeps several previously liked art creators with cached pixels=%s without one-off affinity or long prose',(useVisual)=>{
 const vector=Array.from({length:512},(_,i)=>i===0?1:0);
 const visual={version:1 as const,kind:'moe',topics:['digital-illustration'] as any,confidence:.9,similarity:.5,vector};
 const refs=['artist-a','artist-b','artist-c'].flatMap(author=>[0,1].map(i=>({...post(`ref-${author}-${i}`,'',author),imageUrls:[`https://images.example/ref-${author}-${i}.jpg`],recommendationTopics:['digital-illustration'],recommendationVisual:useVisual?visual:undefined})));
 const prefs:import('./recommendations').RecommendationPreferences={authors:{},terms:{},followedTopics:['anime','digital-illustration'],likedSamples:refs};
 for(const ref of refs)addRecommendationInterest(prefs,ref,2);
 const fresh=['artist-a','artist-b','artist-c'].map(author=>({...post(`fresh-${author}`,'',author),imageUrls:[`https://images.example/fresh-${author}.jpg`]}));
 const prose={...fresh[0],id:'long-prose',content:'アニメの童話 #ファンアート '+ '物語の説明。'.repeat(40),imageUrls:['https://images.example/story.jpg']};
 const unknown={...fresh[0],id:'unfamiliar',userId:'unfamiliar',content:'ファンアート',imageUrls:['https://images.example/unfamiliar.jpg']};
 expect(rankRecommendations([...fresh,prose,unknown],prefs,'viewer').map(row=>row.id).sort()).toEqual(fresh.map(row=>row.id).sort());
});
it('rejects NFT promotion even with fan-art tags, artist biography and matching image pixels, without rejecting an NFT prohibition',()=>{
 const base={...post('x:31001','#ファンアート NFT collection mint now','x-user:nft'),source:'x' as const,imageUrls:['https://images.example/nft.jpg'],languages:['ja'],author:{id:'x-user:nft',username:'artist@twitter.com',bio:'イラストレーター',displayName:'Artist',avatarUrl:'',coverUrl:'',createdAt:'2026-10-01'},recommendationVisual:{version:1 as const,kind:'moe' as const,topics:['digital-illustration'] as any,confidence:.99,similarity:.9,vector:Array(512).fill(0)}};
 const preferences={authors:{'x-user:nft':10},terms:{},followedTopics:['digital-illustration'] as any,followedAuthors:['x-user:nft']};
 expect(rankRecommendations([base],preferences,'nft-viewer')).toEqual([]);
 const ordinary={...base,id:'x:31002',content:'#ファンアート NFT化禁止',imageUrls:['https://images.example/ordinary-art.jpg']};
 expect(rankRecommendations([ordinary],preferences,'nft-viewer').map(p=>p.id)).toEqual([ordinary.id]);
 const quote={...ordinary,id:'x:31003',content:'#ファンアート',parentPost:base};
 expect(rankRecommendations([quote],preferences,'nft-viewer')).toEqual([]);
});
it('visual-only home ranking is invariant to captions, hashtags, biography and learned word weights',()=>{
 const image={version:1 as const,classifierVersion:3 as const,kind:'moe',topics:['digital-illustration'] as any,confidence:.9,similarity:.4,vector:Array.from({length:512},(_,i)=>Number(i===0))};
 const candidate={...post('x:41000','plain caption','artist'),imageUrls:['https://images.example/visual-only.jpg'],recommendationVisual:image};
 const prefs={visualOnly:true,authors:{},terms:{ファンアート:999999},followedTopics:['digital-illustration'] as any};
 const changed={...candidate,content:'#ファンアート #オリジナルキャラクター NFT 車 飛行機',imageAltTexts:['猫 旅行'],author:{...candidate.author,bio:'NFT artist 猫好き'}};
 expect(scoreRecommendation(candidate,prefs,'pixel-only').total).toBe(scoreRecommendation(changed,prefs,'pixel-only').total);
 expect(rankRecommendations([candidate],prefs,'pixel-only').map(p=>p.id)).toEqual(rankRecommendations([changed],prefs,'pixel-only').map(p=>p.id));
 const unrelated={...changed,id:'x:41001',recommendationVisual:{...image,kind:'render-3d',topics:[]}};
 expect(rankRecommendations([unrelated],prefs,'pixel-only')).toEqual([]);
 const unchecked={...changed,id:'x:41002',recommendationVisual:undefined};
 expect(rankRecommendations([unchecked],prefs,'pixel-only')).toEqual([]);
 expect(rankRecommendations([unchecked],{...prefs,allowUnverifiedMedia:true},'pixel-only')).toHaveLength(1);
 expect(rankRecommendations([{...candidate,externalReplyToId:'x:parent'}],prefs,'pixel-only')).toEqual([]);
});
it('keeps followed topics mandatory even when a different liked-image class is an exact pixel match',()=>{
 const vector=Array.from({length:512},(_,i)=>Number(i===0));
 const visual={version:1 as const,classifierVersion:3 as const,kind:'animal-illustration',topics:['art','pets'] as any,confidence:.95,similarity:.6,vector};
 const pig={...post('x:51001','#ファンアート オリジナルキャラクター','animal-artist'),imageUrls:['https://images.example/pig.jpg'],recommendationVisual:visual};
 const liked={...pig,id:'liked-animal',imageUrls:['https://images.example/liked-pig.jpg']};
 const preferences={visualOnly:true,authors:{'animal-artist':99},terms:{},followedAuthors:['animal-artist'],followedTopics:['anime'] as any,likedSamples:[liked]};
 expect(rankRecommendations([pig],preferences,'topic-subject-viewer')).toEqual([]);
 expect(rankRecommendations([pig],{...preferences,followedTopics:['digital-illustration']},'topic-subject-viewer')).toEqual([]);
 expect(rankRecommendations([pig],{...preferences,followedTopics:['pets']},'topic-subject-viewer')).toHaveLength(1);
});
it('distinguishes anime humans from animal drawings independently of broad illustration labels',()=>{
 const vector=Array.from({length:512},(_,i)=>Number(i===0));
 const visual={version:1 as const,classifierVersion:3 as const,kind:'moe',topics:['art','digital-illustration'] as any,confidence:.9,similarity:.5,vector};
 const girl={...post('bsky:52001','','girl-artist'),imageUrls:['https://images.example/girl.jpg'],recommendationVisual:visual};
 const pig={...girl,id:'bsky:52002',userId:'pig-artist',content:'#アニメ #ファンアート',imageUrls:['https://images.example/animal.jpg'],recommendationVisual:{...visual,kind:'animal-illustration',topics:['art','pets'] as any}};
 const preferences={visualOnly:true,authors:{},terms:{},followedTopics:['anime'] as any,likedSamples:[{...girl,id:'liked-girl',imageUrls:['https://images.example/liked-girl.jpg']}]};
 expect(rankRecommendations([pig,girl],preferences,'subject-viewer').map(p=>p.id)).toEqual([girl.id]);
 expect(rankRecommendations([girl],{...preferences,likedSamples:[]},'subject-viewer')).toHaveLength(1);
 expect(rankRecommendations([pig,girl],{...preferences,followedTopics:['art']},'subject-viewer').map(p=>p.id)).toEqual([girl.id]);
});
it('does not let likes from a different topic disable a newly followed anime topic',()=>{
 const vector=Array.from({length:512},(_,i)=>Number(i===0));
 const girl={...post('x:53000','','girl-artist'),imageUrls:['https://images.example/new-topic-girl.jpg'],recommendationVisual:{version:1 as const,classifierVersion:3 as const,kind:'moe',topics:['digital-illustration','art'] as any,confidence:.9,similarity:.5,vector}};
 const oldLike={...girl,id:'old-like',recommendationVisual:{...girl.recommendationVisual,kind:'food',topics:['food'] as any}};
 const preferences={visualOnly:true,authors:{},terms:{},followedTopics:['anime','food'] as any,likedSamples:[oldLike]};
 expect(rankRecommendations([girl],preferences,'new-topic-viewer').map(p=>p.id)).toEqual([girl.id]);
});
});

describe("recommendationPaging", () => {
const work=(id:string,url='https://images.example/work.jpg'):PostWithAuthor=>({id,userId:'creator',content:'作品',imageUrls:[url],createdAt:'2026-10-13',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id:'creator',username:'creator',displayName:'Creator',bio:'',avatarUrl:'',coverUrl:'',createdAt:'2026-10-13'}});
it('keeps visible work identities and media fingerprints when creator discovery restarts',()=>{
 const shown=work('bsky:original');const cursor=preserveRecommendationHistory(createRecommendationCursor([]),[shown]);
 expect(cursor.seen).toContain(shown.id);expect(cursor.history).toEqual([shown]);
 expect(uniqueRecommendationPosts([work('bsky:copy','https://images.example/work.jpg?w=900'),work('new','https://images.example/new.jpg')],[shown]).map(post=>post.id)).toEqual(['new']);
});
it('reconciles provider totals and recent creators with cards still visible after image filtering',()=>{
 const cursor={...createRecommendationCursor([]),providerTotals:{twitter:4,other:4},history:[work('x:removed')]};
 const shown=[work('x:kept'),work('bsky:kept','https://images.example/other.jpg')];
 const next=preserveRecommendationHistory(cursor,shown);
 expect(next.providerTotals).toEqual({twitter:1,other:1});expect(next.history).toEqual(shown);
});
it('does not forget a consumed creator budget when image filtering removes their cards',()=>{
 const cursor={...createRecommendationCursor([]),twitterAuthorCounts:{'x-user:artist':3},twitterAuthorHandles:{'x-user:artist':'artist@twitter.com'}};
 const next=preserveRecommendationHistory(cursor,[work('bsky:kept')]);
 expect(next.twitterAuthorCounts?.['x-user:artist']).toBe(3);
 expect(next.twitterAuthorHandles?.['x-user:artist']).toBe('artist@twitter.com');
});
});

describe("recommendationReserve", () => {
const page=(n=20)=>({posts:Array.from({length:n},(_,i)=>({id:'post-'+i,userId:'author-'+i,author:{id:'author-'+i},imageUrls:['https://example.com/'+i+'.jpg'],recommendationVisual:classifyRecommendationVisual(visuals.find(row=>row.name==='original-moe')!.vector)})),preferences:{authors:{},terms:{}},next:undefined} as any);
afterEach(()=>{sessionStorage.clear();vi.restoreAllMocks();});
it('retains only a complete reserve for the same account and sources',()=>{
 saveRecommendationReserve('viewer:a',page(19));expect(readRecommendationReserve('viewer:a')).toBeUndefined();
 saveRecommendationReserve('viewer:a',page());expect(readRecommendationReserve('viewer:a')?.posts).toHaveLength(20);expect(readRecommendationReserve('viewer:b')).toBeUndefined();clearRecommendationReserve();expect(readRecommendationReserve('viewer:a')).toBeUndefined();
});
it('expires prepared work after two minutes and rejects malformed checkpoints',()=>{
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);saveRecommendationReserve('viewer',page());vi.mocked(Date.now).mockReturnValue(now+120001);expect(readRecommendationReserve('viewer')).toBeUndefined();
 sessionStorage.setItem('lime-recommendation-reserve-v1','broken');expect(readRecommendationReserve('viewer')).toBeUndefined();
});

it('rejects an old reserve that falsely labels the reported document as character artwork',()=>{
 const old=page();old.posts[0].recommendationVisual={...old.posts[0].recommendationVisual,vector:document.vector};
 saveRecommendationReserve('viewer',old);expect(readRecommendationReserve('viewer')).toBeUndefined();
});
});
});

describe("recommendationSignals", () => {
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

it('keeps curated illustration discovery available after learning personal art tastes without downloading a vision model',()=>{
 const author='did:plc:liked-artist';
 const base={imageUrls:['https://images.example/liked.jpg'],content:'キャラクターイラスト',createdAt:new Date().toISOString(),likesCount:1,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,source:'bluesky',languages:['ja'],author:{id:author,username:'liked.bsky.social'}} as any;
 const preferences:RecommendationPreferences={authors:{[author]:8},terms:{},followedTopics:['digital-illustration'],authorTopics:{[author]:{'digital-illustration':8}},likedSamples:[{...base,id:'bsky:liked',userId:author,recommendationTopics:['digital-illustration']}]};
 const candidate={...base,id:'bsky:unseen-curated',userId:'did:plc:new-artist',imageUrls:['https://images.example/new.jpg'],content:'',recommendationTopics:['digital-illustration'],recommendationSources:['at://did:plc:pbznmgl4g4srad5kabmmfkmi/app.bsky.feed.generator/aaaewbdiflbom'],recommendationLanguages:['ja'],author:{id:'did:plc:new-artist',username:'new.bsky.social'}} as PostWithAuthor;
 expect(rankRecommendations([candidate],preferences,'viewer').map(post=>post.id)).toContain(candidate.id);
 expect(rankRecommendations([{...candidate,id:'bsky:keyword-only',recommendationSources:['search:萌え']}],preferences,'viewer')).toEqual([]);
 expect(rankRecommendations([{...candidate,id:'bsky:unrelated',recommendationTopics:['pets'],recommendationVisual:{version:1,kind:'photo',topics:['pets'],confidence:.9,similarity:0,vector:Array(512).fill(0)}}],preferences,'viewer')).toEqual([]);
});
});

describe("recommendationVisual", () => {
describe("recommendationVisual", () => {
// Embeddings measured from real pixels: public original artwork, a male
// character sketch, the Luanti project's game screenshot, and the official
// Transformers.js cats/football images. No caption/alt/tag is encoded here.
const visual=(name:string)=>recommendationVisualTestClassifyRecommendationVisual(visuals.find(row=>row.name===name)!.vector);
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
it('does not turn an uncertain pixel classification into a confident rejection of creator-supported art',()=>{
 const candidate=post('x:991','original-moe',{author:{id:'x-user:991',username:'artist@twitter.com',bio:'イラストレーター'} as any,source:'x',content:'#ファンアート',recommendationTopics:['digital-illustration'],recommendationVisual:{version:1,kind:'unknown',topics:[],confidence:0,similarity:.1,vector:Array(512).fill(0)}});
 expect(recommendationIsEligible(candidate,['digital-illustration'])).toBe(true);expect(candidate.recommendationVisual?.kind).toBe('unknown');
 expect(recommendationIsEligible({...candidate,recommendationVisual:visual('pets')},['digital-illustration'])).toBe(false);
});
it('classifies the supplied mascot picture from its measured pixels as 3D rather than trusting character-art captions',async()=>{
 const regression=(await import("@/lib/fixtures/recommendationVisualRegression.json")).default;
 const visual=recommendationVisualTestClassifyRecommendationVisual(regression.render3d);
 expect(visual.kind).toBe('render-3d');expect(visual.classifierVersion).toBe(3);
 const prefs={visualOnly:true,authors:{},terms:{オリジナルキャラクター:9999},followedTopics:['digital-illustration'] as TopicId[]};
 for(const source of ['bluesky','x'] as const){
  const candidate={id:source+':render-regression',userId:source+':creator',source,content:'#オリジナルキャラクター #ファンアート',imageUrls:['https://images.example/render-regression.jpg'],createdAt:new Date().toISOString(),likesCount:99999,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,recommendationVisual:visual,author:{id:source+':creator',username:'artist',bio:'イラストレーター'}} as PostWithAuthor;
  expect(rankRecommendations([candidate],prefs,'regression-viewer')).toEqual([]);
 }
});
it('has an independent animal-drawing class rather than treating all drawings as anime people',async()=>{
 const prototypes=(await import("@/lib/recommendationVisualPrototypes.json")).default;
 const animal=prototypes.prototypes.find(row=>row.id==='animal-illustration')!;
 const classified=recommendationVisualTestClassifyRecommendationVisual(animal.vectors[0]);
 expect(classified.kind).toBe('animal-illustration');expect(classified.topics).not.toContain('digital-illustration');
});
});

describe("recommendationVisualQueue", () => {
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
it('overlaps model startup and bounded downloads while keeping inference serial',async()=>{
 vi.useFakeTimers();try{
  const start=Date.now();let downloads=0,maxDownloads=0,inferences=0,maxInferences=0;
  const context=delay(1000).then(()=>({ready:true}));
  const run=createRecommendationVisualQueue({load:()=>context,prepare:async(id:number)=>{downloads++;maxDownloads=Math.max(downloads,maxDownloads);await delay(1000);downloads--;return id;},infer:async(_context,id)=>{inferences++;maxInferences=Math.max(inferences,maxInferences);await delay(100);inferences--;return id;}});
  const done=Promise.all(Array.from({length:6},(_,i)=>run(i)));let finished=false;void done.then(()=>{finished=true;});
  await vi.advanceTimersByTimeAsync(2399);expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(await done).toEqual([0,1,2,3,4,5]);
  expect(Date.now()-start).toBe(2400);expect(maxDownloads).toBe(3);expect(maxInferences).toBe(1);
 }finally{vi.useRealTimers();}
});
it('lets ready images run before a slow earlier image download',async()=>{
 vi.useFakeTimers();try{
  const prepared:number[]=[],inferred:number[]=[];
  const run=createRecommendationVisualQueue({load:async()=>null,prepare:async(id:number)=>{await delay(id===0?3000:10);prepared.push(id);return id;},infer:async(_context,id)=>{inferred.push(id);return id;}});
  const jobs=[run(0),run(1),run(2)];await vi.advanceTimersByTimeAsync(20);
  expect(prepared).toEqual([1,2]);expect(inferred).toEqual([1,2]);
  await vi.advanceTimersByTimeAsync(3000);expect(await Promise.all(jobs)).toEqual([0,1,2]);
 }finally{vi.useRealTimers();}
});
it('releases capacity after failures and continues later images',async()=>{
 const run=createRecommendationVisualQueue({capacity:1,load:async()=>null,prepare:async(id:number)=>{if(id===0)throw new Error('unavailable');return id;},infer:async(_context,id)=>id});
 const result=await Promise.allSettled([run(0),run(1),run(2)]);
 expect(result.map(row=>row.status)).toEqual(['rejected','fulfilled','fulfilled']);
});
});
});

describe("trendViews", () => {
it('persists actual views across reloads and isolates accounts',async()=>{
 localStorage.clear();
 const first=await import("@/hooks/useTopics");first.recordTrendView('x:123','account-a');
 vi.resetModules();
 const reloaded=await import("@/hooks/useTopics");
 expect(reloaded.readTrendViews('account-a')).toEqual(new Set(['x:123']));
 expect(reloaded.readTrendViews('account-b')).toEqual(new Set());
 expect(reloaded.readTrendViews(null)).toEqual(new Set());
});
it('retains session views when local storage cannot be written',async()=>{
 const store=await import("@/hooks/useTopics");
 const failing=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
 try{store.recordTrendView('x:quota','blocked');expect(store.readTrendViews('blocked').has('x:quota')).toBe(true);}finally{failing.mockRestore();}
});

it('persists delivered batches before a view timer can fire and deduplicates them',async()=>{
 const store=await import("@/hooks/useTopics");store.recordTrendDeliveries(['x:fast-a','x:fast-b','x:fast-a'],'fast-scroll');
 expect(store.readTrendViews('fast-scroll')).toEqual(new Set(['x:fast-a','x:fast-b']));
 vi.resetModules();const reloaded=await import("@/hooks/useTopics");expect(reloaded.readTrendViews('fast-scroll')).toEqual(new Set(['x:fast-a','x:fast-b']));
});

it('does not repeatedly parse or rewrite an unchanged delivered history',async()=>{
 const store=await import("@/hooks/useTopics");store.recordTrendDeliveries(['x:same'],'stable-history');
 const parse=vi.spyOn(JSON,'parse'),write=vi.spyOn(Storage.prototype,'setItem');
 try{for(let i=0;i<100;i++){store.readTrendViews('stable-history');store.recordTrendView('x:same','stable-history');}
 expect(parse).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();}finally{parse.mockRestore();write.mockRestore();}
});
});
