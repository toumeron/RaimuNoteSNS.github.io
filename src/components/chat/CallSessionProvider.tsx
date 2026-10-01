import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { microphoneErrorMessage, requestMicrophonePermission } from '@/lib/microphone';

type CallSession = {
  start: (render: (close: () => void) => ReactNode) => void;
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
  const isActive = useCallback(() => active.current, []);
  const start = useCallback((render: (close: () => void) => ReactNode) => {
    if (pending.current || active.current) return;
    pending.current = true;
    // Call getUserMedia immediately, before any timer or asynchronous setup.
    requestMicrophonePermission().then(() => {
      if (!mounted.current) return;
      active.current = true;
      setCall(render(close));
    }).catch(error => {
      if (mounted.current) toast.error(microphoneErrorMessage(error), { duration: 10000 });
    }).finally(() => { pending.current = false; });
  }, [close]);
  return <CallSessionContext.Provider value={{ start, isActive }}>{children}{call}</CallSessionContext.Provider>;
}

export function useCallSession() {
  const context = useContext(CallSessionContext);
  if (!context) throw new Error('CallSessionProvider is required');
  return context;
}
