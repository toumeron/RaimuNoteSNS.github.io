import { secretMatches } from '../_shared/security.ts';
type NotificationRecord = {
  id: string;
  is_read?: boolean;
  expires_at?:string;
  user_id: string;
  actor_id?: string | null;
  post_id?: string | null;
  type?: string | null;
  actor_name?: string | null;
  actor_avatar_url?: string | null;
  content_preview?: string | null;
  external_post_id?: string | null;
  actor_username?: string | null;
  emoji?: string | null;
  comment_id?: string | null;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushPayload = {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag: string;
  unread_count: number;
  data: {
    notificationId: string;
    postId: string | null;
    url: string;
    unreadCount: number;
  };
};

type SupabaseRestConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

type WebPushSendError = Error & {
  statusCode?: number;
  responseText?: string;
};

const textEncoder = new TextEncoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
  },
});

const getRequiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const stringToBase64Url = (value: string) => bytesToBase64Url(textEncoder.encode(value));

const concatBytes = (...arrays: Uint8Array[]) => {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });

  return result;
};

const hmacSha256 = async (keyBytes: Uint8Array, data: Uint8Array) => {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return new Uint8Array(await crypto.subtle.sign('HMAC', key, toArrayBuffer(data)));
};

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) => {
  const prk = await hmacSha256(salt, ikm);
  let previous = new Uint8Array(0);
  let output = new Uint8Array(0);
  let counter = 1;

  while (output.length < length) {
    previous = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([counter])));
    output = concatBytes(output, previous);
    counter += 1;
  }

  return output.slice(0, length);
};

const getNotificationTitle = (record: NotificationRecord) => {
  const actorName = record.actor_name || 'ユーザー';

  if (record.type === 'mention') {
    return `${actorName}さんからのメンション`;
  }

  // プロフィールのベルボタンで購読したユーザーの新規投稿
  if (record.type === 'new_post') {
    return `${actorName}さんが投稿しました`;
  }

  const labels:Record<string,string>={reply:'返信',like:'いいね',repost:'リポスト',reaction:'リアクション',follow:'フォロー'};
  return `${actorName}さんからの${labels[record.type??'']??'通知'}`;
};

const getNotificationBody = (record: NotificationRecord) => {
  if (record.content_preview) return record.content_preview;

  if (record.type === 'mention') {
    return 'ポストであなたをメンションしました';
  }

  if (record.type === 'new_post') {
    return '新しいポストを投稿しました';
  }

  const labels:Record<string,string>={reply:'あなたに返信しました',like:'あなたのポストをいいねしました',repost:'あなたのポストをリポストしました',reaction:`あなたのポストに${record.emoji??''}でリアクションしました`,follow:'あなたをフォローしました'};
  return labels[record.type??'']??'新しい通知があります';
};

const getNotificationUrl = (appOrigin: string, record: NotificationRecord) => {
  const path = record.external_post_id
    ? `/RaimuNoteSNS.github.io/post/${encodeURIComponent(record.external_post_id)}`
    : record.comment_id
      ? `/RaimuNoteSNS.github.io/post/${encodeURIComponent(`reply:${record.comment_id}`)}`
    : record.post_id
      ? `/RaimuNoteSNS.github.io/post/${record.post_id}`
      : record.actor_username && record.type==='follow'
        ? `/RaimuNoteSNS.github.io/u/${encodeURIComponent(record.actor_username)}`
        : '/RaimuNoteSNS.github.io/notifications';

  return new URL(path, appOrigin).toString();
};

const getNotificationIcon = (appOrigin: string, record: NotificationRecord) => {
  if (record.actor_avatar_url) return record.actor_avatar_url;
  return new URL('/RaimuNoteSNS.github.io/pwa-192x192.png', appOrigin).toString();
};

const restUrl = (config: SupabaseRestConfig, pathAndQuery: string) => (
  `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/${pathAndQuery}`
);

const restHeaders = (config: SupabaseRestConfig, extraHeaders?: HeadersInit) => ({
  apikey: config.serviceRoleKey,
  Authorization: `Bearer ${config.serviceRoleKey}`,
  ...extraHeaders,
});

const readRestJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Supabase REST request failed: ${response.status}`);
  }

  if (!text) return null as T;

  return JSON.parse(text) as T;
};

const selectRows = async <T>(config: SupabaseRestConfig, pathAndQuery: string) => {
  const response = await fetch(restUrl(config, pathAndQuery), {
    headers: restHeaders(config),
  });

  return readRestJson<T[]>(response);
};

const deleteRows = async (config: SupabaseRestConfig, pathAndQuery: string) => {
  const response = await fetch(restUrl(config, pathAndQuery), {
    method: 'DELETE',
    headers: restHeaders(config, { Prefer: 'return=minimal' }),
  });

  if (!response.ok) {
    throw new Error(await response.text() || `Supabase REST delete failed: ${response.status}`);
  }
};

const getExistingNotification = async (config: SupabaseRestConfig, notificationId: string) => {
  const select = 'id,is_read,expires_at,user_id,actor_id,post_id,type,actor_name,actor_avatar_url,content_preview,external_post_id,actor_username,emoji,comment_id';
  const rows = await selectRows<NotificationRecord>(
    config,
    `notifications?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(notificationId)}&limit=1`,
  );

  return rows[0] ?? null;
};

const getPushSubscriptions = async (config: SupabaseRestConfig, userId: string) => {
  const rows = await selectRows<PushSubscriptionRow>(
    config,
    `push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq.${encodeURIComponent(userId)}`,
  );

  return rows;
};

const getUnreadNotificationCount = async (config: SupabaseRestConfig, userId: string) => {
  const rows = await selectRows<{ id: string }>(
    config,
    `notifications?select=id&user_id=eq.${encodeURIComponent(userId)}&is_read=eq.false&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
  );

  return rows.length;
};

const createVapidJwt = async ({
  vapidPublicKey,
  vapidPrivateKey,
  audience,
  subject,
}: {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  audience: string;
  subject: string;
}) => {
  const publicKeyBytes = base64UrlToBytes(vapidPublicKey);
  const privateKeyBytes = base64UrlToBytes(vapidPrivateKey);

  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 public key');
  }

  if (privateKeyBytes.length !== 32) {
    throw new Error('VAPID_PRIVATE_KEY must be a 32-byte base64url value');
  }

  const jwtHeader = stringToBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const jwtPayload = stringToBase64Url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  }));
  const unsignedToken = `${jwtHeader}.${jwtPayload}`;

  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicKeyBytes.slice(1, 33)),
      y: bytesToBase64Url(publicKeyBytes.slice(33, 65)),
      d: bytesToBase64Url(privateKeyBytes),
      ext: false,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    toArrayBuffer(textEncoder.encode(unsignedToken)),
  ));

  return `${unsignedToken}.${bytesToBase64Url(signature)}`;
};

const encryptPushPayload = async ({
  payload,
  p256dh,
  auth,
}: {
  payload: string;
  p256dh: string;
  auth: string;
}) => {
  const receiverPublicKeyBytes = base64UrlToBytes(p256dh);
  const authSecret = base64UrlToBytes(auth);

  if (receiverPublicKeyBytes.length !== 65 || receiverPublicKeyBytes[0] !== 0x04) {
    throw new Error('push_subscriptions.p256dh must be an uncompressed P-256 public key');
  }

  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const localPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));
  const receiverPublicKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(receiverPublicKeyBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey },
    localKeyPair.privateKey,
    256,
  ));

  const prkInfo = concatBytes(
    textEncoder.encode('WebPush: info\0'),
    receiverPublicKeyBytes,
    localPublicKeyBytes,
  );
  const prk = await hkdf(authSecret, sharedSecret, prkInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, textEncoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, textEncoder.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', toArrayBuffer(cek), 'AES-GCM', false, ['encrypt']);

  const plaintext = concatBytes(textEncoder.encode(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    aesKey,
    toArrayBuffer(plaintext),
  ));

  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + localPublicKeyBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = localPublicKeyBytes.length;
  header.set(localPublicKeyBytes, 21);

  return concatBytes(header, ciphertext);
};

