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
    isOfficial:  profile.is_official  ?? false,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPost(row: any, likedIds: Set<string>): PostWithAuthor & { clientName?: string } {
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
    clientName:    row.client_name,
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

  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => l.post_id));
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

  const likedIds = new Set<string>((likesRes.data ?? []).map((l: any) => String(l.post_id)));
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
  const newId = crypto.randomUUID();

  const getDetailedClient = () => {
    const ua = navigator.userAgent;
    const platform = (navigator as any).platform || '';
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return "iPad";
    if (/Android/i.test(ua)) return "Android";
    if (/Macintosh|MacIntel|MacPPC|Mac68K/i.test(ua)) return "Mac";
    if (/Win32|Win64|Windows|WinCE/i.test(ua)) return "Windows";
    return "Web";
  };

  const clientSource = `LaimeNote for ${getDetailedClient()}`;

  // 画像アップロード処理
  const finalImageUrls = await Promise.all(
    input.imageUrls.map(async (url) => {
      // 既にhttpsならそのまま通す
      if (url.startsWith('http')) return url;

      try {
        const response = await fetch(url);
        const blob = await response.blob();
        
        const formData = new FormData();
        formData.append('file', blob);
        formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);

        const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
        
        // デバッグ用：ここが undefined なら環境変数が読み込めていない
        console.log('Uploading to Cloudinary:', cloudName);

        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          { method: 'POST', body: formData }
        );

        if (!res.ok) {
          const errData = await res.json();
          console.error('Cloudinary Error Detail:', errData);
          throw new Error('Cloudinary upload failed');
        }
        
        const data = await res.json();
        return data.secure_url;
      } catch (err) {
        console.error('Upload Process Error:', err);
        return null;
      }
    })
  );

  const filteredUrls = finalImageUrls.filter((url): url is string => url !== null);

  const { error } = await supabase
    .from('posts')
    .insert({
      id:         newId,
      user_id:    userId,
      content:    input.content,
      image_urls: filteredUrls, 
      client_name: clientSource,
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

/**
 * 投稿を削除する
 */
export async function deletePost(postId: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', userId); // 本人確認をクエリに含める（念のため）

  if (error) throw new Error(error.message ?? '削除に失敗しました');
}

//ねこ