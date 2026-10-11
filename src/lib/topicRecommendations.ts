import {matchingTopics,type TopicId} from './topics';
import {recommendationText} from './recommendationSignals';
import {recommendationIdentity,recommendationFingerprint} from "@/lib/recommendationSignals";
import {recommendationIsDismissed,recommendationTerms,type RecommendationPreferences} from './recommendations';
import {recommendationIsEligible} from "@/lib/recommendationSignals";
import type {PostWithAuthor} from '@/types';

/** Content evidence outranks retrieval hints; a creator's bio is not post evidence. */
export function topicPostRelevance(post:PostWithAuthor,topic:TopicId):number {
 const visual=post.recommendationVisual;
 if(visual?.kind!=='unknown'&&visual?.topics.length&&!visual.topics.includes(topic)&&!matchingTopics(post.content).includes(topic))return 0;
 if(visual?.topics.includes(topic)&&visual.confidence>=.6)return 3;
 if(matchingTopics(recommendationText(post)).includes(topic))return 2;
 return post.recommendationTopics?.includes(topic)?1:0;
}
/** Topic-only ranking. It deliberately does not consume the general feed's delivered history. */
export function rankTopicPosts(posts:PostWithAuthor[],topic:TopicId,preferences:RecommendationPreferences,now:number):PostWithAuthor[] {
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
