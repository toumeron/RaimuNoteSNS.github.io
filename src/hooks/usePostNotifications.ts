import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { requestPermissionAndSubscribe } from '@/hooks/useOSNotification';

export type PostNotificationToggleResult =
  | { ok: true; enabled: boolean }
  | { ok: false; reason: 'login' | 'unsupported' | 'denied' | 'push-failed' | 'db-failed' };

const queryKeyFor = (myId?: string, targetUserId?: string) => ['post-notification-subscription', myId, targetUserId];

// 直前の if で 'denied' が除外されると TypeScript が型を絞り込んでしまうため、
// 許可ダイアログ後の最新の値を取り直すときは関数経由で読む。
const getNotificationPermission = (): NotificationPermission => Notification.permission;

function isNotificationApiAvailable() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * 指定ユーザーの「新しい投稿を通知する」ON/OFF状態と切り替え処理。
 * targetUserId が undefined のときは何も取得しない。
 */
export function usePostNotificationSubscription(targetUserId?: string) {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  const { data: enabled = false } = useQuery({
    queryKey: queryKeyFor(me?.id, targetUserId),
    enabled: Boolean(me?.id && targetUserId && me.id !== targetUserId),
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('post_notification_subscriptions')
        .select('id')
        .eq('subscriber_id', me!.id)
        .eq('target_user_id', targetUserId!)
        .maybeSingle();

      if (error) throw error;
      return Boolean(data?.id);
    },
  });

  // 注意: iOS(Safari/PWA)では Notification.requestPermission() をユーザー操作(タップ)の
  // 直後に呼ぶ必要がある。そのため、この関数はボタンの onClick から直接呼び、
  // 通知許可のリクエストを他の await より先に実行している。
  const toggle = useCallback(async (): Promise<PostNotificationToggleResult> => {
    if (!me?.id || !targetUserId) return { ok: false, reason: 'login' };
    if (isPending) return { ok: true, enabled };

    setIsPending(true);

    try {
      if (enabled) {
        const { error } = await supabase
          .from('post_notification_subscriptions')
          .delete()
          .eq('subscriber_id', me.id)
          .eq('target_user_id', targetUserId);

        if (error) {
          console.error('Disable post notification failed:', error);
          return { ok: false, reason: 'db-failed' };
        }

        queryClient.setQueryData(queryKeyFor(me.id, targetUserId), false);
        return { ok: true, enabled: false };
      }

      // --- ONにする: まず通知の許可・Push購読を確認する ---
      if (!isNotificationApiAvailable()) {
        // iOSではホーム画面に追加したPWAでのみ Notification / PushManager が使える
        return { ok: false, reason: 'unsupported' };
      }

      if (Notification.permission === 'denied') {
        return { ok: false, reason: 'denied' };
      }

      // 許可されていなければここでブラウザの許可ダイアログが出る。許可後はPush購読も保存される。
      const subscribed = await requestPermissionAndSubscribe(me.id);

      if (!subscribed) {
        return {
          ok: false,
          reason: getNotificationPermission() === 'denied' ? 'denied' : 'push-failed',
        };
      }

      const { error } = await supabase
        .from('post_notification_subscriptions')
        // 既に登録済みなら何もしない(ON CONFLICT DO NOTHING)。
        // DO UPDATE 形式のupsertだと UPDATE 権限とポリシーが必要になり 42501 になるため、
        // INSERT権限だけで動く ignoreDuplicates を使う。
        .upsert(
          { subscriber_id: me.id, target_user_id: targetUserId },
          { onConflict: 'subscriber_id,target_user_id', ignoreDuplicates: true },
        );

      if (error) {
        console.error('Enable post notification failed:', error);
        return { ok: false, reason: 'db-failed' };
      }

      queryClient.setQueryData(queryKeyFor(me.id, targetUserId), true);
      return { ok: true, enabled: true };
    } finally {
      setIsPending(false);
    }
  }, [me?.id, targetUserId, enabled, isPending, queryClient]);

  return { enabled, isPending, toggle };
}