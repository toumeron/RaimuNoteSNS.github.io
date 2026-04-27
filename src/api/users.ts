import type { User } from '@/types';
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(row: any): User {
  return {
    id: row.id as string,
    username: row.username as string,
    displayName: (row.display_name ?? '') as string,
    bio: (row.bio ?? '') as string,
    avatarUrl: (row.avatar_url ?? '') as string,
    coverUrl: (row.cover_url ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    isOfficial:  (row.is_official  ?? false) as boolean,
  };
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !data) return null;
  return toUser(data);
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return toUser(data);
}

/**
 * プロフィール更新（画像アップロード対応版）
 */
export async function updateProfile(
  id: string,
  patch: Partial<Pick<User, 'displayName' | 'bio' | 'avatarUrl' | 'coverUrl'>>,
): Promise<User> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
  if (patch.bio !== undefined) dbPatch.bio = patch.bio;

  // --- 画像アップロードの共通処理 ---
  const uploadImage = async (url: string, bucket: string) => {
    // blob: 形式でない（すでに https:// 等）ならそのまま返す
    if (!url.startsWith('blob:')) return url;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const fileExt = blob.type.split('/')[1] || 'png';
      // ファイル名は重複しないように UUID を使用
      const fileName = `${id}/${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      // 公開 URL を取得
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      return data.publicUrl;
    } catch (err) {
      console.error(`Upload failed to ${bucket}:`, err);
      return url; // 失敗時はそのまま返してフォールバック
    }
  };

  // avatarUrl があればアップロード（avatars バケットを使用）
  if (patch.avatarUrl) {
    dbPatch.avatar_url = await uploadImage(patch.avatarUrl, 'avatars');
  }

  // coverUrl があればアップロード（posts バケットを流用、または profiles バケットを作成）
  if (patch.coverUrl) {
    dbPatch.cover_url = await uploadImage(patch.coverUrl, 'posts');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) throw new Error('ユーザーが見つかりません');
  return toUser(data);
}