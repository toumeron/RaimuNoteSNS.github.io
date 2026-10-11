import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { microphoneErrorMessage, requestMicrophonePermission } from '@/lib/microphone';
import { unlockAudioPlayback } from '@/lib/audioPlayback';

type CallSession = {
  start: (render: (close: () => void) => ReactNode) => Promise<boolean>;
  isActive: () => boolean;
};
const CallSessionContext = createContext<CallSession | null>(null);

/** Lives above the route outlet so navigation does not tear down the call. */
export function CallSessionProvider({ children }: { children: ReactNode }) {
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

export function useCallSession() {
  const context = useContext(CallSessionContext);
  if (!context) throw new Error('CallSessionProvider is required');
  return context;
}
