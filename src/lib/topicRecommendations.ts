import { matchingTopics, type TopicId } from "@/lib/topics";
import { recommendationText, recommendationIdentity, recommendationFingerprint, recommendationIsEligible } from "@/lib/recommendationSignals";
import { recommendationIsDismissed, recommendationTerms, type RecommendationPreferences } from "@/lib/recommendations";
import { type PostWithAuthor } from "@/types/index";
import { type RecommendationCursor } from "@/api/recommendations";
import { type getBalancedRecommendationPage } from "@/api/balanced-recommendations";
import { restoreRecommendationVisuals, visualMatchesRecommendationTopic } from "@/lib/recommendationVisual";

// topicRecommendations
/** Content evidence outranks retrieval hints; a creator's bio is not post evidence. */
function topicPostRelevance(post:PostWithAuthor,topic:TopicId):number {
 const visual=post.recommendationVisual;
 if(visual?.kind!=='unknown'&&visual?.topics.length&&!visual.topics.includes(topic)&&!matchingTopics(post.content).includes(topic))return 0;
 if(visual?.topics.includes(topic)&&visual.confidence>=.6)return 3;
 if(matchingTopics(recommendationText(post)).includes(topic))return 2;
 return post.recommendationTopics?.includes(topic)?1:0;
}
/** Topic-only ranking. It deliberately does not consume the general feed's delivered history. */
function rankTopicPosts(posts:PostWithAuthor[],topic:TopicId,preferences:RecommendationPreferences,now:number):PostWithAuthor[] {
 const ids=new Set<string>(),fingerprints=new Set<string>();
 const score=(post:PostWithAuthor)=>{
  const age=Math.max(0,now-Date.parse(post.createdAt))/3600000;
  const affinity=Math.max(0,preferences.authors[post.userId]??0);
  const engagement=Math.log1p(Math.max(0,post.likesCount)+2*Math.max(0,post.repostsCount)+Math.max(0,post.commentsCount));
  const interest=recommendationTerms(recommendationText(post)).reduce((sum,term)=>sum+Math.log1p(Math.max(0,preferences.terms[term]??0)+Math.max(0,preferences.recentTerms?.[term]??0)),0);
  return topicPostRelevance(post,topic)*100+Math.min(8,interest)+Math.min(8,Math.log1p(affinity)*2)+Math.min(6,engagement)+5*Math.exp(-(Number.isFinite(age)?age:720)/72);
 };
 return posts.filter(post=>{
  const id=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
  if(ids.has(id)||fingerprint&&fingerprints.has(fingerprint)||!topicPostRelevance(post,topic)||!recommendationIsEligible(post,[topic])||recommendationIsDismissed(post,{...preferences,dismissedTopics:preferences.dismissedTopics?.filter(id=>id!==topic)}))return false;
  ids.add(id);if(fingerprint)fingerprints.add(fingerprint);return true;
 }).sort((a,b)=>score(b)-score(a)||b.createdAt.localeCompare(a.createdAt)||recommendationIdentity(a).localeCompare(recommendationIdentity(b)));
}

// recommendationPaging
function preserveRecommendationHistory(cursor:RecommendationCursor,shown:PostWithAuthor[]):RecommendationCursor {
 const seen=[...new Set([...cursor.seen,...shown.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])])])];
 const allCounts={...(cursor.authorCounts??{})},shownCounts:Record<string,number>={};
 for(const post of shown)shownCounts[post.userId]=(shownCounts[post.userId]??0)+1;
 for(const [actor,count] of Object.entries(shownCounts))allCounts[actor]=Math.max(allCounts[actor]??0,count);
 const counts={...(cursor.twitterAuthorCounts??{})},handles={...(cursor.twitterAuthorHandles??{})},visibleCounts:Record<string,number>={};
 for(const post of shown)if(post.source==='x'||post.id.startsWith('x:')){visibleCounts[post.userId]=(visibleCounts[post.userId]??0)+1;handles[post.userId]=post.author.username;}
 for(const [actor,count] of Object.entries(visibleCounts))counts[actor]=Math.max(counts[actor]??0,count);
 const twitter=shown.filter(post=>post.source==='x'||post.id.startsWith('x:')).length;
 return {...cursor,seen,authorCounts:allCounts,twitterAuthorCounts:counts,twitterAuthorHandles:handles,history:shown.slice(-20),providerTotals:{twitter,other:shown.length-twitter}};
}
function uniqueRecommendationPosts(posts:PostWithAuthor[],shown:PostWithAuthor[]=[]):PostWithAuthor[] {
 const seen=new Set(shown.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]));
 return posts.filter(post=>{
  const id=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
  if(seen.has(id)||fingerprint&&seen.has(fingerprint))return false;
  seen.add(id);if(fingerprint)seen.add(fingerprint);return true;
 });
}

// recommendationReserve
type Page=Awaited<ReturnType<typeof getBalancedRecommendationPage>>;
const KEY='lime-recommendation-reserve-v2';
const MAX_AGE=120_000;
/** Only an unconsumed, accepted reserve is persisted, scoped to the active account and sources. */
function readRecommendationReserve(scope:string):Page|undefined{
 try{
  const entry=JSON.parse(sessionStorage.getItem(KEY)??'null');
  if(!entry||entry.scope!==scope||Date.now()-entry.at>MAX_AGE||Date.now()<entry.at)return;
  const page=entry.page;
  if(!Array.isArray(page?.posts)||page.posts.length<20||!page.preferences?.authors||!page.preferences?.terms)return;
  if(!page.posts.every((post:any)=>typeof post.id==='string'&&typeof post.userId==='string'&&post.author&&Array.isArray(post.imageUrls)))return;
  if(page.next&&(!Array.isArray(page.next.remaining)||!Array.isArray(page.next.seen)||!Array.isArray(page.next.history)))return;
  const posts=restoreRecommendationVisuals(page.posts);
  if(posts.some(post=>{const visual=post.recommendationVisual;return !visual||['unknown','render-3d','vehicle'].includes(visual.kind)||visual.confidence<.25||visual.similarity<.24||page.preferences.followedTopics?.length&&!page.preferences.followedTopics.some((topic:any)=>visualMatchesRecommendationTopic(visual,topic));}))return;
  return {...page,posts,preferences:{...page.preferences,visualOnly:true,allowUnverifiedMedia:false,likedSamples:restoreRecommendationVisuals(page.preferences.likedSamples??[])}};
 }catch{return;}
}
function saveRecommendationReserve(scope:string,page:Page){
 if(page.posts.length<20)return;
 try{sessionStorage.setItem(KEY,JSON.stringify({scope,at:Date.now(),page}));}catch{}
}
function clearRecommendationReserve(){try{sessionStorage.removeItem(KEY);sessionStorage.removeItem('lime-recommendation-reserve-v1');}catch{}}

export { topicPostRelevance };
export { rankTopicPosts };
export { preserveRecommendationHistory };
export { uniqueRecommendationPosts };
export { readRecommendationReserve };
export { saveRecommendationReserve };
export { clearRecommendationReserve };
