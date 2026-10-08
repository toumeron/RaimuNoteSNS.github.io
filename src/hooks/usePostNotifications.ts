import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { requestPermissionAndSubscribe } from '@/hooks/useOSNotification';

export type PostNotificationToggleResult =
  | { ok: true; enabled: boolean }
  | { ok: false; reason: 'login' | 'unsupported' | 'denied' | 'push-failed' | 'db-failed' };

const queryKeyFor = (myId?: string, targetUserId?: string) => ['post-notification-subscription', myId, targetUserId];

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
export function usePostNotificationSubscription(targetUserId?: string, external?: {provider:'bluesky'|'misskey';actor:string;name:string;avatarUrl:string}) {
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
        .eq(external ? 'external_actor' : 'target_user_id', external?.actor ?? targetUserId!)
        .eq('provider', external?.provider ?? 'limenote')
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
          .eq(external ? 'external_actor' : 'target_user_id', external?.actor ?? targetUserId)
          .eq('provider', external?.provider ?? 'limenote');

        if (error) {
          console.error('Disable post notification failed:', error);
          return { ok: false, reason: 'db-failed' };
        }

        queryClient.setQueryData(queryKeyFor(me.id, targetUserId), false);
        void queryClient.invalidateQueries({queryKey:['notification-subscriptions',me.id]});
        return { ok: true, enabled: false };
      }

      // Save in-app subscriptions even on devices without Web Push.
      // Request permission immediately from the gesture when supported.
      if (isNotificationApiAvailable() && Notification.permission !== 'denied') {
        await requestPermissionAndSubscribe(me.id);
      }

      const { error } = await supabase
        .from('post_notification_subscriptions')
        // 既に登録済みなら何もしない(ON CONFLICT DO NOTHING)。
        // DO UPDATE 形式のupsertだと UPDATE 権限とポリシーが必要になり 42501 になるため、
        // INSERT権限だけで動く ignoreDuplicates を使う。
        .upsert(
          external ? {subscriber_id:me.id,provider:external.provider,external_actor:external.actor,target_name:external.name,target_avatar_url:external.avatarUrl} : { subscriber_id: me.id, target_user_id: targetUserId, provider:'limenote' },
          external ? {ignoreDuplicates:true} : { onConflict: 'subscriber_id,target_user_id', ignoreDuplicates: true },
        );

      if (error) {
        console.error('Enable post notification failed:', error);
        return { ok: false, reason: 'db-failed' };
      }

      queryClient.setQueryData(queryKeyFor(me.id, targetUserId), true);
      void queryClient.invalidateQueries({queryKey:['notification-subscriptions',me.id]});
      return { ok: true, enabled: true };
    } finally {
      setIsPending(false);
    }
  }, [me?.id, targetUserId, enabled, isPending, queryClient, external]);

  return { enabled, isPending, toggle };
}