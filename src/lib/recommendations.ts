import type { PostWithAuthor } from '@/types';

export type RecommendationPreferences = {
  authors: Record<string, number>;
  terms: Record<string, number>;
  recentAuthors?: Record<string, number>;
  recentTerms?: Record<string, number>;
  followedAuthors?: string[];
  likedPostIds?: string[];
};
const stopWords = new Set(['です','ます','した','して','する','ある','いる','これ','それ','ため','さん','こと','よう','今日','昨日','今回','自分','本当','こちら','みんな','https','http','www','com','the','and','with','this','that']);
const concepts = [
  ['cats','猫','ねこ','ネコ','cat','cats','kitten'],
  ['dogs','犬','いぬ','イヌ','dog','dogs','puppy'],
  ['art','イラスト','絵','お絵描き','illustration','drawing'],
  ['music','音楽','楽曲','music','ライブ','コンサート'],
  ['programming','プログラミング','開発','typescript','javascript','python','coding'],
];
export function recommendationTerms(content: string): string[] {
  const text=content.replace(/https?:\/\/\S+/g,' ').normalize('NFKC').toLowerCase();
  const Segmenter=(Intl as any).Segmenter;
  const words: string[]=Segmenter ? [...new Segmenter('ja',{granularity:'word'}).segment(text)].filter((s:any)=>s.isWordLike).map((s:any)=>s.segment) : text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms=[...new Set(words.filter(word=>!stopWords.has(word) && !/^\d+$/.test(word) && (word.length>1 || /\p{Script=Han}/u.test(word))))].slice(0,64);
  for(const [concept,...aliases] of concepts) if(aliases.some(alias=>terms.includes(alias))) terms.push(`topic:${concept}`);
  return terms;
}
export function addRecommendationInterest(preferences: RecommendationPreferences, post: {content?:string;userId?:string;user_id?:string;author?:{id?:string}}, weight:number, eventAt?:string, now=Date.now()) {
  const timestamp=eventAt ? Date.parse(eventAt) : now;
  const age=Number.isFinite(timestamp)?Math.max(0,(now-timestamp)/86400000):30;
  const longWeight=weight*Math.pow(0.5,age/60);
  const recentWeight=weight*Math.pow(0.5,age/7);
  preferences.recentAuthors ??= {};
  preferences.recentTerms ??= {};
  const author=post.userId ?? post.user_id ?? post.author?.id;
  if(author) {
    preferences.authors[author]=(preferences.authors[author] ?? 0)+longWeight;
    preferences.recentAuthors[author]=(preferences.recentAuthors[author] ?? 0)+recentWeight;
  }
  const terms=recommendationTerms(post.content ?? '');
  // Normalize each event so verbose posts cannot dominate the user's profile.
  const lengthWeight=1/Math.sqrt(Math.max(1,terms.length));
  for(const term of terms) {
    preferences.terms[term]=(preferences.terms[term] ?? 0)+longWeight*lengthWeight;
    preferences.recentTerms[term]=(preferences.recentTerms[term] ?? 0)+recentWeight*lengthWeight;
  }
}
export function recommendationQueries(preferences:RecommendationPreferences):string[] {
  return Object.entries(preferences.terms).filter(([term])=>!term.startsWith('topic:'))
    .sort((a,b)=>(b[1]+(preferences.recentTerms?.[b[0]] ?? 0))-(a[1]+(preferences.recentTerms?.[a[0]] ?? 0)))
    .slice(0,3).map(([term])=>term);
}
type Impression={at:number;count:number};
const impressionKey=(viewerId:string|null)=>`lime_recommendation_impressions:${viewerId ?? 'guest'}`;
export function readRecommendationImpressions(viewerId:string|null,now=Date.now()):Record<string,Impression> {
  try {
    const data:Record<string,Impression>=JSON.parse(localStorage.getItem(impressionKey(viewerId)) ?? '{}');
    return Object.fromEntries(Object.entries(data).filter(([,row]:[string,any])=>row && Number.isFinite(row.at) && row.at<=now && now-row.at<30*86400000 && Number.isFinite(row.count)));
  } catch {return {};}
}
export function recordRecommendationImpression(id:string,viewerId:string|null,now=Date.now()) {
  try {
    const data=readRecommendationImpressions(viewerId,now);
    data[id]={at:now,count:Math.min(10,(data[id]?.count ?? 0)+1)};
    const rows=Object.entries(data).sort((a,b)=>b[1].at-a[1].at).slice(0,2000);
    localStorage.setItem(impressionKey(viewerId),JSON.stringify(Object.fromEntries(rows)));
  } catch { /* Storage is optional; never interrupt browsing. */ }
}
function cosine(terms:string[],profile:Record<string,number>,idf:Record<string,number>):number {
  const strongest=Object.entries(profile).filter(([,weight])=>weight>0).sort((a,b)=>b[1]-a[1]).slice(0,96);
  const vector=Object.fromEntries(strongest.map(([term,weight])=>[term,Math.log1p(weight)*(idf[term] ?? 1)]));
  let dot=0,candidateNorm=0;
  for(const term of terms) {const weight=idf[term] ?? 1;dot+=weight*(vector[term] ?? 0);candidateNorm+=weight*weight;}
  const profileNorm=Object.values(vector).reduce((sum,value)=>sum+value*value,0);
  return candidateNorm && profileNorm ? dot/Math.sqrt(candidateNorm*profileNorm):0;
}
export type RecommendationScore = {
  interest:number;recentInterest:number;author:number;follow:number;freshness:number;quality:number;seenPenalty:number;spamPenalty:number;selfPenalty:number;total:number;
};
export function scoreRecommendation(post:PostWithAuthor,preferences:RecommendationPreferences,viewerId:string|null,context:{idf?:Record<string,number>;impressions?:Record<string,Impression>;now?:number}={}):RecommendationScore {
  const now=context.now ?? Date.now();
  const terms=recommendationTerms(`${post.content} ${post.parentPost?.content ?? ''}`);
  const timestamp=Date.parse(post.createdAt);
  const age=Number.isFinite(timestamp)?Math.max(0,(now-timestamp)/3600000):168;
  const interest=cosine(terms,preferences.terms,context.idf ?? {});
  const recentInterest=cosine(terms,preferences.recentTerms ?? preferences.terms,context.idf ?? {});
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
  return {interest,recentInterest,author,follow,freshness,quality,seenPenalty,spamPenalty,selfPenalty,
    total:30*interest+36*recentInterest+14*author+8*follow+8*freshness+4*quality-seenPenalty-spamPenalty-selfPenalty};
}
export function rankRecommendations(posts:PostWithAuthor[], preferences:RecommendationPreferences, viewerId:string|null, now=Date.now(), history:PostWithAuthor[]=[]):PostWithAuthor[] {
  const impressions=readRecommendationImpressions(viewerId,now);
  const likedIds=new Set([...(preferences.likedPostIds ?? []),...readRecommendationLikes(viewerId).map(post=>post.id),...readRecommendationLikedIds(viewerId)]);
  const ids=new Set<string>(),contents=new Set<string>();
  const unique=posts.filter(post=>{
    // Up to three actual views are allowed; liked posts are already consumed.
    if(post.likedByMe || likedIds.has(post.id) || (impressions[post.id]?.count ?? 0)>=3) return false;
    if(ids.has(post.id)) return false;
    ids.add(post.id);
    const fingerprint=post.content.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()+post.imageUrls.join('|');
    if(fingerprint.length>=32 && contents.has(fingerprint)) return false;
    if(fingerprint.length>=32) contents.add(fingerprint);
    return true;
  });
  const termCache=new Map([...unique,...history].map(post=>[post.id,recommendationTerms(post.content)]));
  const counts:Record<string,number>={};
  for(const post of unique) for(const term of recommendationTerms(`${post.content} ${post.parentPost?.content ?? ''}`)) counts[term]=(counts[term] ?? 0)+1;
  const idf=Object.fromEntries(Object.entries(counts).map(([term,count])=>[term,1+Math.log((unique.length+1)/(count+1))]));
  const candidates=unique.map(post=>({post,score:scoreRecommendation(post,preferences,viewerId,{idf,impressions,now}).total,terms:termCache.get(post.id)!}));
  const result:PostWithAuthor[]=[];
  while(candidates.length) {
    const recent=[...history.slice(-6),...result].slice(-6);
    let best=0,bestScore=-Infinity;
    candidates.forEach((candidate,index)=>{
      const sameAuthor=recent.filter(p=>p.userId===candidate.post.userId).length;
      const sameService=recent.slice(-2).filter(p=>p.id.startsWith('bsky:')===candidate.post.id.startsWith('bsky:')).length;
      const overlap=recent.slice(-3).reduce((max,p)=>{
        const terms=termCache.get(p.id) ?? [];
        const common=candidate.terms.filter(term=>terms.includes(term)).length;
        return Math.max(max,common/Math.max(1,new Set([...terms,...candidate.terms]).size));
      },0);
      const adjusted=candidate.score-12*sameAuthor-(sameService===2?16:0)-6*overlap;
      if(adjusted>bestScore) {bestScore=adjusted;best=index;}
    });
    result.push(candidates.splice(best,1)[0].post);
  }
  return result;
}
const preferenceKey=(viewerId:string|null)=>`lime_recommendation_likes:${viewerId ?? 'guest'}`;
export function readRecommendationLikes(viewerId:string|null):(PostWithAuthor & {engagedAt?:string})[] {
  try { const data=JSON.parse(localStorage.getItem(preferenceKey(viewerId)) ?? '[]'); return Array.isArray(data)?data.filter(p=>p && typeof p.id==='string' && typeof p.content==='string').slice(0,100):[]; } catch {return [];}
}
const likedIdsKey=(viewerId:string|null)=>`lime_recommendation_liked_ids:${viewerId ?? 'guest'}`;
export function readRecommendationLikedIds(viewerId:string|null):string[] {
  try {
    const data=JSON.parse(localStorage.getItem(likedIdsKey(viewerId)) ?? '[]');
    return Array.isArray(data)?data.filter((id):id is string=>typeof id==='string').slice(0,3000):[];
  } catch {return [];}
}
export function recordRecommendationLike(post:PostWithAuthor,liked:boolean,viewerId:string|null) {
  // Consumed IDs outlive the small content sample used to learn current interests.
  try {
    const ids=readRecommendationLikedIds(viewerId).filter(id=>id!==post.id);
    if(liked) ids.unshift(post.id);
    localStorage.setItem(likedIdsKey(viewerId),JSON.stringify(ids.slice(0,3000)));
  } catch { /* A like must succeed even when local storage is unavailable. */ }
  try {
    const current=readRecommendationLikes(viewerId).filter(p=>p.id!==post.id);
    if(liked) current.unshift({id:post.id,userId:post.userId,content:post.content,engagedAt:new Date().toISOString()} as PostWithAuthor & {engagedAt:string});
    localStorage.setItem(preferenceKey(viewerId),JSON.stringify(current.slice(0,100)));
  } catch { /* A disabled/full local store must not fail a successful like. */ }
}
