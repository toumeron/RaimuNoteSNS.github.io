import { useCallback, useMemo, useSyncExternalStore } from 'react';
const eventName = 'lime-hidden-trends-changed';
const memory = new Map<string, string>();
function read(key: string): string {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key) ?? '[]'; } catch { return '[]'; }
}
function subscribe(callback: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null) memory.clear();
    else if (event.key.startsWith('lime_hidden_trends:')) memory.delete(event.key);
    else return;
    callback();
  };
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', storageChanged);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener('storage', storageChanged);
  };
}
export function useHiddenTrends(viewerId: string | null) {
  const key = `lime_hidden_trends:${viewerId ?? 'guest'}`;
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => read(key), [key]), () => '[]');
  const hidden = useMemo(() => {
    try {
      const value = JSON.parse(snapshot);
      return new Set<string>(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
    } catch { return new Set<string>(); }
  }, [snapshot]);
  const hide = useCallback((title: string) => {
    const value = JSON.stringify([...new Set([...hidden, title])].slice(-200));
    memory.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* Keep both views synchronized without storage. */ }
    window.dispatchEvent(new Event(eventName));
  }, [key, hidden]);
  return [hidden, hide] as const;
}
