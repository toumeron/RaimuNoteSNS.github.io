import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { microphoneErrorMessage, requestMicrophonePermission } from "@/lib/microphone";
import { unlockAudioPlayback } from "@/lib/callTranscription";
import { createPortal } from "react-dom";
import { Phone } from "lucide-react";
import { playIncomingRingtone } from "@/lib/incomingRingtone";
import "@/components/chat/friend-profile.css";

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

export { CallSessionProvider };
export { useCallSession };
export { IncomingFriendCall };
