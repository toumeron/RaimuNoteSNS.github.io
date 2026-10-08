/** Register after the first render without reloading an already running iOS app.
 * A worker may claim the page while its JS is still starting; that must not
 * restart the page and overlap another cache install with the first launch.
 */
export function registerPwa() {
  if (!('serviceWorker' in navigator)) return () => {};
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  const register = () => {
    if (cancelled) return;
    // Vite's development worker is served at a different URL. /sw.js
    // falls back to index.html in dev and cannot be registered as a worker.
    const script = import.meta.env.DEV ? 'dev-sw.js?dev-sw' : 'sw.js';
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}${script}`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    }).catch(error => console.warn('PWA registration failed', error));
  };
  const schedule = () => {
    if (cancelled || timer !== undefined || idle !== undefined) return;
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(register, { timeout: 5000 });
    else timer = setTimeout(register, 1000);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', schedule);
    clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
