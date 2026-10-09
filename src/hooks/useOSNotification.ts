import { getNotificationPreferences, notificationDescription, notificationLink, markNotificationsRead, type NotificationRow } from '@/api/notifications';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {refreshNotificationBadge as updateAppBadge} from '@/lib/notificationBadge';
import {showNotificationToast,dismissNotificationToasts} from '@/lib/notificationToast';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

type PushSubscriptionWithKeys = PushSubscription & {
  getKey?: (name: PushEncryptionKeyName) => ArrayBuffer | null;
};

function urlBase64ToArrayBuffer(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  const buffer = new ArrayBuffer(outputArray.byteLength);
  new Uint8Array(buffer).set(outputArray);
  return buffer;
}

function arrayBufferToBase64Url(buffer: BufferSource | null | undefined) {
  if (!buffer) return '';

  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  let binary = '';

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

async function getReadyServiceWorkerRegistration() {
  const registration = await navigator.serviceWorker.ready;

  try {
    await registration.update();
  } catch {
    // 更新確認に失敗しても、既存のService Workerで購読処理は続ける。
  }

  return registration;
}

function getSubscriptionKey(subscription: PushSubscriptionWithKeys, keyName: PushEncryptionKeyName) {
  const jsonValue = subscription.toJSON().keys?.[keyName];
  if (jsonValue) return jsonValue;

  return arrayBufferToBase64Url(subscription.getKey?.(keyName) ?? null);
}

async function savePushSubscription(currentUserId: string) {
  if (!isPushSupported()) return false;

  if (!VAPID_PUBLIC_KEY) {
    console.error('VITE_VAPID_PUBLIC_KEY is not set. iOS PWA background push cannot be registered.');
    return false;
  }

  if (Notification.permission !== 'granted') return false;

  try {
    const applicationServerKey = urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY);
    const registration = await getReadyServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();

    const currentKey = arrayBufferToBase64Url(applicationServerKey);
    const subscriptionKey = arrayBufferToBase64Url(subscription?.options?.applicationServerKey ?? null);

    if (subscription && subscriptionKey && subscriptionKey !== currentKey) {
      try {
        await subscription.unsubscribe();
      } catch (error) {
        console.error('Unsubscribe stale push subscription failed:', error);
      }

      subscription = null;
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const p256dh = getSubscriptionKey(subscription as PushSubscriptionWithKeys, 'p256dh');
    const auth = getSubscriptionKey(subscription as PushSubscriptionWithKeys, 'auth');

    if (!subscription.endpoint || !p256dh || !auth) {
      console.error('Push subscription is missing endpoint/p256dh/auth.');
      return false;
    }

    // 同じブラウザ(endpoint)で別アカウントにログインし直した場合、既存行が別ユーザーのものだと
    // RLSでupsertが弾かれる(42501)。そのため、endpointを現在のユーザーに付け替えて保存する
    // SECURITY DEFINER のDB関数(supabase_fix_push_subscriptions.sql)経由で保存する。
    const { error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent,
    });

    if (error) {
      console.error('Save push subscription failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Save push subscription failed:', error);
    return false;
  }
}

// プロフィールのベルボタン(usePostNotifications.ts)からも使うため export している。
export async function requestPermissionAndSubscribe(currentUserId: string) {
  if (!isPushSupported()) return false;

  try {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

    if (permission !== 'granted') return false;

    const saved = await savePushSubscription(currentUserId);
    await updateAppBadge(currentUserId);
    return saved;
  } catch (error) {
    console.error('Push notification registration failed:', error);
    return false;
  }
}

async function showRealtimeOSNotification({
  title,
  message,
  iconUrl,
  postId,
  targetUrl,
  notificationId,
}: {
  title: string;
  message: string;
  iconUrl: string;
  postId?: string | null;
  targetUrl?: string;
  notificationId: string;
}) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const url = targetUrl ?? (postId
    ? `${import.meta.env.BASE_URL}post/${postId}`
    : `${import.meta.env.BASE_URL}notifications`);

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (typeof registration.showNotification === 'function') {
        await registration.showNotification(title, {
          body: message,
          icon: iconUrl,
          tag: notificationId,
          requireInteraction: false,
          data: { url,notificationId,expiresAt:Date.now()+30000 },
        });
        window.setTimeout(()=>{void registration.getNotifications({tag:notificationId}).then(notices=>notices.forEach(n=>{if(n.data?.expiresAt<=Date.now())n.close();})).catch(()=>{});},30000);
        return;
      }
    }

    const notice = new Notification(title, {
      body: message,
      icon: iconUrl,
      tag: notificationId,
          requireInteraction: false,
      data: { url,notificationId,expiresAt:Date.now()+30000 },
    });
    window.setTimeout(()=>notice.close(),30000);
    notice.onclick=()=>{notice.close();const target=new URL(url,window.location.origin);target.searchParams.set('notification',notificationId);window.location.assign(target.href);};
  } catch (error) {
    console.error('Notification creation failed:', error);
  }
}

