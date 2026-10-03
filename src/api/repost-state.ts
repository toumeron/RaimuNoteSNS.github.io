import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
export async function getNativeRepostState(postId:string) {
  const viewer=await getCurrentUserId();
  const [post,own]=await Promise.all([
    supabase.from('posts').select('reposts_count').eq('id',postId).single(),
    viewer ? supabase.from('reposts').select('post_id').eq('post_id',postId).eq('user_id',viewer).maybeSingle() : Promise.resolve({data:null,error:null}),
  ]);
  if(post.error) throw post.error;
  if(own.error) throw own.error;
  return {repostsCount:Number(post.data?.reposts_count ?? 0),repostedByMe:Boolean(own.data)};
}
