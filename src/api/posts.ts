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
    visibility:    row.visibility,
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
 * ロジック: 公開投稿、自分の投稿、または自分をフォローしている人の投稿を表示
 */
export async function getFeed(page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  // 「自分(userId)をフォローしている投稿主」のリストを取得
  const { data: followedByData } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', userId);
  
  const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];

  // OR条件の組み立て
  const conditions = [
    'visibility.eq.public', // 全体公開
    `user_id.eq.${userId}`   // 自分の投稿
  ];

  // 自分をフォローしている投稿主の投稿（限定公開分を含む）を条件に追加
  if (authorsWhoFollowMe.length > 0) {
    conditions.push(`and(user_id.in.(${authorsWhoFollowMe.join(',')}),visibility.eq.following)`);
  }

  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .or(conditions.join(','))
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
 * フォローしているユーザーの投稿のみを取得（無限スクロール対応）
 */
export async function getFollowingFeed(page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const from = page * limit;
  const to = from + limit - 1;

  // 1. 自分がフォローしている人のリストを取得
  const { data: followingData } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', userId);

  const followingIds = followingData?.map(f => f.followee_id) || [];
  if (followingIds.length === 0) return [];

  // 2. 自分をフォローしてくれている人のリストを取得（限定公開用）
  const { data: followedByData } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', userId);

  const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];

  // 3. クエリ条件の組み立て
  // 「フォローしている人の公開投稿」 OR 「フォローしており、かつ相手も自分をフォローしている限定公開投稿」
  let filterConditions = `and(user_id.in.(${followingIds.join(',')}),visibility.eq.public)`;
  
  // 相互フォロー（相手が自分をフォローしている）の人がいれば、その人の限定公開投稿も加える
  const mutualFollowIds = followingIds.filter(id => authorsWhoFollowMe.includes(id));
  if (mutualFollowIds.length > 0) {
    filterConditions += `,and(user_id.in.(${mutualFollowIds.join(',')}),visibility.eq.following)`;
  }

  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .or(filterConditions)
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
 * 特定ユーザーの投稿取得
 */
export async function getPostsByUser(targetUserId: string, page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  // ターゲットユーザーが自分をフォローしているか確認
  const { data: authorFollowsMe } = await supabase
    .from('follows')
    .select('*')
    .eq('follower_id', targetUserId)
    .eq('followee_id', userId)
    .maybeSingle();

  let query = supabase
    .from('posts')
    .select(POST_SELECT_QUERY)
    .eq('user_id', targetUserId);

  // 本人でもなく、かつターゲット（投稿主）からフォローもされていない場合は公開投稿のみ
  if (userId !== targetUserId && !authorFollowsMe) {
    query = query.eq('visibility', 'public');
  }

  const [postsRes, likesRes, repostsRes] = await Promise.all([
    query.order('created_at', { ascending: false }).range(from, to),
    supabase.from('likes').select('post_id').eq('user_id', userId),
    supabase.from('reposts').select('post_id').eq('user_id', userId),
  ]);

  if (postsRes.error) throw postsRes.error;
  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => String(l.post_id)));
  const repostedIds = new Set<string>((repostsRes.data ?? []).map((r: any) => String(r.post_id)));
  return (postsRes.data ?? []).map((row: any) => rowToPost(row, likedIds, repostedIds));
}

/**
 * 特定ユーザーがいいねした投稿取得
 */
export async function getLikedPostsByUser(targetUserId: string, page: number = 0, limit: number = 10): Promise<any[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  // 自分をフォローしている投稿主を取得
  const { data: followedByData } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', userId);
  const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];

  // 条件：公開投稿、自分の投稿、または自分をフォローしている人の限定公開投稿
  const conditions = [
    'posts.visibility.eq.public',
    `posts.user_id.eq.${userId}`
  ];

  if (authorsWhoFollowMe.length > 0) {
    conditions.push(`and(posts.user_id.in.(${authorsWhoFollowMe.join(',')}),posts.visibility.eq.following)`);
  }

  const { data: likesData, error: likesErr } = await supabase
    .from('likes')
    .select(`
      created_at,
      posts!inner (${POST_SELECT_QUERY})
    `)
    .eq('user_id', targetUserId)
    .or(conditions.join(','))
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
 * 投稿検索
 */
export async function searchPosts(query: string, page: number = 0, limit: number = 10): Promise<PostWithAuthor[]> {
  const userId = await getCurrentUserId();
  
  const from = page * limit;
  const to = from + limit - 1;

  const { data: followedByData } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followee_id', userId);
  const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];

  const conditions = [
    'visibility.eq.public',
    `user_id.eq.${userId}`
  ];

  if (authorsWhoFollowMe.length > 0) {
    conditions.push(`and(user_id.in.(${authorsWhoFollowMe.join(',')}),visibility.eq.following)`);
  }

  const [postsRes, likesRes, repostsRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT_QUERY)
      .ilike('content', `%${query}%`)
      .or(conditions.join(','))
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

  // visibilityが'following'の場合、投稿主があなたをフォローしているかチェックする
  if (postRes.data.visibility === 'following' && postRes.data.user_id !== userId) {
    const { data: authorFollowsMe } = await supabase
      .from('follows')
      .select('*')
      .eq('follower_id', postRes.data.user_id)
      .eq('followee_id', userId)
      .maybeSingle();
    
    if (!authorFollowsMe) return null;
  }

  const likedIds = new Set<string>(likeRes.data ? [id] : []);
  const repostedIds = new Set<string>(repostRes.data ? [id] : []);
  return rowToPost(postRes.data, likedIds, repostedIds);
}

export async function createPost(input: {
  content: string;
  imageUrls: string[];
  parentId?: string;
  isQuote?: boolean;
  visibility?: 'public' | 'following';
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

  const MENTION_PATTERN = /@(\w+)/g;
  const mentionedUsernames = Array.from(new Set([...input.content.matchAll(MENTION_PATTERN)].map(match => match[1])));

  const { error } = await supabase.from('posts').insert({
    id:          newId,
    user_id:     userId,
    content:     input.content,
    image_urls:  finalImageUrls, 
    client_name: clientSource,
    parent_id:   input.parentId || null,
    is_quote:    input.isQuote || false,
    visibility:  input.visibility || 'public'
  });

  if (error) throw error;

  if (mentionedUsernames.length > 0) {
    const { data: mentionedUsers } = await supabase
      .from('profiles')
      .select('id, username')
      .in('username', mentionedUsernames);

    if (mentionedUsers && mentionedUsers.length > 0) {
      const mentionInserts = mentionedUsers.map(user => ({
        post_id: newId,
        mentioned_user_id: user.id
      }));
      await supabase.from('mentions').insert(mentionInserts);
    }
  }

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