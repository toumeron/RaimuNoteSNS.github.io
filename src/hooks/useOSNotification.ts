import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from "sonner";

export function useOSNotification(currentUserId: string | null) {
  useEffect(() => {
    if (!currentUserId) return;

    // --- 修正ポイント1: Notificationの存在チェック ---
    const isNotificationSupported = typeof window !== 'undefined' && 'Notification' in window;

    if (isNotificationSupported && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const channel = supabase
      .channel('os-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const { actor_name, actor_avatar_url, content_preview } = payload.new;
          
          const title = `${actor_name}さんからのメンション`;
          const message = content_preview || "ポストであなたをメンションしました";
          const iconUrl = actor_avatar_url || `${import.meta.env.BASE_URL}favicon.ico`;

          // 1. Sonner（アプリ内トースト）
          // これはブラウザでも動くのでそのまま
          toast(title, {
            description: message,
            icon: actor_avatar_url ? undefined : "🔔", 
          });

          // 2. OS通知
          // --- 修正ポイント2: 実行時にも存在と許可を確認 ---
          if (isNotificationSupported && Notification.permission === 'granted') {
            new Notification(title, {
              body: message,
              icon: iconUrl,
              tag: "mention",
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);
}