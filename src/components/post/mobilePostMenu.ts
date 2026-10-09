import { useEffect, useState } from 'react';

// PWA menus use OS conventions; the browser cannot create a native OS context menu.
export function mobilePostMenuOS() {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
}

export function useMobilePostMenu() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}
