import {matchingTopics} from './topics';
import type { PostWithAuthor } from '@/types';
import {TOPICS,isTopicId,topicAffinity,type TopicId} from './topics';
import {recommendationIdentity,recommendationFingerprint} from './recommendationIdentity';
import {recommendationIsEligible} from './recommendationEligibility';
import {isDeclaredGeneratedArt} from './artRecommendations';
import {recommendationOriginLanguages,recommendationTopicAffinity,recommendationTopicSignals,recommendationText} from './recommendationSignals';
import {visualSimilarity as directVisualSimilarity,createVisualSimilarityComparator,readVisualCache,applyCachedRecommendationVisuals} from './recommendationVisual';

// The scope ends with each scoring pass: no stale cache after feedback changes.
let compareVisual:ReturnType<typeof createVisualSimilarityComparator>|undefined;
const visualSimilarity=(a:number[],b:number[])=>compareVisual?compareVisual(a,b):directVisualSimilarity(a,b);
function withScoringComparisons<T>(read:()=>T):T{
 if(compareVisual)return read();
 compareVisual=createVisualSimilarityComparator();try{return read();}finally{compareVisual=undefined;}
}
export type RecommendationFeedback={id:string;userId:string;fingerprint?:string;topics?:TopicId[];vector?:number[];imageUrls?:string[];visualKind?:string;createdAt:string};
export type RecommendationPreferences = {
  authors: Record<string, number>;
  terms: Record<string, number>;
  recentAuthors?: Record<string, number>;
  recentTerms?: Record<string, number>;
  followedAuthors?: string[];
  likedPostIds?: string[];
  followedTopics?: TopicId[];
  dismissedTopics?: TopicId[];
  authorLanguages?:Record<string,string[]>;
  authorTopics?:Record<string,Partial<Record<TopicId,number>>>;
  visualInterests?:number[][];
  likedSamples?:(PostWithAuthor & {engagedAt?:string})[];
  feedback?:RecommendationFeedback[];
};
/** Keep diverse compact references while all loaded likes contribute to scores. */
export function selectRecommendationLikeSamples(rows:(PostWithAuthor & {engagedAt?:string})[],limit=128) {
 const ids=new Set<string>(),authors=new Set<string>();
 const unique=rows.filter(row=>{const id=recommendationIdentity(row);if(ids.has(id))return false;ids.add(id);return true;}).sort((a,b)=>(Date.parse(b.engagedAt??'')||0)-(Date.parse(a.engagedAt??'')||0));
 const selected:typeof rows=[],rest:typeof rows=[];
 for(const row of unique){if(!authors.has(row.userId)&&selected.length<limit){authors.add(row.userId);selected.push(row);}else rest.push(row);}
 for(const row of rest){if(selected.length>=limit)break;selected.push(row);}
 return selected.map(row=>({id:row.id,userId:row.userId,content:row.content.slice(0,2000),imageUrls:row.imageUrls.slice(0,4),imageAltTexts:row.imageAltTexts?.slice(0,4),source:row.source,languages:row.languages,recommendationLanguages:row.recommendationLanguages,recommendationTopics:row.recommendationTopics,recommendationAuthorTopics:row.recommendationAuthorTopics,recommendationSources:row.recommendationSources,recommendationVisual:row.recommendationVisual,engagedAt:row.engagedAt,author:{id:row.userId,bio:row.author?.bio,displayName:row.author?.displayName}} as PostWithAuthor & {engagedAt?:string}));
}
const stopWords = new Set(['です','ます','した','して','する','ある','いる','これ','それ','ため','さん','こと','よう','今日','昨日','今回','自分','本当','こちら','みんな','https','http','www','com','the','and','with','this','that']);
const concepts = [
  ['cats','猫','ねこ','ネコ','cat','cats','kitten'],
  ['dogs','犬','いぬ','イヌ','dog','dogs','puppy'],
  ['art','イラスト','絵','お絵描き','illustration','drawing'],
  ['music','音楽','楽曲','music','ライブ','コンサート'],
  ['programming','プログラミング','開発','typescript','javascript','python','coding'],
];
let wordSegmenter:any;
const termCache=new Map<string,string[]>();
export function recommendationTerms(content: string): string[] {
  const text=content.replace(/https?:\/\/\S+/g,' ').normalize('NFKC').toLowerCase();
  const cached=termCache.get(text);if(cached)return [...cached];
  const Segmenter=(Intl as any).Segmenter;
  if(Segmenter&&!wordSegmenter)wordSegmenter=new Segmenter('ja',{granularity:'word'});
  const words: string[]=Segmenter ? [...wordSegmenter.segment(text)].filter((s:any)=>s.isWordLike).map((s:any)=>s.segment) : text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms=[...new Set(words.filter(word=>!stopWords.has(word) && !/^\d+$/.test(word) && (word.length>1 || /\p{Script=Han}/u.test(word))))].slice(0,64);
  for(const [concept,...aliases] of concepts) if(aliases.some(alias=>terms.includes(alias))) terms.push(`topic:${concept}`);
  if(termCache.size>=512)termCache.delete(termCache.keys().next().value!);
  termCache.set(text,terms);return [...terms];
}
export function addRecommendationInterest(preferences: RecommendationPreferences, post: {content?:string;userId?:string;user_id?:string;imageAltTexts?:string[];recommendationTopics?:string[];recommendationAuthorTopics?:string[];recommendationVisual?:PostWithAuthor['recommendationVisual'];linkPreview?:{title?:string;description?:string};languages?:string[];recommendationLanguages?:string[];author?:{id?:string;bio?:string;displayName?:string}}, weight:number, eventAt?:string, now=Date.now()) {
  const timestamp=eventAt ? Date.parse(eventAt) : now;
  const age=Number.isFinite(timestamp)?Math.max(0,(now-timestamp)/86400000):30;
  const longWeight=weight*Math.pow(0.5,age/60);
  const recentWeight=weight*Math.pow(0.5,age/7);
  preferences.recentAuthors ??= {};
  preferences.recentTerms ??= {};
  if(post.recommendationVisual?.vector.length===512){preferences.visualInterests??=[];if(preferences.visualInterests.length<24)preferences.visualInterests.push(post.recommendationVisual.vector);}
  const author=post.userId ?? post.user_id ?? post.author?.id;
  if(author) {
    preferences.authors[author]=(preferences.authors[author] ?? 0)+longWeight;
    preferences.recentAuthors[author]=(preferences.recentAuthors[author] ?? 0)+recentWeight;
    preferences.authorLanguages??={};
    preferences.authorLanguages[author]=[...new Set([...(preferences.authorLanguages[author]??[]),...recommendationOriginLanguages(post)])];
    preferences.authorTopics??={};const profile=preferences.authorTopics[author]??={};
    // A liked image-only work can carry creator context without body keywords.
    // Confident visual classification still takes precedence over source hints.
    const topics=post.recommendationVisual?.kind&&post.recommendationVisual.kind!=='unknown'
      ? post.recommendationVisual.topics
      : [...new Set([...recommendationTopicSignals(post),...(post.recommendationAuthorTopics??[]).filter(isTopicId)])];
    for(const topic of topics)profile[topic]=(profile[topic]??0)+longWeight;
  }
  const terms=recommendationTerms(recommendationText(post));
  // Normalize each event so verbose posts cannot dominate the user's profile.
  const lengthWeight=1/Math.sqrt(Math.max(1,terms.length));
  for(const term of terms) {
    preferences.terms[term]=(preferences.terms[term] ?? 0)+longWeight*lengthWeight;
    preferences.recentTerms[term]=(preferences.recentTerms[term] ?? 0)+recentWeight*lengthWeight;
  }
}
export function recommendationQueries(preferences:RecommendationPreferences):string[] {
  const explicit=TOPICS.filter(topic=>preferences.followedTopics?.includes(topic.id)).map(topic=>topic.queries[0]);
  const learned=Object.entries(preferences.terms).filter(([term])=>!term.startsWith('topic:') && topicAffinity(term,{dismissed:preferences.dismissedTopics})>=0)
    .sort((a,b)=>(b[1]+(preferences.recentTerms?.[b[0]] ?? 0))-(a[1]+(preferences.recentTerms?.[a[0]] ?? 0)))
    .slice(0,3).map(([term])=>term);
  // Keep a bounded candidate budget and leave a slot for learned interests.
  return [...new Set([...explicit.slice(0,2),...learned,...explicit.slice(2)])].slice(0,3);
}
type Impression={at:number;count:number};
const impressionKey=(viewerId:string|null)=>`lime_recommendation_impressions:${viewerId ?? 'guest'}`;
export function readRecommendationImpressions(viewerId:string|null,now=Date.now()):Record<string,Impression> {
  try {
    const data:Record<string,Impression>=JSON.parse(localStorage.getItem(impressionKey(viewerId)) ?? '{}');
    return Object.fromEntries(Object.entries(data).filter(([,row]:[string,any])=>row && Number.isFinite(row.at) && row.at<=now && now-row.at<30*86400000 && Number.isFinite(row.count)));
  } catch {return {};}
}
export function recordRecommendationImpression(id:string,viewerId:string|null,now=Date.now(),fingerprint?:string) {
  try {
    const data=readRecommendationImpressions(viewerId,now);
    for(const key of [id,...(fingerprint?[fingerprint]:[])])data[key]={at:now,count:Math.min(10,(data[key]?.count ?? 0)+1)};
    const rows=Object.entries(data).sort((a,b)=>b[1].at-a[1].at).slice(0,2000);
    localStorage.setItem(impressionKey(viewerId),JSON.stringify(Object.fromEntries(rows)));
  } catch { /* Storage is optional; never interrupt browsing. */ }
}
type RecommendationDelivery={at:number;userId:string;fingerprint?:string};
const deliveredMemory=new Map<string,Record<string,RecommendationDelivery>>();
const deliveredKey=(viewerId:string|null)=>`lime_recommendation_deliveries:${viewerId??'guest'}`;
export function readRecommendationDeliveries(viewerId:string|null,now=Date.now()):Record<string,RecommendationDelivery>{
 // A fetched card is not a view. Reserve it briefly in this document so
 // overlapping requests cannot repeat it; only visible impressions persist.
 // Ignore legacy persisted deliveries, which suppressed unseen work for 30 days.
 const stored=deliveredMemory.get(deliveredKey(viewerId))??{};
 return Object.fromEntries(Object.entries(stored).filter(([,row])=>Number.isFinite(row.at)&&row.at<=now&&now-row.at<120000)) as Record<string,RecommendationDelivery>;
}
export function recordRecommendationDelivery(posts:PostWithAuthor[],viewerId:string|null,now=Date.now()):void{
 const key=deliveredKey(viewerId),rows=readRecommendationDeliveries(viewerId,now);
 for(const post of posts)rows[recommendationIdentity(post)]={at:now,userId:post.userId,fingerprint:recommendationFingerprint(post)};
 const bounded=Object.fromEntries(Object.entries(rows).sort((a,b)=>b[1].at-a[1].at).slice(0,5000));
 deliveredMemory.set(key,bounded);
}
/** Keep a hard run limit independently of popularity or creator affinity. */
export function selectRecommendationPage(ranked:PostWithAuthor[],preferences:RecommendationPreferences,history:PostWithAuthor[],limit=20){
 return withScoringComparisons(()=>selectRecommendationPageInternal(ranked,preferences,history,limit));
}
function selectRecommendationPageInternal(ranked:PostWithAuthor[],preferences:RecommendationPreferences,history:PostWithAuthor[],limit:number){
 const posts:PostWithAuthor[]=[],remaining=[...ranked];
 const feedback=activeRecommendationFeedback(preferences,Date.now());
 const scoring=prepareScoringContext(preferences,{},Date.now());
 const hasLikedPixels=preferences.likedSamples?.some(post=>post.recommendationVisual);
 while(posts.length<limit&&remaining.length){
  const recent=[...history.slice(-3),...posts].slice(-3),last=recent.at(-1)?.userId;
  let index=0;
  if(recent.length===3&&recent.every(post=>post.userId===last)){
   index=remaining.findIndex(post=>post.userId!==last&&scoreRecommendation(post,preferences,null,scoring).total>0&&(!hasLikedPixels||!!preferences.authors[post.userId]||relatedRecommendationScore(post,preferences.likedSamples??[],preferences,feedback)>0));
   if(index<0)break;
  }
  posts.push(remaining.splice(index,1)[0]);
 }
 return {posts,remaining,blocked:posts.length<limit&&remaining.length>0};
}
type CosineProfile={vector:Record<string,number>;norm:number};
function prepareCosine(profile:Record<string,number>,idf:Record<string,number>):CosineProfile {
  const strongest=Object.entries(profile).filter(([,weight])=>weight>0).sort((a,b)=>b[1]-a[1]).slice(0,96);
  const vector=Object.fromEntries(strongest.map(([term,weight])=>[term,Math.log1p(weight)*(idf[term] ?? 1)]));
  return {vector,norm:Object.values(vector).reduce((sum,value)=>sum+value*value,0)};
}
function cosine(terms:string[],profile:Record<string,number>,idf:Record<string,number>,prepared?:CosineProfile):number{
  const {vector,norm:profileNorm}=prepared??prepareCosine(profile,idf);
  let dot=0,candidateNorm=0;
  for(const term of terms) {const weight=idf[term] ?? 1;dot+=weight*(vector[term] ?? 0);candidateNorm+=weight*weight;}

  return candidateNorm && profileNorm ? dot/Math.sqrt(candidateNorm*profileNorm):0;
}
function activeRecommendationFeedback(preferences:RecommendationPreferences,now:number):RecommendationFeedback[] {
 const positive=new Map<string,number>();
 for(const liked of preferences.likedSamples??[]){const at=Date.parse(liked.engagedAt??'');if(Number.isFinite(at))positive.set(liked.userId,Math.max(positive.get(liked.userId)??0,at));}
 return (preferences.feedback??[]).filter(row=>{const at=Date.parse(row.createdAt);return Number.isFinite(at)&&at>(positive.get(row.userId)??0);});
}
function imageFeedbackSimilarity(post:PostWithAuthor,feedback:RecommendationFeedback[]):number {
 return post.recommendationVisual?Math.max(0,...feedback.filter(row=>Array.isArray(row.vector)).slice(0,32).map(row=>visualSimilarity(row.vector!,post.recommendationVisual!.vector))):0;
}
function positiveImageSimilarity(post:PostWithAuthor,preferences:RecommendationPreferences):number {
 return post.recommendationVisual?Math.max(0,...(preferences.visualInterests??[]).map(vector=>visualSimilarity(vector,post.recommendationVisual!.vector)),...(preferences.likedSamples??[]).filter(row=>row.recommendationVisual).map(row=>visualSimilarity(row.recommendationVisual!.vector,post.recommendationVisual!.vector))):0;
}
export type RecommendationScore = {
  interest:number;recentInterest:number;author:number;follow:number;freshness:number;quality:number;seenPenalty:number;spamPenalty:number;selfPenalty:number;total:number;
};
type ScoringContext={idf?:Record<string,number>;impressions?:Record<string,Impression>;now?:number;profiles?:{long:CosineProfile;recent:CosineProfile};feedback?:RecommendationFeedback[]};
function prepareScoringContext(preferences:RecommendationPreferences,idf:Record<string,number>,now:number,impressions?:Record<string,Impression>):ScoringContext {
 return {idf,now,impressions,profiles:{long:prepareCosine(preferences.terms,idf),recent:prepareCosine(preferences.recentTerms??preferences.terms,idf)},feedback:activeRecommendationFeedback(preferences,now)};
}
export function scoreRecommendation(post:PostWithAuthor,preferences:RecommendationPreferences,viewerId:string|null,context:ScoringContext={}):RecommendationScore {
  const now=context.now ?? Date.now();
  const relevanceText=recommendationText(post);
  const terms=recommendationTerms(relevanceText);
  const timestamp=Date.parse(post.createdAt);
  const age=Number.isFinite(timestamp)?Math.max(0,(now-timestamp)/3600000):168;
  const interest=cosine(terms,preferences.terms,context.idf ?? {},context.profiles?.long);
  const recentInterest=cosine(terms,preferences.recentTerms ?? preferences.terms,context.idf ?? {},context.profiles?.recent);
  const author=1-Math.exp(-((preferences.authors[post.userId] ?? 0)+(preferences.recentAuthors?.[post.userId] ?? 0))/8);
  const follow=preferences.followedAuthors?.includes(post.userId)?1:0;
  const freshness=Math.pow(0.5,age/48);
  // Popularity contributes modestly and decays with age. It cannot overpower
  // personal relevance, and fresh posts with few likes can still rank highly.
  const engagement=Math.max(0,Number(post.likesCount)||0)+2*Math.max(0,Number(post.commentsCount)||0)+2*Math.max(0,Number(post.repostsCount)||0);
  const quality=Math.min(1,Math.log1p(engagement/(age+6))/6);
  const impression=context.impressions?.[post.id];
  const seenPenalty=impression?(12+Math.min(12,impression.count*3))*Math.pow(0.5,Math.max(0,now-impression.at)/(3*86400000)):0;
  const hashtags=post.content.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  const spamPenalty=Math.min(16,Math.max(0,hashtags-6)*2);
  const selfPenalty=post.userId===viewerId?12:0;
  const topicScore=recommendationTopicAffinity(post,{followed:preferences.followedTopics,dismissed:preferences.dismissedTopics},preferences.authorTopics?.[post.userId]);
  const unrelatedPenalty=preferences.followedTopics?.length&&topicScore===0?14:0;
  const authorWeight=preferences.followedTopics?.length&&topicScore<.2?8:36;
  const hasCreatorContext=[...(post.recommendationTopics??[]),...(post.recommendationAuthorTopics??[])].some(topic=>preferences.followedTopics?.includes(topic as TopicId)) || Object.entries(preferences.authorTopics?.[post.userId]??{}).some(([topic,weight])=>(weight??0)>0&&preferences.followedTopics?.includes(topic as TopicId));
  // Topic/source and creator evidence should beat a saturated text-only match.
  const historyWeight=preferences.followedTopics?.length?(hasCreatorContext?.15:.08):.3;
  const neighbours=post.recommendationVisual?(preferences.visualInterests??[]).map(vector=>visualSimilarity(vector,post.recommendationVisual!.vector)).sort((a,b)=>b-a).slice(0,3):[];
 const visualInterest=neighbours.length?neighbours.reduce((sum,value)=>sum+value,0)/neighbours.length:0;
  // Shared visual composition/style learned from liked works applies to every
  // media topic. A caption cannot provide this signal.
  const mediaInterest=72*Math.max(0,(visualInterest-.35)/.65);
  const negatives=context.feedback??activeRecommendationFeedback(preferences,now);
  const dislikedAuthor=negatives.filter(row=>row.userId===post.userId).length;
  const negativeSimilarity=imageFeedbackSimilarity(post,negatives);
  const positiveSimilarity=positiveImageSimilarity(post,preferences);
  const dislikedImage=Math.max(0,(negativeSimilarity-.65)/.35);
  const negativeWins=negativeSimilarity>=.72&&negativeSimilarity>positiveSimilarity+.04;
  const feedbackPenalty=Math.min(128,64*dislikedAuthor)+96*dislikedImage+(negativeWins?48:0);
  return {interest,recentInterest,author,follow,freshness,quality,seenPenalty,spamPenalty,selfPenalty,
    total:historyWeight*(30*interest+36*recentInterest)+mediaInterest+authorWeight*author+8*follow+8*freshness+4*quality-seenPenalty-spamPenalty-selfPenalty+60*topicScore-unrelatedPenalty-feedbackPenalty};
}
/** Related discovery uses creator/source context and pixels, not caption overlap. */
function relatedRecommendationScore(post:PostWithAuthor,anchors:PostWithAuthor[],preferences:RecommendationPreferences,feedback:RecommendationFeedback[]):number {
 if(post.imageUrls.length){
  // A broad art/feed label alone cannot establish personal visual taste.
  if(!post.recommendationVisual||post.recommendationVisual.kind==='unknown')return 0;
  const references=anchors.filter(anchor=>anchor.userId!==post.userId&&anchor.recommendationVisual&&anchor.recommendationVisual.kind===post.recommendationVisual!.kind);
  const similarity=Math.max(0,...references.map(anchor=>visualSimilarity(anchor.recommendationVisual!.vector,post.recommendationVisual!.vector)));
  const negative=imageFeedbackSimilarity(post,feedback);
  return similarity>=.72&&similarity>negative+.05?1+similarity:0;
 }
 // Non-image discovery needs repeated engagement with different creators in
 // the same source/topic, rather than one topic name or a caption keyword.
 const own=new Set([...(post.recommendationTopics??[]),...(post.recommendationAuthorTopics??[])]);
 const supported=new Set(anchors.filter(anchor=>anchor.userId!==post.userId&&post.recommendationSources?.some(source=>anchor.recommendationSources?.includes(source))&&[...(anchor.recommendationTopics??[]),...(anchor.recommendationAuthorTopics??[])].some(topic=>own.has(topic))).map(anchor=>anchor.userId));
 return supported.size>=2?1:0;
}
/** Repeated dismissals mean a broad source/topic is insufficient evidence.
 * This applies to every topic, without guessing character gender from captions. */
