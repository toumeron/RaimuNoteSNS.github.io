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

/**
 * タイムライン取得（無限スクロール対応）
 */
export async function getFeed(page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .order('created_at', { ascending: false })
      .range(from, to),
    
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);

  if (postsRes.error) throw postsRes.error;
  
  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => l.post_id));
  const repostedIds = new Set<string>((repostsRes.data ?? []).map((r: any) => r.post_id));
  
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds, repostedIds));
}

/**
 * フォロー中のユーザーの投稿のみを取得（無限スクロール対応）
 */
export async function getFollowingFeed(page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const from = page * limit;
  const to = from + limit - 1;

  // 1. 自分がフォローしているユーザーのIDリストを取得
  const { data: followingData, error: followError } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', userId);

  if (followError) throw followError;

  const followingIds = followingData?.map(f => f.followee_id) || [];
  if (followingIds.length === 0) return [];

  // 2. フォロー中ユーザーの投稿を取得
  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .in('user_id', followingIds)
      .order('created_at', { ascending: false })
      .range(from, to),
    
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);

  if (postsRes.error) throw postsRes.error;
  
  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => String(l.post_id)));
  const repostedIds = new Set<string>((repostsRes.data ?? []).map((r: any) => String(r.post_id)));
  
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds, repostedIds));
}

/**
 * 特定ユーザーの投稿取得（無限スクロール対応）
 */
export async function getPostsByUser(targetUserId: string, page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .range(from, to),
    
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);

  if (postsRes.error) throw postsRes.error;
  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => String(l.post_id)));
  const repostedIds = new Set<string>((repostsRes.data ?? []).map((r: any) => String(r.post_id)));
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds, repostedIds));
}

/**
 * 特定ユーザーがいいねした投稿取得（無限スクロール対応）
 */
export async function getLikedPostsByUser(targetUserId: string, page: number = 0, limit: number = 10): Promise<any[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  const { data: likesData, error: likesErr } = await supabase
    .from('likes')
    .select(`
      created_at,
      posts (${POST_SELECT_QUERY})
    `)
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (likesErr) throw likesErr;
  if (!likesData) return [];

  const [myLikesRes, myRepostsRes] = await Promise.all([
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);

  const likedIds = new Set<string>((myLikesRes.data ?? []).map((l: any) => String(l.post_id)));
  const repostedIds = new Set<string>((myRepostsRes.data ?? []).map((r: any) => String(r.post_id)));

  return likesData.map((likeRow: any) => {
    const post = rowToPost(likeRow.posts, likedIds, repostedIds);
    return {
      created_at: likeRow.created_at,
      posts: post
    };
  });
}

/**
 * 投稿検索（無限スクロール対応）
 */
export async function searchPosts(query: string, page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .ilike('content', `%${query}%`)
      .order('created_at', { ascending: false })
      .range(from, to),
    
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);

  if (postsRes.error) throw postsRes.error;
  
  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => l.post_id));
  const repostedIds = new Set<string>((repostsRes.data ?? []).map((r: any) => r.post_id));
  
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

  const IMAGE_URL_PATTERN = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp|svg|avif)(?:\?.*)?)/gi;
  const detectedUrls = input.content.match(IMAGE_URL_PATTERN) || [];

  const getDetailedClient = () => {
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/Android/i.test(ua)) return "Android";
    return "Web";
  };

  const clientSource = `LimeNote for ${getDetailedClient()}`;

  const uploadedUrls = await Promise.all(
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

  const finalImageUrls = Array.from(new Set([
    ...uploadedUrls.filter((url): url is string => url !== null),
    ...detectedUrls
  ]));

  const { error } = await supabase.from('posts').insert({
    id:          newId,
    user_id:     userId,
    content:     input.content,
    image_urls:  finalImageUrls, 
    client_name: clientSource,
    parent_id:   input.parentId || null,
    is_quote:    input.isQuote || false,
  });

  if (error) throw error;

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

export async function toggleRepost(postId: string): Promise<{ reposted: boolean; repostsCount: number }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("ログインが必要です");

  const { data: existing } = await supabase
    .from('reposts')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    await supabase.from('reposts').delete().eq('post_id', postId).eq('user_id', userId);
  } else {
    await supabase.from('reposts').insert({ post_id: postId, user_id: userId });
  }

  const [repostsRes, quotesRes] = await Promise.all([
    supabase.from('reposts').select('*', { count: 'exact', head: true }).eq('post_id', postId),
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('parent_id', postId).eq('is_quote', true)
  ]);

  const totalReposts = (repostsRes.count ?? 0) + (quotesRes.count ?? 0);

  await supabase.from('posts').update({ reposts_count: totalReposts }).eq('id', postId);
  
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