import {isMisskeyId} from '@/lib/misskey';
import { useEffect, useState } from 'react';
import {
  BSKY_SESSION_STORAGE_KEY,
  getStoredBlueskySession,
  type BlueskySession,
} from '@/lib/bluesky';

/**
 * 自分のBlueskyアカウントでのログイン状態を購読するフック。
 *
 * ログイン/ログアウト/セッション更新は Settings.tsx（設定画面）や
 * 他タブから行われる可能性があるため、以下の両方を購読して同期する。
 * - 同タブ内: CustomEvent('lime-bluesky-session-changed')
 * - 他タブ: storage イベント(localStorageの変更)
 *
 * 戻り値が非nullの間だけ、Bluesky投稿に対する「いいね」「フォロー」を
 * 実際に実行できる状態とみなす。
 */
export function useBlueskySession(targetId?:string): BlueskySession | null {
  const [session, setSession] = useState<BlueskySession | null>(()=>isMisskeyId(targetId) ? null : getStoredBlueskySession());

  useEffect(() => {
    const syncFromStorage = () => setSession(isMisskeyId(targetId) ? null : getStoredBlueskySession());
    syncFromStorage();

    const handleSessionChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ session: BlueskySession | null }>).detail;
      if (isMisskeyId(targetId)) syncFromStorage(); else setSession(detail?.session ?? getStoredBlueskySession());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === BSKY_SESSION_STORAGE_KEY || event.key === null) {
        syncFromStorage();
      }
    };

    window.addEventListener('lime-bluesky-session-changed', handleSessionChanged);
    window.addEventListener('lime-misskey-changed', syncFromStorage);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('lime-bluesky-session-changed', handleSessionChanged);
      window.removeEventListener('lime-misskey-changed', syncFromStorage);
      window.removeEventListener('storage', handleStorage);
    };
  }, [targetId]);

  return session;
}