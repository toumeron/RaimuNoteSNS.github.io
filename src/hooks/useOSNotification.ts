import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from "sonner";

export function useOSNotification(currentUserId: string | null) {
  useEffect(() => {
    if (!currentUserId) return;

    // windowの中にNotificationが存在するかをチェック
    const isNotificationSupported = typeof window !== 'undefined' && 'Notification' in window;

    // ブラウザが対応している場合のみ許可を求める
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
          // これは環境に依存せず動くのでそのまま
          toast(title, {
            description: message,
            icon: actor_avatar_url ? undefined : "🔔", 
          });

          // 2. OS通知
          // 通知に対応しており、かつ許可されている場合のみ実行
          if (isNotificationSupported && Notification.permission === 'granted') {
            try {
              new Notification(title, {
                body: message,
                icon: iconUrl,
                tag: "mention",
              });
            } catch (e) {
              console.error("Notification creation failed:", e);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);
}