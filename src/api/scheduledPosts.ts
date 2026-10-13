import {supabase} from '@/lib/supabase';
import type {ScheduledPost} from '@/lib/postSchedule';
export async function getScheduledPosts():Promise<ScheduledPost[]> {const {data,error}=await supabase.rpc('get_scheduled_posts');if(error)throw error;return data??[];}
export async function cancelScheduledPost(id:string) {const {error}=await supabase.rpc('cancel_scheduled_post',{post_id:id});if(error)throw error;}
export async function reschedulePost(id:string,sendAt:string) {const {error}=await supabase.rpc('save_scheduled_post',{post_id:id,send_at:sendAt});if(error)throw error;}
