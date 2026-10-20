import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { microphoneErrorMessage, requestMicrophonePermission, unlockAudioPlayback } from "@/lib/callRecorder";
import { createPortal } from "react-dom";
import { Phone } from "lucide-react";
import { playIncomingRingtone, unlockIncomingRingtone } from "@/lib/callRecorder";

// CallSessionProvider
type CallSession = {
  start: (render: (close: () => void) => ReactNode) => Promise<boolean>;
  isActive: () => boolean;
};
const CallSessionContext = createContext<CallSession | null>(null);

/** Lives above the route outlet so navigation does not tear down the call. */
function CallSessionProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<ReactNode>(null);
  const active = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current = false; };
  }, []);
  const close = useCallback(() => {
    active.current = false;
    setCall(null);
  }, []);
  const isActive = useCallback(() => active.current || pending.current, []);
  const start = useCallback((render: (close: () => void) => ReactNode) => {
    if (pending.current || active.current) return Promise.resolve(false);
    pending.current = true;
    unlockAudioPlayback();
    // Call getUserMedia immediately, before any timer or asynchronous setup.
    return requestMicrophonePermission().then(() => {
      if (!mounted.current) return false;
      active.current = true;
      setCall(render(close));
      return true;
    }).catch(error => {
      if (mounted.current) toast.error(microphoneErrorMessage(error), { duration: 10000 });
      return false;
    }).finally(() => { pending.current = false; });
  }, [close]);
  return <CallSessionContext.Provider value={{ start, isActive }}>{children}{call}</CallSessionContext.Provider>;
}

function useCallSession() {
  const context = useContext(CallSessionContext);
  if (!context) throw new Error('CallSessionProvider is required');
  return context;
}

// IncomingFriendCall
function IncomingFriendCall({ name, avatar, onAnswer, onDecline }: {
  name: string; avatar: string; onAnswer: () => Promise<boolean>; onDecline: () => void;
}) {
  const [answering, setAnswering] = useState(false);
  useEffect(() => playIncomingRingtone(), []);
  return createPortal(<section className="lime-incoming-call" role="alertdialog" aria-label={`${name}から着信`} aria-describedby="lime-incoming-status">
    <img className="lime-incoming-avatar" src={avatar} alt="" />
    <div className="lime-incoming-person"><strong>{name}</strong><span id="lime-incoming-status">{answering ? '接続中…' : 'フレンドからの着信'}</span></div>
    <div className="lime-incoming-actions">
      <button type="button" className="decline" disabled={answering} aria-label="着信を拒否" onClick={onDecline}><Phone fill="currentColor"/><span>拒否</span></button>
      <button type="button" className="answer" disabled={answering} aria-label="着信に応答" onClick={async () => {
        setAnswering(true);
        try { if (await onAnswer()) onDecline(); }
        finally { setAnswering(false); }
      }}><Phone fill="currentColor"/><span>応答</span></button>
    </div>
  </section>, document.body);
}

// useIncomingFriendCalls
const INCOMING_CALL_TIMEOUT = 45000;
function incomingCallDelay(first: boolean, random = Math.random): number {
  const [minimum, maximum] = first ? [3, 8] : [8, 20];
  return Math.round((minimum + random() * (maximum - minimum)) * 60000);
}

/** Foreground, one-shot scheduling; no server polling or background job. */
function useIncomingFriendCalls<T>({ account, busy, prepare }: {
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
    window.addEventListener('touchend', unlockIncomingRingtone);
    window.addEventListener('click', unlockIncomingRingtone);
    window.addEventListener('keydown', unlockIncomingRingtone);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visibility);
    schedule();
    return () => {
      disposed = true; clearTimeout(timer); request?.abort();
      window.removeEventListener('pointerdown', unlockIncomingRingtone);
      window.removeEventListener('touchend', unlockIncomingRingtone);
      window.removeEventListener('click', unlockIncomingRingtone);
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

export { CallSessionProvider };
export { useCallSession };
export { IncomingFriendCall };
export { incomingCallDelay };
export { useIncomingFriendCalls };
export { INCOMING_CALL_TIMEOUT };
