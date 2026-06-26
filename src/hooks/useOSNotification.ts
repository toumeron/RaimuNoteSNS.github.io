import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from "sonner";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

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

async function updateAppBadge(currentUserId: string) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', currentUserId)
    .eq('is_read', false);

  if (error) {
    console.error('Unread notification count failed:', error);
    return;
  }

  const unreadCount = count || 0;
  const badgeNavigator = navigator as BadgeNavigator;

  try {
    if (unreadCount > 0 && typeof badgeNavigator.setAppBadge === 'function') {
      await badgeNavigator.setAppBadge(unreadCount);
    } else if (unreadCount <= 0 && typeof badgeNavigator.clearAppBadge === 'function') {
      await badgeNavigator.clearAppBadge();
    }
  } catch (error) {
    console.error('App badge update failed:', error);
  }

  try {
    const registration = await navigator.serviceWorker?.ready;
    registration?.active?.postMessage({
      type: unreadCount > 0 ? 'LIME_SET_BADGE' : 'LIME_CLEAR_BADGE',
      count: unreadCount,
    });
  } catch {
    // Service Workerが未準備でも、通常の画面側バッジ更新は継続する。
  }
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

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: currentUserId,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' })
      .select('endpoint')
      .maybeSingle();

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

async function requestPermissionAndSubscribe(currentUserId: string) {
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

function bindPermissionRequest(currentUserId: string, onSubscribed: () => void) {
  if (!isPushSupported()) return () => {};

  let busy = false;
  let cleanup: (() => void) | null = null;

  const handleUserGesture = () => {
    if (busy) return;
    if (Notification.permission === 'denied') return;

    busy = true;
    requestPermissionAndSubscribe(currentUserId)
      .then((saved) => {
        if (!saved) return;
        onSubscribed();
        cleanup?.();
      })
      .finally(() => {
        busy = false;
      });
  };

  cleanup = () => {
    window.removeEventListener('pointerdown', handleUserGesture);
    window.removeEventListener('touchend', handleUserGesture);
    window.removeEventListener('click', handleUserGesture);
    window.removeEventListener('keydown', handleUserGesture);
  };

  window.addEventListener('pointerdown', handleUserGesture, { passive: true });
  window.addEventListener('touchend', handleUserGesture, { passive: true });
  window.addEventListener('click', handleUserGesture, { passive: true });
  window.addEventListener('keydown', handleUserGesture);

  return cleanup;
}

async function showRealtimeOSNotification({
  title,
  message,
  iconUrl,
  postId,
}: {
  title: string;
  message: string;
  iconUrl: string;
  postId?: string | null;
}) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const url = postId
    ? `${import.meta.env.BASE_URL}post/${postId}`
    : `${import.meta.env.BASE_URL}notifications`;

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (typeof registration.showNotification === 'function') {
        await registration.showNotification(title, {
          body: message,
          icon: iconUrl,
          tag: postId ? `notification-${postId}` : 'notification',
          data: { url },
        });
        return;
      }
    }

    new Notification(title, {
      body: message,
      icon: iconUrl,
      tag: postId ? `notification-${postId}` : 'notification',
      data: { url },
    });
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

    const unbindPermissionRequest = bindPermissionRequest(currentUserId, () => {
      hasSavedPushSubscription = true;
    });

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
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type !== 'LIME_NOTIFICATION_CLICK' || !data.url) return;

      const targetUrl = new URL(data.url, window.location.origin);
      window.history.pushState({}, '', targetUrl.pathname + targetUrl.search + targetUrl.hash);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };

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
        (payload) => {
          const { actor_name, actor_avatar_url, content_preview, post_id, type } = payload.new;

          const actorName = actor_name || 'ユーザー';
          const title = type === 'mention'
            ? `${actorName}さんからのメンション`
            : `${actorName}さんからの通知`;
          const message = content_preview || (type === 'mention'
            ? 'ポストであなたをメンションしました'
            : '新しい通知があります');
          const iconUrl = actor_avatar_url || `${import.meta.env.BASE_URL}favicon.ico`;

          toast(title, {
            description: message,
            icon: actor_avatar_url ? undefined : '🔔',
          });

          updateAppBadge(currentUserId);
          ensurePushSubscription();

          // Push購読済みの場合は、既存notifications INSERT → send-push → Service Worker通知に任せる。
          // ここでさらにOS通知を出すと、macOS/Android/iOS PWAで二重通知になるため出さない。
          if (isNotificationSupported && !hasSavedPushSubscription) {
            showRealtimeOSNotification({ title, message, iconUrl, postId: post_id });
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
      unbindPermissionRequest();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);
}
