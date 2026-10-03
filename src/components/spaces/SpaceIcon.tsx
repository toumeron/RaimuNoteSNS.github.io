import type { SVGProps } from 'react';
/** The audio bars and curved ring used on live avatars and the creation screen. */
export function SpaceIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <rect x="5" y="1" width="14" height="17" rx="7" fill="currentColor" />
    <path d="M2 14a10 10 0 0 0 20 0" stroke="currentColor" strokeWidth="2.2" />
    <path d="M8.5 8v3m3.5-5v7m3.5-5v3" stroke="var(--space-icon-bars, hsl(var(--background)))" strokeWidth="1.7" strokeLinecap="round" />
  </svg>;
}
