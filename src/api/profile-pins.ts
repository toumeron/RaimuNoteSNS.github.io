import {supabase} from '@/lib/supabase';
export const profilePinKey=(userId:string)=>['profile-pin',userId];
export async function getProfilePin(userId:string):Promise<string|null>{
  const {data,error}=await supabase.from('profiles').select('pinned_post_id').eq('id',userId).maybeSingle();
  if(error)throw error;return data?.pinned_post_id??null;
}
export async function setProfilePin(userId:string,postId:string|null):Promise<void>{
  const result=await supabase.from('profiles').update({pinned_post_id:postId}).eq('id',userId).select('id').single();
  if(result.error)throw result.error;
}
