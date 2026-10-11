import { useEffect, useRef, useState } from 'react';
import { unlockIncomingRingtone } from '@/lib/incomingRingtone';

export const INCOMING_CALL_TIMEOUT = 45000;
export function incomingCallDelay(first: boolean, random = Math.random): number {
  const [minimum, maximum] = first ? [3, 8] : [8, 20];
  return Math.round((minimum + random() * (maximum - minimum)) * 60000);
}

/** Foreground, one-shot scheduling; no server polling or background job. */
export function useIncomingFriendCalls<T>({ account, busy, prepare }: {
  account: string | null;
  busy: () => boolean;
  prepare: (signal: AbortSignal) => Promise<T | null>;
}) {
  const [incoming, setIncoming] = useState<T | null>(null);
  const latest = useRef({ busy, prepare }); latest.current = { busy, prepare };
  const dismiss = () => setIncoming(null);
  useEffect(() => {
    setIncoming(null);
    if (!account) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | null = null;
    const key = `limeai:${account}:next-incoming-call`;
    const read = () => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } };
    const write = (value: number) => { try { localStorage.setItem(key, String(value)); } catch { /* no persistence */ } };
    const reschedule = (first = false) => {
      const next = Date.now() + incomingCallDelay(first);
      write(next); return next;
    };
    const schedule = () => {
      clearTimeout(timer);
      if (disposed || document.visibilityState === 'hidden') return;
      let due = read();
      // No catch-up burst when the app returns after a long absence.
      if (!due || due < Date.now() - 60000 || due > Date.now() + incomingCallDelay(false, () => 1)) due = reschedule(true);
      timer = setTimeout(attempt, Math.max(1000, due - Date.now()));
    };
    const attempt = async () => {
      if (disposed || document.visibilityState === 'hidden') return;
      if (latest.current.busy()) { reschedule(true); schedule(); return; }
      const claim = async () => {
        if (disposed || read() > Date.now() + 1000) return;
        reschedule();
        request = new AbortController();
        const timeout = setTimeout(() => request?.abort(), 25000);
        try {
          const offer = await latest.current.prepare(request.signal);
          if (!disposed && !request.signal.aborted && document.visibilityState !== 'hidden' && !latest.current.busy()) setIncoming(offer);
        } catch { /* Failed preparations never create an empty call. */ }
        finally { clearTimeout(timeout); request = null; }
      };
      try {
        if (navigator.locks) await navigator.locks.request(key, { ifAvailable: true }, lock => lock ? claim() : undefined);
        else await claim();
      } catch { reschedule(); }
      finally { schedule(); }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); request?.abort(); setIncoming(null); }
      else schedule();
    };
    const storage = (event: StorageEvent) => { if (event.key === key) schedule(); };
    window.addEventListener('pointerdown', unlockIncomingRingtone);
    window.addEventListener('keydown', unlockIncomingRingtone);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visibility);
    schedule();
    return () => {
      disposed = true; clearTimeout(timer); request?.abort();
      window.removeEventListener('pointerdown', unlockIncomingRingtone);
      window.removeEventListener('keydown', unlockIncomingRingtone);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [account]);
  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => setIncoming(null), INCOMING_CALL_TIMEOUT);
    return () => clearTimeout(timer);
  }, [incoming]);
  return { incoming, dismiss };
}
