// src/hooks/useMembership.ts
//
// 無料メンバーシップ（加入 / 解除 / 加入状態確認）用のフック。
// - Supabase クライアントの import パスは、プロジェクトの実際のパス
//   （例: '@/lib/supabase' や '@/integrations/supabase/client' など）
//   に合わせて書き換えてください。
// - useFollowStats などと同様、@tanstack/react-query が使われている
//   前提で書いています。もし別のデータ取得方法を使っている場合は
//   そちらに合わせて書き換えてください。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

const membershipKey = (creatorId: string, memberId?: string) =>
  ['membership', creatorId, memberId] as const;

/** 自分が creatorId のメンバーになっているかどうかを取得 */
export function useMembershipStatus(creatorId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: membershipKey(creatorId ?? '', user?.id),
    queryFn: async () => {
      if (!creatorId || !user) return false;
      const { data, error } = await supabase
        .from('memberships')
        .select('id')
        .eq('creator_id', creatorId)
        .eq('member_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(creatorId && user),
  });
}

/** メンバーに加入する（決済なし・即時登録） */
export function useJoinMembership(creatorId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('ログインが必要です');
      const { error } = await supabase
        .from('memberships')
        .insert({ creator_id: creatorId, member_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipKey(creatorId, user?.id) });
    },
  });
}

/** メンバーを解除する */
export function useLeaveMembership(creatorId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('ログインが必要です');
      const { error } = await supabase
        .from('memberships')
        .delete()
        .eq('creator_id', creatorId)
        .eq('member_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipKey(creatorId, user?.id) });
    },
  });
}