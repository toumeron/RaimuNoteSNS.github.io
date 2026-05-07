import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from "sonner";

export function useOSNotification(currentUserId: string | null) {
  useEffect(() => {
    if (!currentUserId) return;

    if (Notification.permission === 'default') {
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
          // アバターがない場合のデフォルト画像
          const iconUrl = actor_avatar_url || `${import.meta.env.BASE_URL}favicon.ico`;

          // 1. Sonner（アプリ内トースト）
          toast(title, {
            description: message,
            // ここにアバターを表示する設定を追加
            icon: actor_avatar_url ? undefined : "🔔", 
          });

          // 2. OS通知
          if (Notification.permission === 'granted') {
            new Notification(title, {
              body: message,
              icon: iconUrl, // ここが相手のアイコンになる
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