import {recommendationIdentity,recommendationFingerprint} from './recommendationSignals';
import type {PostWithAuthor} from '@/types';
import type {RecommendationCursor} from '@/api/recommendations';

export function preserveRecommendationHistory(cursor:RecommendationCursor,shown:PostWithAuthor[]):RecommendationCursor {
 const seen=[...new Set([...cursor.seen,...shown.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])])])];
 return {...cursor,seen,history:cursor.history.length?cursor.history:shown.slice(-20)};
}
export function uniqueRecommendationPosts(posts:PostWithAuthor[],shown:PostWithAuthor[]=[]):PostWithAuthor[] {
 const seen=new Set(shown.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]));
 return posts.filter(post=>{
  const id=recommendationIdentity(post),fingerprint=recommendationFingerprint(post);
  if(seen.has(id)||fingerprint&&seen.has(fingerprint))return false;
  seen.add(id);if(fingerprint)seen.add(fingerprint);return true;
 });
}