export function useOSNotification(currentUserId: string | null) {
  useEffect(() => {
    if (!currentUserId) return;

    const isNotificationSupported = typeof window !== 'undefined' && 'Notification' in window;
    let hasSavedPushSubscription = false;
    let cancelled = false;

    const ensurePushSubscription = async () => {
      if (!isPushSupported()) return;
      if (Notification.permission !== 'granted') return;

      const saved = await savePushSubscription(currentUserId);
      if (cancelled) return;
      hasSavedPushSubscription = saved || hasSavedPushSubscription;
    };

    ensurePushSubscription();

    // Permission is requested only by the bell or notification settings button.

    updateAppBadge(currentUserId);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateAppBadge(currentUserId);
        ensurePushSubscription();
      }
    };

    const handleFocus = () => {
      updateAppBadge(currentUserId);
      ensurePushSubscription();
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string;notificationId?:string } | undefined;
      if (data?.type !== 'LIME_NOTIFICATION_CLICK' || !data.url) return;

      if(data.notificationId)void markNotificationsRead(currentUserId,[data.notificationId]).catch(()=>{});
      const targetUrl = new URL(data.url, window.location.origin);
      if(targetUrl.origin!==window.location.origin)return;
      window.history.pushState({}, '', targetUrl.pathname + targetUrl.search + targetUrl.hash);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const clickedId=new URLSearchParams(window.location.search).get('notification');
    if(clickedId && /^[0-9a-f-]{36}$/i.test(clickedId)){void markNotificationsRead(currentUserId,[clickedId]).catch(()=>{});const url=new URL(window.location.href);url.searchParams.delete('notification');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    const channel = supabase
      .channel(`os-notifications-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        async (payload) => {
          if(payload.new.is_read)return;
          void updateAppBadge(currentUserId);
          if(window.location.pathname.replace(/^\/RaimuNoteSNS\.github\.io/,'')==='/notifications'){void markNotificationsRead(currentUserId,[payload.new.id]).catch(()=>{});return;}
          const preferences = await getNotificationPreferences(currentUserId).catch(() => null);
          if (cancelled || !preferences || preferences[(payload.new as NotificationRow).type] === false) return;
          const { actor_name, actor_avatar_url, content_preview, post_id, type } = payload.new;

          const actorName = actor_name || 'ユーザー';
          // 種類ごとの文言。new_post はプロフィールのベルボタンで購読したユーザーの新規投稿。
          const title = type === 'mention'
            ? `${actorName}さんからのメンション`
            : type === 'new_post'
              ? `${actorName}`
              : `${actorName}${notificationDescription((payload.new as NotificationRow).type,(payload.new as NotificationRow).emoji)}`;
          const message = content_preview || (type === 'mention'
            ? 'ポストであなたをメンションしました'
            : type === 'new_post'
              ? '新しいポストを投稿しました'
              : notificationDescription((payload.new as NotificationRow).type,(payload.new as NotificationRow).emoji).replace(/^さんが/,''));
          const iconUrl = actor_avatar_url || `${import.meta.env.BASE_URL}favicon.ico`;

          showNotificationToast(payload.new.id,title,message);

          ensurePushSubscription();

          // Push購読済みの場合は、既存notifications INSERT → send-push → Service Worker通知に任せる。
          // ここでさらにOS通知を出すと、macOS/Android/iOS PWAで二重通知になるため出さない。
          if (preferences.push && isNotificationSupported && !hasSavedPushSubscription) {
            showRealtimeOSNotification({ title, message, iconUrl, postId: post_id,notificationId:payload.new.id, targetUrl: `${import.meta.env.BASE_URL.replace(/\/$/,'')}${notificationLink(payload.new as NotificationRow)}` });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          updateAppBadge(currentUserId);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          updateAppBadge(currentUserId);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      dismissNotificationToasts();

      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);
}