export function recommendationNeedsPersonalMediaEvidence(post:PostWithAuthor,preferences:RecommendationPreferences,feedback=activeRecommendationFeedback(preferences,Date.now())):boolean {
 if(!post.imageUrls?.length)return false;
 const topics=new Set([...recommendationTopicSignals(post),...(post.recommendationAuthorTopics??[])]);
 return (preferences.followedTopics??[]).some(topic=>topics.has(topic)&&new Set(feedback.filter(row=>row.topics?.includes(topic)).map(row=>row.id)).size>=3);
}
function hasPersonalMediaEvidence(post:PostWithAuthor,preferences:RecommendationPreferences):boolean {
 if((preferences.authors[post.userId]??0)>0||preferences.followedAuthors?.includes(post.userId))return true;
 const positive=positiveImageSimilarity(post,preferences);
 return !!post.recommendationVisual&&post.recommendationVisual.kind!=='unknown'&&positive>=.8;
}
export function rejectedRecommendationTopics(preferences:RecommendationPreferences):TopicId[]{
 const feedback=activeRecommendationFeedback(preferences,Date.now());
 return (preferences.followedTopics??[]).filter(topic=>new Set(feedback.filter(row=>row.topics?.includes(topic)).map(row=>row.id)).size>=3);
}
export function isRecommendationAuthorRejected(author:string,preferences:RecommendationPreferences):boolean{
 return activeRecommendationFeedback(preferences,Date.now()).some(row=>row.userId===author);
}
export function recommendationIsDismissed(post:PostWithAuthor,preferences:RecommendationPreferences,now=Date.now(),feedback=activeRecommendationFeedback(preferences,now)):boolean {
 const identity=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
 if(preferences.feedback?.some(row=>row.id===identity||!!fingerprint&&row.fingerprint===fingerprint))return true;
 if(feedback.some(row=>row.userId===post.userId))return true;
 if(recommendationNeedsPersonalMediaEvidence(post,preferences,feedback)&&!hasPersonalMediaEvidence(post,preferences))return true;
 const negative=imageFeedbackSimilarity(post,feedback);
 const positive=positiveImageSimilarity(post,preferences);
 if(negative>=.80&&negative>positive+.04)return true;
 // Repeated negative neighbors outweigh a broad topic/source hint. One disliked
 // work must not ban an entire topic; require three independently dismissed works.
 const neighbors=post.recommendationVisual?feedback.filter(row=>row.vector&&visualSimilarity(row.vector,post.recommendationVisual!.vector)>=.70).map(row=>visualSimilarity(row.vector!,post.recommendationVisual!.vector)).sort((a,b)=>b-a):[];
 return neighbors.length>=3&&neighbors.slice(0,3).reduce((sum,value)=>sum+value,0)/3>positive+.025;
}
export function rankRecommendations(posts:PostWithAuthor[], preferences:RecommendationPreferences, viewerId:string|null, now=Date.now(), history:PostWithAuthor[]=[],rankLimit=Infinity):PostWithAuthor[] {
 return withScoringComparisons(()=>rankRecommendationsInternal(posts,preferences,viewerId,now,history,rankLimit));
}
function rankRecommendationsInternal(posts:PostWithAuthor[], preferences:RecommendationPreferences, viewerId:string|null, now:number, history:PostWithAuthor[],rankLimit:number):PostWithAuthor[] {
  const impressions=readRecommendationImpressions(viewerId,now);
  const deliveries=readRecommendationDeliveries(viewerId,now);
  const deliveredFingerprints=new Set(Object.values(deliveries).map(row=>row.fingerprint).filter(Boolean));
  const likedIds=new Set([...(preferences.likedPostIds ?? []),...readRecommendationLikes(viewerId).map(post=>post.id),...readRecommendationLikedIds(viewerId)]);
  const ids=new Set<string>(),contents=new Set(history.map(recommendationFingerprint).filter((key):key is string=>!!key));
  const merged=new Map<string,PostWithAuthor>();
  for(const input of posts){
    const learnedTopics=Object.entries(preferences.authorTopics?.[input.userId]??{}).filter(([,weight])=>(weight??0)>=1).map(([topic])=>topic);
    const post={...input,recommendationAuthorTopics:[...new Set([...(input.recommendationAuthorTopics??[]),...learnedTopics])],recommendationLanguages:[...new Set([...(input.recommendationLanguages??[]),...(preferences.authorLanguages?.[input.userId]??[])])]};
    const identity=recommendationIdentity(post);
    const old=merged.get(identity);
    merged.set(identity,old?{...old,recommendationVisual:old.recommendationVisual??post.recommendationVisual,recommendationVisualStatus:old.recommendationVisualStatus==='checked'||post.recommendationVisualStatus==='checked'?'checked':post.recommendationVisualStatus??old.recommendationVisualStatus,recommendationSources:[...new Set([...(old.recommendationSources??[]),...(post.recommendationSources??[])])],author:{...old.author,bio:old.author.bio||post.author.bio},languages:[...new Set([...(old.languages??[]),...(post.languages??[])])],recommendationLanguages:[...new Set([...(old.recommendationLanguages??[]),...(post.recommendationLanguages??[])])],recommendationTopics:[...new Set([...(old.recommendationTopics??[]),...(post.recommendationTopics??[])])],recommendationAuthorTopics:[...new Set([...(old.recommendationAuthorTopics??[]),...(post.recommendationAuthorTopics??[])])],imageAltTexts:[...new Set([...(old.imageAltTexts??[]),...(post.imageAltTexts??[])])],contentLabels:[...new Set([...(old.contentLabels??[]),...(post.contentLabels??[])])]}:post);
  }
  const feedback=activeRecommendationFeedback(preferences,now);
  const unique=[...merged.values()].filter(post=>{
    const identity=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
    if(recommendationIsDismissed(post,preferences,now,feedback))return false;
    if(feedback.some(row=>row.userId===post.userId)&&scoreRecommendation(post,preferences,viewerId,{now}).total<=0)return false;
    if(!recommendationIsEligible(post,preferences.followedTopics))return false;
    if(preferences.followedTopics?.length){
      const relevance=new Set([...recommendationTopicSignals(post),...(post.recommendationAuthorTopics??[]),...matchingTopics(post.author?.bio??'')]);
      if(isDeclaredGeneratedArt(post))relevance.add('ai');
      const knownAuthor=(preferences.authors[post.userId]??0)>0||preferences.followedAuthors?.includes(post.userId);
      const visualMatch=post.recommendationVisual&&(preferences.visualInterests??[]).some(vector=>visualSimilarity(vector,post.recommendationVisual!.vector)>=.8);
      if(!knownAuthor&&!visualMatch&&!preferences.followedTopics.some(topic=>relevance.has(topic)))return false;
    }
    if((preferences.followedTopics?.includes('art')||preferences.followedTopics?.includes('digital-illustration'))&&!preferences.followedTopics.includes('ai')&&(post.imageUrls.length>0||post.parentPost?.imageUrls.length)&& (isDeclaredGeneratedArt(post)||(post.parentPost&&isDeclaredGeneratedArt(post.parentPost))))return false;
    // A genuine view suppresses this work on later fetches, including refreshes.
    if(deliveries[identity]||fingerprint&&deliveredFingerprints.has(fingerprint))return false;
    if(post.likedByMe || likedIds.has(post.id) || (impressions[identity]?.count ?? 0)>=1 || (fingerprint&&(impressions[fingerprint]?.count??0)>=1))return false;
    if(ids.has(post.id)) return false;
    ids.add(post.id);
    if(fingerprint&&contents.has(fingerprint))return false;
    if(fingerprint)contents.add(fingerprint);
    return true;
  });
  const termCache=new Map([...unique,...history].map(post=>[post.id,[...recommendationTerms(recommendationText(post)),...recommendationTopicSignals(post).map(id=>`topic:${id}`)]]));
  const counts:Record<string,number>={};
  for(const post of unique) for(const term of recommendationTerms(recommendationText(post))) counts[term]=(counts[term] ?? 0)+1;
  const idf=Object.fromEntries(Object.entries(counts).map(([term,count])=>[term,1+Math.log((unique.length+1)/(count+1))]));
  const scoring=prepareScoringContext(preferences,idf,now,impressions);
  const candidates=unique.map(post=>({post,score:scoreRecommendation(post,preferences,viewerId,scoring).total,terms:termCache.get(post.id)!}));
  const seedAuthors=new Set(Object.entries(preferences.authors).filter(([,weight])=>weight>0).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>id));
  const anchors=preferences.likedSamples??[];
  const relatedScores=new Map(unique.map(post=>[post.id,relatedRecommendationScore(post,anchors,preferences,feedback)]));
  const result:PostWithAuthor[]=[];
  while(candidates.length&&result.length<rankLimit) {
    const recent=[...history.slice(-6),...result].slice(-6);
    // Three opportunities in each 20-post page retain the main preference
    // while introducing other relevant creators. Never fill them with random
    // or negatively rated work just to satisfy a quota.
    const explore=seedAuthors.size>0&&[5,11,17].includes((history.length+result.length)%20);
    const recentAuthors=new Set([...history,...result.slice(-19)].map(post=>post.userId));
    const related=candidates.filter(candidate=>!seedAuthors.has(candidate.post.userId)&&!recentAuthors.has(candidate.post.userId)&&candidate.score>0&&(relatedScores.get(candidate.post.id)??0)>0&&!feedback.some(row=>row.userId===candidate.post.userId));
    const exploring=explore&&related.length>0;
    const relatedIds=new Set(related.map(candidate=>candidate.post.id));
    let best=0,bestScore=-Infinity;
    const hasPositive=candidates.some(candidate=>candidate.score>0);
    candidates.forEach((candidate,index)=>{
      if(hasPositive&&candidate.score<=0)return;
      if(exploring&&!relatedIds.has(candidate.post.id))return;
      const sameAuthor=recent.filter(p=>p.userId===candidate.post.userId).length;
      const window=[...history,...result.slice(-19)].slice(-19);
      const sources=candidate.post.recommendationSources??[];
      const sameSource=window.filter(post=>post.recommendationSources?.some(source=>sources.includes(source))).length;
      const sameCreator=window.filter(post=>post.userId===candidate.post.userId).length;
      // Visual neighbours reveal near-identical subject/composition even when
      // captions, tags, creators and feed IDs differ.
      const similarImage=candidate.post.recommendationVisual?recent.slice(-4).reduce((count,post)=>count+(post.recommendationVisual&&visualSimilarity(post.recommendationVisual.vector,candidate.post.recommendationVisual!.vector)>.9?1:0),0):0;
      // Preserve the LimeNote / external balance when another external provider
      // is added; treating every provider as a new slot dilutes native posts.
      const external=(post:PostWithAuthor)=>post.source==='bluesky' || post.source==='misskey' || post.id.startsWith('bsky:') || post.id.startsWith('misskey:');
      const sameService=recent.slice(-2).filter(p=>external(p)===external(candidate.post)).length;
      const overlap=recent.slice(-3).reduce((max,p)=>{
        const terms=termCache.get(p.id) ?? [];
        const common=candidate.terms.filter(term=>terms.includes(term)).length;
        return Math.max(max,common/Math.max(1,new Set([...terms,...candidate.terms]).size));
      },0);
      // Diversity must not outweigh relevance and promote a weak match over
      // a strongly preferred creator. Discovery has its own bounded slots.
      const diversityPenalty=Math.min(24,12*sameAuthor+10*sameCreator)+Math.min(32,8*sameSource)+Math.min(32,16*similarImage)+(sameService===2?16:0)+3*overlap;
      const adjusted=candidate.score+(exploring?12*(relatedScores.get(candidate.post.id)??0):0)-diversityPenalty;
      if(adjusted>bestScore) {bestScore=adjusted;best=index;}
    });
    result.push(candidates.splice(best,1)[0].post);
  }
  return [...result,...candidates.map(candidate=>candidate.post)];
}
const preferenceKey=(viewerId:string|null)=>`lime_recommendation_likes:${viewerId ?? 'guest'}`;
export function readRecommendationLikes(viewerId:string|null):(PostWithAuthor & {engagedAt?:string})[] {
  try { const data=JSON.parse(localStorage.getItem(preferenceKey(viewerId)) ?? '[]'); return Array.isArray(data)?applyCachedRecommendationVisuals(data.filter(p=>p && typeof p.id==='string' && typeof p.content==='string').slice(0,100)):[]; } catch {return [];}
}
const likedIdsKey=(viewerId:string|null)=>`lime_recommendation_liked_ids:${viewerId ?? 'guest'}`;
export function readRecommendationLikedIds(viewerId:string|null):string[] {
  try {
    const data=JSON.parse(localStorage.getItem(likedIdsKey(viewerId)) ?? '[]');
    return Array.isArray(data)?data.filter((id):id is string=>typeof id==='string').slice(0,3000):[];
  } catch {return [];}
}
export function recordRecommendationLike(post:PostWithAuthor,liked:boolean,viewerId:string|null,eventAt?:string) {
  // Consumed IDs outlive the small content sample used to learn current interests.
  try {
    const ids=readRecommendationLikedIds(viewerId).filter(id=>id!==post.id);
    if(liked) ids.unshift(post.id);
    localStorage.setItem(likedIdsKey(viewerId),JSON.stringify(ids.slice(0,3000)));
  } catch { /* A like must succeed even when local storage is unavailable. */ }
  try {
    const current=readRecommendationLikes(viewerId).filter(p=>p.id!==post.id);
    const old=readRecommendationLikes(viewerId).find(row=>row.id===post.id);
    const sample={...old,...post,author:post.author??old?.author,imageUrls:post.imageUrls??old?.imageUrls};
    if(liked) current.unshift({id:post.id,userId:sample.userId,content:sample.content||old?.content||'',source:sample.source,imageUrls:sample.imageUrls,languages:sample.languages,recommendationLanguages:recommendationOriginLanguages(sample),imageAltTexts:sample.imageAltTexts,recommendationVisual:sample.recommendationVisual??(sample.imageUrls?.[0]?readVisualCache(sample.imageUrls[0]):undefined),author:{id:sample.userId,bio:sample.author?.bio,displayName:sample.author?.displayName},recommendationTopics:sample.recommendationVisual?.topics??recommendationTopicSignals(sample),engagedAt:eventAt??new Date().toISOString()} as PostWithAuthor & {engagedAt:string});
    localStorage.setItem(preferenceKey(viewerId),JSON.stringify(current.slice(0,100)));
  } catch { /* A disabled/full local store must not fail a successful like. */ }
}
