import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import type { PostWithAuthor } from '@/types';

export const isReplyPostId = (id: string) => id.startsWith('reply:');
export const REPLY_REPOST_SELECT = `*, profiles:user_id(*), post:post_id(user_id, profiles:user_id(username)), replying_to:parent_comment_id(profiles:user_id(username))`;

/** The source post's RLS determines visibility before converting a reply. */
export function replyToPost(reply: any): PostWithAuthor {
  const author = reply.author ?? reply.profiles ?? {};
  return {
    id: `reply:${reply.id}`, replyId: reply.id, replyPostId: reply.postId ?? reply.post_id,
    replyToUsername: reply.replying_to?.profiles?.username ?? reply.post?.profiles?.username ?? reply.replyToUsername,
    userId: reply.userId ?? reply.user_id ?? author.id,
    content: reply.content ?? '', imageUrls: reply.imageUrls ?? reply.image_urls ?? [],
    createdAt: reply.createdAt ?? reply.created_at, clientName:reply.clientName ?? reply.client_name, visibility:'public',
    likesCount: Number(reply.likesCount ?? reply.likes_count ?? 0), likedByMe: Boolean(reply.likedByMe),
    commentsCount: Number(reply.commentsCount ?? reply.comments_count ?? 0),
    repostsCount: Number(reply.repostsCount ?? 0), repostedByMe: Boolean(reply.repostedByMe),
    author: {id:author.id, username:author.username ?? '', displayName:author.displayName ?? author.display_name ?? author.username ?? '',
      avatarUrl:author.avatarUrl ?? author.avatar_url ?? '',bio:author.bio ?? '', coverUrl:author.coverUrl ?? author.cover_url ?? '',
      createdAt:author.createdAt ?? author.created_at ?? '',isOfficial:author.isOfficial ?? author.is_official ?? false},
  };
}

export async function getReplyRepostState(id: string) {
  const commentId = id.replace(/^reply:/,'');
  const viewer = await getCurrentUserId();
  const [shares,quotes,own] = await Promise.all([
    supabase.from('reply_reposts').select('*',{count:'exact',head:true}).eq('comment_id',commentId),
    supabase.from('posts').select('*',{count:'exact',head:true}).eq('quoted_reply_id',commentId),
    viewer ? supabase.from('reply_reposts').select('comment_id').eq('comment_id',commentId).eq('user_id',viewer).maybeSingle() : Promise.resolve({data:null,error:null}),
  ]);
  if(shares.error) throw shares.error;
  if(quotes.error) throw quotes.error;
  if(own.error) throw own.error;
  return {repostsCount:(shares.count ?? 0)+(quotes.count ?? 0),repostedByMe:Boolean(own.data)};
}

export async function getReplyPost(id: string): Promise<PostWithAuthor | null> {
  const result = await supabase.from('comments').select(REPLY_REPOST_SELECT).eq('id',id.replace(/^reply:/,'')).single();
  if(result.error || !result.data) return null;
  const post=replyToPost(result.data);
  const [state,viewer]=await Promise.all([getReplyRepostState(id),getCurrentUserId()]);
  const like=viewer ? await supabase.from('comment_likes').select('user_id').eq('comment_id',post.replyId).eq('user_id',viewer).maybeSingle() : {data:null};
  return {...post,...state,likedByMe:Boolean(like.data)};
}

export async function toggleReplyRepost(id: string) {
  const viewer=await getCurrentUserId();
  if(!viewer) throw new Error('ログインが必要です');
  const commentId=id.replace(/^reply:/,'');
  const own=await supabase.from('reply_reposts').select('comment_id').eq('comment_id',commentId).eq('user_id',viewer).maybeSingle();
  if(own.error) throw own.error;
  const result=own.data ? await supabase.from('reply_reposts').delete().eq('comment_id',commentId).eq('user_id',viewer)
    : await supabase.from('reply_reposts').insert({comment_id:commentId,user_id:viewer});
  if(result.error) throw result.error;
  try { return {reposted:!own.data,repostsCount:(await getReplyRepostState(id)).repostsCount}; }
  catch { return {reposted:!own.data}; }
}

export async function getProfileReplyReposts(userId:string,limit:number):Promise<PostWithAuthor[]> {
  const result=await supabase.from('reply_reposts').select(`created_at, comments!inner(${REPLY_REPOST_SELECT})`)
    .eq('user_id',userId).order('created_at',{ascending:false}).order('comment_id',{ascending:false}).range(0,limit-1);
  if(result.error) throw result.error;
  return (result.data ?? []).map((row:any)=>({...replyToPost(row.comments),profileRepostedBy:userId,profileRepostedAt:row.created_at}));
}