const sendWebPush = async ({
  subscription,
  payload,
  vapidPublicKey,
  vapidPrivateKey,
  vapidSubject,
}: {
  subscription: PushSubscriptionRow;
  payload: PushPayload;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
}) => {
  const endpointUrl = new URL(subscription.endpoint);
  const audience = endpointUrl.origin;
  const vapidToken = await createVapidJwt({
    vapidPublicKey,
    vapidPrivateKey,
    audience,
    subject: vapidSubject,
  });
  const encryptedPayload = await encryptPushPayload({
    payload: JSON.stringify(payload),
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  });

  const endpoint = new URL(subscription.endpoint);
  const pushHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || !(pushHosts.includes(endpoint.hostname) || /^(?:[a-z0-9-]+\.)?notify\.windows\.com$/i.test(endpoint.hostname))) throw new Error('Unsupported push endpoint');
  const response = await fetch(endpoint, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    method: 'POST',
    headers: {
      TTL: '2419200',
      Urgency: 'normal',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      Authorization: `vapid t=${vapidToken}, k=${vapidPublicKey}`,
    },
    body: toArrayBuffer(encryptedPayload),
  });

  if (!response.ok) {
    const error = new Error(`Web Push send failed: ${response.status}`) as WebPushSendError;
    error.statusCode = response.status;
    error.responseText = await response.text().catch(() => '');
    throw error;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';
    const authHeader = req.headers.get('authorization') || '';
    const pushSecretHeader = req.headers.get('x-push-secret') || '';

    if (!await secretMatches(authHeader.replace(/^Bearer\s+/i, ''), webhookSecret) && !await secretMatches(pushSecretHeader, webhookSecret)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublicKey = getRequiredEnv('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = getRequiredEnv('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
    const appOrigin = Deno.env.get('APP_ORIGIN') || 'https://toumeron.github.io';
    const config = { supabaseUrl, serviceRoleKey };

    const payload = await req.json().catch(() => ({}));
    const notificationId = payload.notification_id || payload.record?.id || payload.id;

    if (!notificationId) {
      return jsonResponse({ error: 'notification_id is required' }, 400);
    }

    // 既存の public.notifications を正として使う。
    // Edge Function側では通知レコードを作らない。
    const record = await getExistingNotification(config, notificationId);

    if (!record?.id || !record.user_id) {
      return jsonResponse({ error: 'notification not found' }, 404);
    }

    const settings=await selectRows<{notification_preferences?:Record<string,boolean>}>(config,`profile_private_settings?select=notification_preferences&user_id=eq.${encodeURIComponent(record.user_id)}&limit=1`);
    const preferences=settings[0]?.notification_preferences??{};
    if(preferences.push===false || preferences[record.type??'']===false)return jsonResponse({ok:true,sent:0,skipped:true});

    if(record.is_read||record.expires_at&&Date.parse(record.expires_at)<=Date.now())return jsonResponse({ok:true,sent:0,skipped:true});

    if (record.post_id) {
      const posts = await selectRows<{user_id: string; visibility: string}>(config,
        `posts?select=user_id,visibility&id=eq.${encodeURIComponent(record.post_id)}&limit=1`);
      const post = posts[0];
      let allowed = !!post && (post.visibility === 'public' || post.user_id === record.user_id);
      if (post && !allowed && post.visibility === 'following') {
        allowed = (await selectRows(config, `follows?select=follower_id&follower_id=eq.${encodeURIComponent(post.user_id)}&followee_id=eq.${encodeURIComponent(record.user_id)}&limit=1`)).length > 0;
      }
      if (post && !allowed && post.visibility === 'members') {
        allowed = (await selectRows(config, `memberships?select=member_id&creator_id=eq.${encodeURIComponent(post.user_id)}&member_id=eq.${encodeURIComponent(record.user_id)}&limit=1`)).length > 0;
      }
      if (!allowed) return jsonResponse({ok: true, sent: 0, skipped: true});
    }

    const subscriptions = await getPushSubscriptions(config, record.user_id);

    if (subscriptions.length === 0) {
      return jsonResponse({ ok: true, sent: 0, deleted: 0, failed: 0 });
    }

    let unreadCount = 1;

    try {
      unreadCount = await getUnreadNotificationCount(config, record.user_id);
    } catch (error) {
      console.error('Unread notification count failed:', error);
    }

    const safeUnreadCount = Math.max(1, unreadCount || 1);
    const notificationPayload: PushPayload = {
      title: getNotificationTitle(record),
      body: getNotificationBody(record),
      icon: getNotificationIcon(appOrigin, record),
      badge: new URL('/RaimuNoteSNS.github.io/pwa-192x192.png', appOrigin).toString(),
      tag: record.id,
      unread_count: safeUnreadCount,
      data: {
        notificationId: record.id,
        postId: record.post_id || null,
        url: getNotificationUrl(appOrigin, record),
        unreadCount: safeUnreadCount,
      },
    };

    let sent = 0;
    let deleted = 0;
    let failed = 0;

    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await sendWebPush({
          subscription,
          payload: notificationPayload,
          vapidPublicKey,
          vapidPrivateKey,
          vapidSubject,
        });
        sent += 1;
      } catch (error) {
        const webPushError = error as WebPushSendError;

        if (webPushError.statusCode === 404 || webPushError.statusCode === 410) {
          try {
            await deleteRows(config, `push_subscriptions?id=eq.${encodeURIComponent(subscription.id)}`);
            deleted += 1;
          } catch (deleteError) {
            console.error('Delete invalid push subscription failed:', deleteError);
            failed += 1;
          }
          return;
        }

        failed += 1;
        console.error('Web Push send failed:', {
          statusCode: webPushError.statusCode,
          responseText: webPushError.responseText,
          message: webPushError.message,
        });
      }
    }));

    return jsonResponse({ ok: true, sent, deleted, failed });
  } catch (error) {
    console.error('send-push failed:', error);
    return jsonResponse({ error: 'Notification delivery failed' }, 500);
  }
});