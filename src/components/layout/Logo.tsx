import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type LimeProStatusEvent = CustomEvent<{
  hasLimePro: boolean;
}>;

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: { text: 'text-lg', icon: 'h-5 w-5' },
    md: { text: 'text-2xl', icon: 'h-6 w-6' },
    lg: { text: 'text-4xl', icon: 'h-9 w-9' },
  } as const;

  const s = sizes[size];

  const mountedRef = useRef(true);
  const statusRef = useRef<boolean | null>(null);
  const localChangeVersionRef = useRef(0);

  const readCachedStatus = () => {
    const cached = localStorage.getItem('limepro_status');

    if (cached === 'true') return true;
    if (cached === 'false') return false;

    return null;
  };

  const [hasLimePro, setHasLimePro] = useState<boolean | null>(() => {
    const cached = readCachedStatus();
    statusRef.current = cached;
    return cached;
  });

  useEffect(() => {
    mountedRef.current = true;

    let broadcastChannel: BroadcastChannel | null = null;

    const applyLimeProStatus = (nextStatus: boolean, fromLocalChange = false) => {
      if (fromLocalChange) {
        localChangeVersionRef.current += 1;
      }

      statusRef.current = nextStatus;
      localStorage.setItem('limepro_status', String(nextStatus));

      if (mountedRef.current) {
        setHasLimePro(nextStatus);
      }
    };

    const syncFromLocalStorage = () => {
      const cached = readCachedStatus();

      if (typeof cached === 'boolean' && cached !== statusRef.current) {
        applyLimeProStatus(cached, true);
      }
    };

    const fetchLimeProStatus = async () => {
      const versionAtStart = localChangeVersionRef.current;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (versionAtStart === localChangeVersionRef.current) {
          applyLimeProStatus(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('user_entitlements')
        .select('feature')
        .eq('user_id', user.id)
        .eq('feature', 'limepro')
        .maybeSingle();

      if (error) {
        console.error('Fetch Logo LimePro Status Error:', error);
        return;
      }

      if (versionAtStart !== localChangeVersionRef.current) {
        return;
      }

      applyLimeProStatus(!!data);
    };

    const handleLocalLimeProChange = (event: Event) => {
      const customEvent = event as LimeProStatusEvent;
      const nextStatus = customEvent.detail?.hasLimePro;

      if (typeof nextStatus === 'boolean') {
        applyLimeProStatus(nextStatus, true);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== 'limepro_status') return;
      syncFromLocalStorage();
    };

    const handleFocusOrVisible = () => {
      syncFromLocalStorage();
      fetchLimeProStatus();
    };

    window.addEventListener('limepro-status-changed', handleLocalLimeProChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    if ('BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel('limepro-status');

      broadcastChannel.onmessage = (event) => {
        const nextStatus = event.data?.hasLimePro;

        if (typeof nextStatus === 'boolean') {
          applyLimeProStatus(nextStatus, true);
        }
      };
    }

    const syncTimer = window.setInterval(syncFromLocalStorage, 100);

    fetchLimeProStatus();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      fetchLimeProStatus();
    });

    return () => {
      mountedRef.current = false;

      window.removeEventListener('limepro-status-changed', handleLocalLimeProChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);

      window.clearInterval(syncTimer);

      subscription.unsubscribe();

      if (broadcastChannel) {
        broadcastChannel.close();
      }
    };
  }, []);

  return (
    <Link to="/" className="inline-flex items-center gap-2 font-display font-black">
      <span className={`${s.text} bg-gradient-primary bg-clip-text text-transparent`}>
        Lime
      </span>
      <span className={`${s.text} text-accent ${hasLimePro === null ? 'invisible' : ''}`}>
        {hasLimePro ? 'Pro' : 'Note'}
      </span>
    </Link>
  );
}