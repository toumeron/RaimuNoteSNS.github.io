import { supabase } from "@/lib/supabase";

export const profileHighlightsKey = (userId: string) => ['posts', 'highlights', userId] as const;
export const postHighlightKey = (userId: string, postId: string) => ['post-highlight', userId, postId] as const;

export async function isPostHighlighted(userId: string, postId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profile_highlights')
    .select('post_id').eq('user_id', userId).eq('post_id', postId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function setPostHighlighted(userId: string, postId: string, highlighted: boolean): Promise<void> {
  const result = highlighted
    ? await supabase.from('profile_highlights').upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true })
    : await supabase.from('profile_highlights').delete().eq('user_id', userId).eq('post_id', postId);
  if (result.error) throw result.error;
}

export const profilePinKey=(userId:string)=>['profile-pin',userId];
export async function getProfilePin(userId:string):Promise<string|null>{
  const {data,error}=await supabase.from('profiles').select('pinned_post_id').eq('id',userId).maybeSingle();
  if(error)throw error;return data?.pinned_post_id??null;
}
export async function setProfilePin(userId:string,postId:string|null):Promise<void>{
  const result=await supabase.from('profiles').update({pinned_post_id:postId}).eq('id',userId).select('id').single();
  if(result.error)throw result.error;
}
