import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';

// ── 修正内容 ──────────────────────────────────────────────────────────────
// DB の follows テーブルの実際のカラム名は follower_id / followee_id。
// コードが following_id を使っていたため 42703(column does not exist) が発生。
// また id カラムが存在しないため select('id') も 42703 エラーになっていた。
//   select('id', { count: 'exact' })
//     → select('*', { count: 'exact', head: true })  に変更
//   following_id  →  followee_id  に全箇所置換
// ─────────────────────────────────────────────────────────────────────────

export async function getFollowStats(userId: string): Promise<{
  followers: number;
  following: number;
  followedByMe: boolean;
}> {
  const currentId = await getCurrentUserId();

  const [followersRes, followingRes, followedByMeRes] = await Promise.all([
    // 自分をフォローしている人の数 (userId が followee_id 側)
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('followee_id', userId),
    // userId がフォローしている人の数 (userId が follower_id 側)
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId),
    // 自分が userId をフォロー済みか
    supabase
      .from('follows')
      .select('follower_id')
      .eq('follower_id', currentId)
      .eq('followee_id', userId)
      .maybeSingle(),
  ]);

  return {
    followers:    followersRes.count    ?? 0,
    following:    followingRes.count    ?? 0,
    followedByMe: !!followedByMeRes.data,
  };
}

export async function toggleFollow(targetUserId: string): Promise<{ followed: boolean }> {
  const currentId = await getCurrentUserId();

  const { data: existing } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', currentId)
    .eq('followee_id', targetUserId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', currentId)
      .eq('followee_id', targetUserId);
    return { followed: false };
  }

  await supabase
    .from('follows')
    .insert({ follower_id: currentId, followee_id: targetUserId });
  return { followed: true };
}
