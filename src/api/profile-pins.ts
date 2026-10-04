import {supabase} from '@/lib/supabase';
export const profilePinKey=(userId:string)=>['profile-pin',userId];
export async function getProfilePin(userId:string):Promise<string|null>{
  const {data,error}=await supabase.from('profile_pins').select('post_id').eq('user_id',userId).maybeSingle();
  if(error)throw error;return data?.post_id??null;
}
export async function setProfilePin(userId:string,postId:string|null):Promise<void>{
  const result=postId?await supabase.from('profile_pins').upsert({user_id:userId,post_id:postId},{onConflict:'user_id'}):await supabase.from('profile_pins').delete().eq('user_id',userId);
  if(result.error)throw result.error;
}
