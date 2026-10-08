/* LimeNote existing notifications -> iOS PWA push/badge bridge.
   This file is imported by the existing Workbox-generated Service Worker. */

(() => {
  const APP_BASE_PATH = '/RaimuNoteSNS.github.io/';
  const DEFAULT_ICON_URL = `${APP_BASE_PATH}pwa-192x192.png`;
  const NOTIFICATION_LIFETIME_MS = 30000;
  const DEFAULT_BADGE_URL = `${APP_BASE_PATH}pwa-192x192.png`;

  const readPushPayload = (event) => {
    if (!event.data) return {};

    try {
      return event.data.json();
    } catch {
      return {
        title: 'LimeNote',
        body: event.data.text(),
      };
    }
  };

  const getClientUrl = (url) => {
    const fallback = `${APP_BASE_PATH}notifications`;

    try {
      if (!url) return new URL(fallback, self.location.origin).href;
      const target=new URL(url,self.location.origin);
      return target.origin===self.location.origin && target.pathname.startsWith(APP_BASE_PATH)?target.href:new URL(fallback,self.location.origin).href;
    } catch {
      return new URL(fallback, self.location.origin).href;
    }
  };

  const setBadgeCount = async (count) => {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    const nav = self.navigator || {};
    const registration = self.registration || {};

    try {
      if (safeCount > 0) {
        if (typeof nav.setAppBadge === 'function') {
          await nav.setAppBadge(safeCount);
          return;
        }

        if (typeof registration.setAppBadge === 'function') {
          await registration.setAppBadge(safeCount);
          return;
        }
      }

      if (safeCount <= 0) {
        if (typeof nav.clearAppBadge === 'function') {
          await nav.clearAppBadge();
          return;
        }

        if (typeof registration.clearAppBadge === 'function') {
          await registration.clearAppBadge();
        }
      }
    } catch (error) {
      console.error('[LimeNote SW] App badge update failed:', error);
    }
  };

  const closeNotifications = async (ids, expiredOnly = false) => {
    const notices = await self.registration.getNotifications();
    notices.forEach(notice => {
      if (ids && !ids.includes(notice.data?.notificationId) && !ids.includes(notice.tag)) return;
      if (expiredOnly && (!notice.data?.expiresAt || notice.data.expiresAt > Date.now())) return;
      notice.close();
    });
  };

  self.addEventListener('push', (event) => {
    event.waitUntil((async () => {
      await closeNotifications(null,true);
      const payload = readPushPayload(event);
      const unreadCount = Number(payload.unread_count ?? payload.data?.unreadCount ?? 1);

      await setBadgeCount(unreadCount);

      const title = payload.title || 'LimeNote';
      const body = payload.body || '新しい通知があります';
      const icon = payload.icon || DEFAULT_ICON_URL;
      const badge = payload.badge || DEFAULT_BADGE_URL;
      const tag = payload.tag || payload.data?.notificationId || 'limenote-notification';
      const url = getClientUrl(payload.data?.url);

      await self.registration.showNotification(title, {
        body,
        icon,
        badge,
        tag,
        renotify: false,
        requireInteraction: false,
        data: {
          ...(payload.data || {}),
          url,
          expiresAt: Date.now() + NOTIFICATION_LIFETIME_MS,
        },
      });
      // Keep the push event alive until the notification expires. If the OS
      // suspends the worker earlier, the next push/message also clears expiry.
      await new Promise(resolve => setTimeout(resolve, NOTIFICATION_LIFETIME_MS));
      await closeNotifications(null,true);
    })());
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil((async () => {
      const targetUrl = getClientUrl(event.notification.data?.url);
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (!('focus' in client)) continue;

        const clientUrl = new URL(client.url);
        const target = new URL(targetUrl);

        if (clientUrl.origin === target.origin) {
          await client.focus();
          client.postMessage({
            type: 'LIME_NOTIFICATION_CLICK',
            url: target.pathname + target.search + target.hash,
            notificationId: event.notification.data?.notificationId,
          });
          return;
        }
      }

      const target = new URL(targetUrl);
      if(event.notification.data?.notificationId)target.searchParams.set('notification',event.notification.data.notificationId);
      await self.clients.openWindow(target.href);
    })());
  });

  self.addEventListener('message', (event) => {
    const data = event.data || {};
    if(data.type==='LIME_NOTIFICATIONS_READ'){event.waitUntil(Promise.all([setBadgeCount(data.count),closeNotifications(data.ids??[])]));return;}

    if (data.type === 'LIME_SET_BADGE') {
      event.waitUntil(Promise.all([setBadgeCount(Number(data.count || 0)),closeNotifications(null,true)]));
      return;
    }

    if (data.type === 'LIME_CLEAR_BADGE') {
      event.waitUntil(Promise.all([setBadgeCount(0),closeNotifications()]));
    }
  });
})();