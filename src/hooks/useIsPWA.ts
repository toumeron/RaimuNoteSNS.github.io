// src/hooks/useIsPWA.ts
import { useState, useEffect } from 'react';

export function useIsPWA() {
  const [isPwa, setIsPwa] = useState(false);
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches 
                         || (window.navigator as any).standalone;
    setIsPwa(!!isStandalone);
  }, []);
  return isPwa;
}