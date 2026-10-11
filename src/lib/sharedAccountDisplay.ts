import { useSyncExternalStore } from 'react';
const project = new URL(import.meta.env.VITE_SUPABASE_URL).hostname;
export const SHARED_DISPLAY_KEY = `lime_shared_display:${project}:v1`;
const EVENT = 'lime-shared-display-changed';
let fallback = false;
export function readSharedDisplay() {
  try { return localStorage.getItem(SHARED_DISPLAY_KEY) === 'true'; } catch { return fallback; }
}
export function setSharedDisplay(enabled: boolean) {
  fallback = enabled;
  try { localStorage.setItem(SHARED_DISPLAY_KEY, String(enabled)); } catch { /* Session fallback. */ }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === SHARED_DISPLAY_KEY || event.key === null) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', storage); };
}
export const useSharedDisplay = () => useSyncExternalStore(subscribe, readSharedDisplay, () => false);

