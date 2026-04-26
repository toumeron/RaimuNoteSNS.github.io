import type { PostWithAuthor } from '@/types';
import type { User } from '@/types';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(profile: any): User {
  return {
    id: profile.id,
    username:    profile.username    ?? '',
    displayName: profile.display_name ?? '',
    bio:         profile.bio         ?? '',
    avatarUrl:   profile.avatar_url  ?? '',
    coverUrl:    profile.cover_url   ?? '',
    createdAt:   profile.created_at  ?? '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPost(row: any, likedIds: Set<string>): PostWithAuthor {
  return {
    id:            row.id,
    userId:        row.user_id,
    content:       row.content,
    imageUrls:     row.image_urls   ?? [],
    createdAt:     row.created_at,
    likesCount:    row.likes_count  ?? 0,
    commentsCount: row.comments_count ?? 0,
    likedByMe:     likedIds.has(row.id),
    author:        rowToUser(row.profiles),
  };
}

export async function getFeed(): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();

  const [postsRes, likesRes] = await Promise.all([
    supabase
      .from('posts')
      .select('*, profiles!posts_user_id_fkey(*)')
      .order('created_at', { ascending: false }),
    supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', userId),
  ]);

  if (postsRes.error) throw postsRes.error;

  const likedIds = new Set((likesRes.data ?? []).map((l) => l.post_id as string));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds));
}

export async function getPostsByUser(targetUserId: string): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();

  const [postsRes, likesRes] = await Promise.all([
    supabase
      .from('posts')
      // FKヒント必須: profiles(*) だけだと複数リレーションが候補になり PGRST201(300) エラー
      .select('*, profiles!posts_user_id_fkey(*)')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false }),
    supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', userId),
  ]);

  if (postsRes.error) throw postsRes.error;

  const likedIds = new Set((likesRes.data ?? []).map((l) => l.post_id as string));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds));
}

export async function getPostById(id: string): Promise<PostWithAuthor | null> {
  const userId = await getCurrentUserId();

  const [postRes, likeRes] = await Promise.all([
    supabase
      .from('posts')
      // FKヒント必須: profiles(*) だけだと複数リレーションが候補になり PGRST201(300) エラー
      .select('*, profiles!posts_user_id_fkey(*)')
      .eq('id', id)
      .single(),
    supabase
      .from('likes')
      .select('post_id')
      .eq('post_id', id)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (postRes.error || !postRes.data) return null;

  const likedIds = new Set<string>(likeRes.data ? [id] : []);
  return rowToPost(postRes.data, likedIds);
}

export async function createPost(input: {
  content: string;
  imageUrls: string[];
}): Promise<PostWithAuthor> {
  const userId = await getCurrentUserId();

  // ── 根本原因 ──────────────────────────────────────────────────────────────
  // posts.image_urls は text[] 型。INSERT に .select() を連鎖させると
  // PostgREST が RETURNING 句を生成する際に内部で
  //   substring(image_urls, 1)  ← text[] には存在しない関数
  // を呼び出し PostgreSQL エラー 42883 が発生する。
  // ─────────────────────────────────────────────────────────────────────────
  // 対策: クライアント側で UUID を生成し INSERT を RETURNING なし(bare insert)に。
  //       .select() を一切連鎖しないことで RETURNING 句を完全に排除する。
  //       挿入後は通常の SELECT (getPostById) で取得する。
  // ─────────────────────────────────────────────────────────────────────────
  const newId = crypto.randomUUID();

  const { error } = await supabase
    .from('posts')
    .insert({
      id:         newId,
      user_id:    userId,
      content:    input.content,
      image_urls: input.imageUrls,
    });

  if (error) throw new Error(error.message ?? '投稿に失敗しました');

  const post = await getPostById(newId);
  if (!post) throw new Error('投稿に失敗しました');
  return post;
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; likesCount: number }> {
  const userId = await getCurrentUserId();

  // 既いいね確認
  const { data: existing } = await supabase
    .from('likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId);
  } else {
    await supabase.from('likes').insert({ post_id: postId, user_id: userId });
  }

  // likes テーブルを直接カウントして更新
  const { count } = await supabase
    .from('likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  const likesCount = count ?? 0;
  await supabase.from('posts').update({ likes_count: likesCount }).eq('id', postId);

  return { liked: !existing, likesCount };
}
