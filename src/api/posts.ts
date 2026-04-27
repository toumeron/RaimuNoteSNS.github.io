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
    clientName:    row.client_name  ?? 'RaimuNote for Web', // 追加
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
  const newId = crypto.randomUUID();


  
 const getDetailedClient = () => {
    const ua = navigator.userAgent;
    const platform = (navigator as any).platform || '';

    // 1. iPhone / iPad
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return "iPad";

    // 2. Android
    if (/Android/i.test(ua)) return "Android";

    // 3. Mac (Macintosh かつ Touchがない)
    if (/Macintosh|MacIntel|MacPPC|Mac68K/i.test(ua)) return "Mac";

    // 4. Windows
    if (/Win32|Win64|Windows|WinCE/i.test(ua)) return "Windows";

    return "Web";
  };

  const clientSource = `RaimuNote for ${getDetailedClient()}`;

  // --- 追加：画像を本物のURLに変換する処理 ---
  const finalImageUrls = await Promise.all(
    input.imageUrls.map(async (url) => {
      // blob: で始まっていない（既に https: 等の）場合はそのまま返す
      if (!url.startsWith('blob:')) return url;

      try {
        // 1. blob URL から実際のデータ(Blob)を取得
        const response = await fetch(url);
        const blob = await response.blob();
        
        // 2. ファイル名を生成 (例: user_id/unique_id.png)
        const fileExt = blob.type.split('/')[1] || 'png';
        const fileName = `${userId}/${crypto.randomUUID()}.${fileExt}`;

        // 3. Supabase Storage の 'posts' バケットにアップロード
        // ※予め Supabase 側で 'posts' バケットを Public で作成しておく必要があります
        const { error: uploadError } = await supabase.storage
          .from('posts')
          .upload(fileName, blob);

        if (uploadError) throw uploadError;

        // 4. 公開用URLを取得して返す
        const { data } = supabase.storage.from('posts').getPublicUrl(fileName);
        return data.publicUrl;
      } catch (err) {
        console.error('Image upload failed:', err);
        return null; // 失敗した場合は除外するか、エラーにする
      }
    })
  );

  // null（失敗した画像）を除外
  const filteredUrls = finalImageUrls.filter((url): url is string => url !== null);
  // ----------------------------------------

  const { error } = await supabase
    .from('posts')
    .insert({
      id:         newId,
      user_id:    userId,
      content:    input.content,
      image_urls: filteredUrls, // 本物のURL配列を入れる
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
