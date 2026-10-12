import { getPrivateBotPrompt } from "@/lib/privateProfile";
import { randomUUID } from "@/lib/randomUUID";
import type { User } from "@/types";
import { supabase } from "@/lib/supabase";

// Keep the fields returned by toUser; exclude unrelated profile settings.
const USER_SELECT_COLUMNS = 'id, username, display_name, bio, location, avatar_url, cover_url, created_at, is_official, is_private, emoji_effect, bot_enabled, review, Account_suspension';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(row: any): User {
  return {
    id: row.id as string,
    isSuspended: row.Account_suspension === true,
    review: row.review === true,
    isPrivate: row.is_private === true,
    username: row.username as string,
    displayName: (row.display_name ?? '') as string,
    bio: (row.bio ?? '') as string,
    location: (row.location ?? '') as string,
    avatarUrl: (row.avatar_url ?? '') as string,
    coverUrl: (row.cover_url ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    isOfficial:  (row.is_official  ?? false) as boolean,
    emojiEffect: (row.emoji_effect ?? '') as string,
    // bot関連のプロパティを追加
    bot_enabled: (row.bot_enabled ?? false) as boolean,
    bot_prompt: undefined, // Private settings are fetched separately by their owner.
  };
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(USER_SELECT_COLUMNS)
    .eq('username', username)
    .maybeSingle();

  if (error || !data) return null;
  return toUser(data);
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(USER_SELECT_COLUMNS)
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
  patch: Partial<Pick<User, 'displayName' | 'bio' | 'location' | 'avatarUrl' | 'coverUrl' | 'emojiEffect' | 'bot_enabled' | 'bot_prompt' | 'isPrivate'>>,
): Promise<User> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.isPrivate !== undefined) dbPatch.is_private = patch.isPrivate;
  if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
  if (patch.bio !== undefined) dbPatch.bio = patch.bio;
  if (patch.location !== undefined) dbPatch.location = patch.location.trim();
  if (patch.emojiEffect !== undefined) dbPatch.emoji_effect = patch.emojiEffect;
  // bot関連の値をDBのカラム名（スネークケース）にマッピングして追加
  if (patch.bot_enabled !== undefined) dbPatch.bot_enabled = patch.bot_enabled;
  if (patch.bot_prompt !== undefined) {
    // Never write a private prompt into the legacy public column unless the
    // server-side migration that redirects it to owner-only storage is present.
    try { await getPrivateBotPrompt(id); }
    catch { throw new Error('Bot設定の非公開保存先が利用できません。データベースの更新後に再試行してください。'); }
    dbPatch.bot_prompt = patch.bot_prompt;
  }

  // --- 画像アップロードの共通処理 ---
  const uploadImage = async (url: string, bucket: string) => {
    // blob: 形式でない（すでに https:// 等）ならそのまま返す
    if (!url.startsWith('blob:')) return url;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const fileExt = blob.type.split('/')[1] || 'png';
      // ファイル名は重複しないように UUID を使用
      const fileName = `${id}/${randomUUID()}.${fileExt}`;

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
    .select(USER_SELECT_COLUMNS)
    .single();

  if (error || !data) throw new Error('ユーザーが見つかりません');
  return toUser(data);
}

/** Return the public aggregate, including restricted activity, without bodies. */
export async function getProfileActivityCount(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_profile_activity_count', { target_user_id: userId });
  if (error) throw error;
  if (typeof data !== 'number' && typeof data !== 'string') throw new Error('Invalid profile activity count');
  const count = Number(data);
  if (data == null || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid profile activity count');
  return count;
}



export type AccountReview = {
  id: string; author_id: string; rating: number; title: string; content: string; created_at: string;
  likes_count: number; liked_by_me: boolean;
  author: { username: string; display_name: string; avatar_url: string; is_official: boolean; is_private?: boolean };
};
export type AccountReviews = {
  enabled: boolean; total: number; average: number; distribution: Record<string, number>; reviews: AccountReview[];
};
export const accountReviewsKey = (profileId: string) => ['account-reviews', profileId] as const;
export async function getAccountReviews(profileId: string, offset = 0): Promise<AccountReviews> {
  const { data, error } = await supabase.rpc('get_account_reviews', { target_profile: profileId, page_offset: offset });
  if (error) throw error;
  return data as AccountReviews;
}
export async function submitAccountReview(profileId: string, rating: number, title: string, content: string) {
  const { error } = await supabase.rpc('submit_account_review', {
    target_profile: profileId, stars: rating, review_title: title, review_content: content,
  });
  if (error) throw error;
}
export async function setAccountReviewLike(reviewId: string, enabled: boolean): Promise<{liked: boolean; count: number}> {
  const { data, error } = await supabase.rpc('set_account_review_like', { target_review: reviewId, enabled });
  if (error) throw error;
  return data;
}
