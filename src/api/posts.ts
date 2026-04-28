import type { PostWithAuthor } from '@/types';
import type { User } from '@/types';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';

const POST_SELECT_QUERY = `
  *,
  profiles:user_id (*),
  parent_post:parent_id (
    *,
    profiles:user_id (*)
  )
`;

function rowToUser(profile: any): User {
  if (!profile) return {} as User;
  return {
    id: profile.id,
    username:    profile.username    ?? '',
    displayName: profile.display_name ?? '',
    bio:         profile.bio         ?? '',
    avatarUrl:   profile.avatar_url  ?? '',
    coverUrl:    profile.cover_url   ?? '',
    createdAt:   profile.created_at  ?? '',
    isOfficial:  profile.is_official  ?? false,
  };
}

function rowToPost(row: any, likedIds: Set<string>, repostedIds: Set<string>): PostWithAuthor {
  return {
    id:            row.id,
    userId:        row.user_id,
    content:       row.content,
    imageUrls:     row.image_urls   ?? [],
    createdAt:     row.created_at,
    likesCount:    row.likes_count  ?? 0,
    commentsCount: row.comments_count ?? 0,
    repostsCount:  row.reposts_count ?? 0,
    likedByMe:     likedIds.has(row.id),
    repostedByMe:  repostedIds.has(row.id),
    author:        rowToUser(row.profiles),
    clientName:    row.client_name,
    parentId:      row.parent_id,
    isQuote:       row.is_quote,
    parentPost: row.parent_post ? {
      ...row.parent_post,
      imageUrls: row.parent_post.image_urls ?? [],
      author: rowToUser(row.parent_post.profiles),
      likedByMe: likedIds.has(row.parent_post.id),
      repostedByMe: repostedIds.has(row.parent_post.id),
    } : null,
  };
}

export async function getFeed(): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase.from('posts').select(POST_SELECT_QUERY).order('created_at', { ascending: false }),
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);
  if (postsRes.error) throw postsRes.error;
  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => l.post_id));
  const repostedIds = new Set<string>((repostsRes.data ?? []).map((r: any) => r.post_id));
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds, repostedIds));
}

export async function getPostsByUser(targetUserId: string): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase.from('posts').select(POST_SELECT_QUERY).eq('user_id', targetUserId).order('created_at', { ascending: false }),
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);
  if (postsRes.error) throw postsRes.error;
  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => String(l.post_id)));
  const repostedIds = new Set<string>((repostsRes.data ?? []).map((r: any) => String(r.post_id)));
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds, repostedIds));
}

export async function getPostById(id: string): Promise<PostWithAuthor | null> {
  const userId = await getCurrentUserId();
  const [postRes, likeRes, repostRes] = await Promise.all([
    supabase.from('posts').select(POST_SELECT_QUERY).eq('id', id).single(),
    supabase.from('likes').select('post_id').eq('post_id', id).eq('user_id', userId).maybeSingle(),
    supabase.from('reposts').select('post_id').eq('post_id', id).eq('user_id', userId).maybeSingle(),
  ]);
  if (postRes.error || !postRes.data) return null;
  const likedIds = new Set<string>(likeRes.data ? [id] : []);
  const repostedIds = new Set<string>(repostRes.data ? [id] : []);
  return rowToPost(postRes.data, likedIds, repostedIds);
}

export async function createPost(input: {
  content: string;
  imageUrls: string[];
  parentId?: string;
  isQuote?: boolean;
}): Promise<PostWithAuthor> {
  const userId = await getCurrentUserId();
  const newId = crypto.randomUUID();

  const getDetailedClient = () => {
    const ua = navigator.userAgent;
    const platform = (navigator as any).platform || '';
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/Android/i.test(ua)) return "Android";
    return "Web";
  };

  const clientSource = `LaimeNote for ${getDetailedClient()}`;

  const finalImageUrls = await Promise.all(
    input.imageUrls.map(async (url) => {
      if (url.startsWith('http')) return url;
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const formData = new FormData();
        formData.append('file', blob);
        formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
        const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        return data.secure_url;
      } catch (err) { return null; }
    })
  );

  const { error } = await supabase.from('posts').insert({
    id:          newId,
    user_id:     userId,
    content:     input.content,
    image_urls:  finalImageUrls.filter((url): url is string => url !== null), 
    client_name: clientSource,
    parent_id:   input.parentId || null,
    is_quote:    input.isQuote || false,
  });

  if (error) throw error;

  // 引用リポストの場合のカウント更新
  if (input.parentId && input.isQuote) {
    const [rep, quo] = await Promise.all([
      supabase.from('reposts').select('*', { count: 'exact', head: true }).eq('post_id', input.parentId),
      supabase.from('posts').select('*', { count: 'exact', head: true }).eq('parent_id', input.parentId).eq('is_quote', true)
    ]);
    await supabase.from('posts').update({ reposts_count: (rep.count ?? 0) + (quo.count ?? 0) }).eq('id', input.parentId);
  }

  const post = await getPostById(newId);
  if (!post) throw new Error('投稿の取得に失敗しました');
  return post;
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; likesCount: number }> {
  const userId = await getCurrentUserId();
  const { data: existing } = await supabase.from('likes').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle();

  if (existing) {
    await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId);
  } else {
    await supabase.from('likes').insert({ post_id: postId, user_id: userId });
  }

  const { count } = await supabase.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
  const likesCount = count ?? 0;
  await supabase.from('posts').update({ likes_count: likesCount }).eq('id', postId);

  return { liked: !existing, likesCount };
}

/**
 * リポストの切り替え
 * 「repostsテーブルへの出し入れ」と「引用リポストを含めた合計値の算出」を同期させる
 */
export async function toggleRepost(postId: string): Promise<{ reposted: boolean; repostsCount: number }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("ログインが必要です");

  // 1. 現在のボタン操作によるリポスト状態を確認
  const { data: existing } = await supabase
    .from('reposts')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  // 2. トグル処理（あれば消す、なければ足す）
  if (existing) {
    const { error: delErr } = await supabase.from('reposts').delete().eq('post_id', postId).eq('user_id', userId);
    if (delErr) throw delErr;
  } else {
    const { error: insErr } = await supabase.from('reposts').insert({ post_id: postId, user_id: userId });
    if (insErr) throw insErr;
  }

  // 3. 最新の合計数を取得（ボタンリポスト + 引用リポスト投稿数）
  // count: 'exact' を使い、head: true でデータ転送量を抑えて確実に件数だけ取る
  const [repostsRes, quotesRes] = await Promise.all([
    supabase.from('reposts').select('*', { count: 'exact', head: true }).eq('post_id', postId),
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('parent_id', postId).eq('is_quote', true)
  ]);

  const totalReposts = (repostsRes.count ?? 0) + (quotesRes.count ?? 0);

  // 4. 元の投稿の reposts_count カラムを更新
  // ここで 403 が出る場合は、postsテーブルのUPDATE権限を確認
  const { error: updateErr } = await supabase
    .from('posts')
    .update({ reposts_count: totalReposts })
    .eq('id', postId);
  
  if (updateErr) {
    console.warn("Count update failed (expected if not post owner):", updateErr);
  }

  return { reposted: !existing, repostsCount: totalReposts };
}

export async function deletePost(postId: string): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', userId);
  if (error) throw error;
}

export async function getPostLikers(postId: string): Promise<User[]> {
  const { data, error } = await supabase.from('likes').select(`profiles (*)`).eq('post_id', postId);
  if (error) throw error;
  return (data ?? []).map((row: any) => rowToUser(row.profiles));
}