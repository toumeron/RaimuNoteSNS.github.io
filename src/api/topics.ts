import type {RecommendationFeedback} from '@/lib/recommendations';
import {supabase} from '@/lib/supabase';
import {isTopicId,type TopicId,type TopicPreferences} from '@/lib/topics';
export const topicsKey=(userId:string|null|undefined)=>['topic-preferences',userId] as const;
export async function getTopicPreferences(userId:string):Promise<TopicPreferences & {recommendationFeedback:RecommendationFeedback[]}> {
 const {data,error}=await supabase.from('profile_private_settings').select('followed_topics,dismissed_topics,recommendation_feedback').eq('user_id',userId).maybeSingle();
 if(error)throw error;
 return {followed:(data?.followed_topics??[]).filter(isTopicId),dismissed:(data?.dismissed_topics??[]).filter(isTopicId),recommendationFeedback:Array.isArray(data?.recommendation_feedback)?data.recommendation_feedback:[]};
}
export async function updateTopicPreferences(ids:TopicId[],status:'follow'|'dismiss'|'clear'):Promise<void> {
 const {error}=await supabase.rpc('update_topic_preferences',{topic_ids:ids,disposition:status});
 if(error)throw error;
}
