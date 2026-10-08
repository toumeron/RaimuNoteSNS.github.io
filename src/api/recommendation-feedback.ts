import {supabase} from '@/lib/supabase';
import type {PostWithAuthor} from '@/types';
import type {RecommendationFeedback} from '@/lib/recommendations';
import {recommendationIdentity,recommendationFingerprint} from '@/lib/recommendationIdentity';
import {recommendationTopicSignals} from '@/lib/recommendationSignals';
export function createRecommendationFeedback(post:PostWithAuthor):RecommendationFeedback {
 return {id:recommendationIdentity(post),userId:post.userId,fingerprint:recommendationFingerprint(post)??undefined,topics:post.recommendationVisual?.topics??recommendationTopicSignals(post),vector:post.recommendationVisual?.vector,imageUrls:post.imageUrls.slice(0,4),visualKind:post.recommendationVisual?.kind,createdAt:new Date().toISOString()};
}
export async function dismissRecommendation(post:PostWithAuthor):Promise<RecommendationFeedback>{
 const feedback=createRecommendationFeedback(post);
 const {error}=await supabase.rpc('dismiss_recommendation',{feedback});if(error)throw error;return feedback;
}

/** Enrich only an existing dismissal; preserve its date and never recreate one. */
export async function enrichRecommendationFeedback(post:PostWithAuthor){
 if(!post.recommendationVisual)return;
 const {error}=await supabase.rpc('dismiss_recommendation',{feedback:{enrichment:true,id:recommendationIdentity(post),userId:post.userId,vector:post.recommendationVisual.vector,visualKind:post.recommendationVisual.kind,imageUrls:post.imageUrls.slice(0,4)}});
 if(error)throw error;
}
