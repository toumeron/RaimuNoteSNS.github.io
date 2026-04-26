import type { CommentWithAuthor } from '@/types';
import type { User } from '@/types';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(profile: any): User {
  return {
    id:          profile.id,
    username:    profile.username    ?? '',
    displayName: profile.display_name ?? '',
    bio:         profile.bio         ?? '',
    avatarUrl:   profile.avatar_url  ?? '',
    coverUrl:    profile.cover_url   ?? '',
    createdAt:   profile.created_at  ?? '',
  };
}

export async function getCommentsByPost(postId: string): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*, profiles(*)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id:        row.id,
    postId:    row.post_id,
    userId:    row.user_id,
    content:   row.content,
    createdAt: row.created_at,
    author:    rowToUser(row.profiles),
  }));
}

export async function createComment(postId: string, content: string): Promise<CommentWithAuthor> {
  const userId = await getCurrentUserId();

  // INSERT直後に profiles(*) を含む select を連鎖させると環境によっては
  // PostgREST エラーが発生するため、INSERT では id のみ取得して別途 SELECT する。
  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, user_id: userId, content })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'コメントの送信に失敗しました');

  // comments_count を実数でリフレッシュ
  const { count } = await supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  await supabase
    .from('posts')
    .update({ comments_count: count ?? 0 })
    .eq('id', postId);

  // 挿入したコメントを author 情報込みで取得
  const { data: fullData, error: fetchError } = await supabase
    .from('comments')
    .select('*, profiles(*)')
    .eq('id', data.id)
    .single();

  if (fetchError || !fullData) throw new Error('コメントの取得に失敗しました');

  return {
    id:        fullData.id,
    postId:    fullData.post_id,
    userId:    fullData.user_id,
    content:   fullData.content,
    createdAt: fullData.created_at,
    author:    rowToUser(fullData.profiles),
  };
}
