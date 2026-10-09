import { getClientName } from '@/lib/clientName';
import type { CommentWithAuthor } from '@/types';
import type { User } from '@/types';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { uploadPostMedia } from '@/lib/uploadPostMedia';

export type CommentInput = { content: string; imageUrls?: string[]; parentCommentId?: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToComment(row: any): CommentWithAuthor {
  return {
    id: row.id, postId: row.post_id, userId: row.user_id,
    content: row.content, createdAt: row.created_at,
    parentCommentId: row.parent_comment_id ?? null,
    clientName: row.client_name ?? undefined,
    imageUrls: row.image_urls ?? [], likes_count: row.likes_count ?? 0,
    author: rowToUser(row.profiles),
  };
}

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
    isOfficial: profile.is_official ?? false,
    isPrivate: profile.is_private === true,
  };
}

export async function getCommentsByPost(postId: string): Promise<CommentWithAuthor[]> {
  const comments: CommentWithAuthor[] = [];
  let after: { createdAt: string; id: string } | undefined;
  // PostgREST caps a response at 1000 rows. Continue by a stable key so deep
  // threads are not truncated and live insertions cannot shift page offsets.
  for (;;) {
    let query = supabase.from('comments').select('*, profiles:profiles!comments_user_id_fkey(*)').eq('post_id', postId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 999);
    if (after) query = query.or(`created_at.gt.${after.createdAt},and(created_at.eq.${after.createdAt},id.gt.${after.id})`);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    comments.push(...rows.map(rowToComment));
    if (rows.length < 1000) return comments;
    const last = rows[rows.length - 1];
    after = { createdAt: last.created_at, id: last.id };
  }
}

export async function createComment(postId: string, input: string | CommentInput): Promise<CommentWithAuthor> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('ログインしてください');
  const payload = typeof input === 'string' ? { content: input } : input;
  const content = payload.content.trim();
  if ((!content && !payload.imageUrls?.length) || content.length > 280) throw new Error('返信は280文字以内、または画像を添付してください');
  const id = crypto.randomUUID();
  const { data: parent, error: parentError } = await supabase.from('posts').select('visibility').eq('id', postId).single();
  if (parentError || !parent) throw new Error('返信先の投稿を閲覧できません');
  const imageUrls = await uploadPostMedia(payload.imageUrls ?? [], userId, id, parent.visibility !== 'public');

  // INSERT直後に profiles(*) を含む select を連鎖させると環境によっては
  // PostgREST エラーが発生するため、INSERT では id のみ取得して別途 SELECT する。
  const { data, error } = await supabase
    .from('comments')
    .insert({ id, post_id: postId, user_id: userId, content, parent_comment_id: payload.parentCommentId ?? null, image_urls: imageUrls, client_name: getClientName() })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'コメントの送信に失敗しました');

  // comments_count を実数でリフレッシュ
  const { count } = await supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (count !== null) {
    await supabase.from('posts').update({ comments_count: count }).eq('id', postId);
  }

  // 挿入したコメントを author 情報込みで取得
  const { data: fullData, error: fetchError } = await supabase
    .from('comments')
    .select('*, profiles:profiles!comments_user_id_fkey(*)')
    .eq('id', data.id)
    .single();

  if (fetchError || !fullData) throw new Error('コメントの取得に失敗しました');

  return rowToComment(fullData);
}

export async function getCommentLikers(commentId: string): Promise<User[]> {
  const { data, error } = await supabase.from('comment_likes').select('profiles(*)').eq('comment_id', commentId);
  if (error) throw error;
  return (data ?? []).map(row => rowToUser(row.profiles));
}
