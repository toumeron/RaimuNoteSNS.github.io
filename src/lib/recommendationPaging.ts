import {recommendationIdentity,recommendationFingerprint} from './recommendationSignals';
import type {PostWithAuthor} from '@/types';
import type {RecommendationCursor} from '@/api/recommendations';

export function preserveRecommendationHistory(cursor:RecommendationCursor,shown:PostWithAuthor[]):RecommendationCursor {
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
export function uniqueRecommendationPosts(posts:PostWithAuthor[],shown:PostWithAuthor[]=[]):PostWithAuthor[] {
 const seen=new Set(shown.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]));
 return posts.filter(post=>{
  const id=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
  if(seen.has(id)||fingerprint&&seen.has(fingerprint))return false;
  seen.add(id);if(fingerprint)seen.add(fingerprint);return true;
 });
}
