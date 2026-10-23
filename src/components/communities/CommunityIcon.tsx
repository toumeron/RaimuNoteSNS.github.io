import type {SVGProps} from 'react';

/** Filled, overlapping silhouettes used consistently for Communities. */
export function CommunityIcon({size=24,...props}:SVGProps<SVGSVGElement>&{size?:number|string}){
 return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="none" aria-hidden="true" {...props}>
  <circle cx="8" cy="6.7" r="3.35"/>
  <circle cx="16.5" cy="6.7" r="3.35"/>
  <path d="M1 21c.5-6.2 2.9-10 7-10 1.5 0 2.7.5 3.8 1.3C9.4 14.4 8 17.4 7.7 21H1Zm8.8 0c.5-6.2 2.9-10 6.7-10s6.2 3.8 6.7 10H9.8Z"/>
 </svg>;
}
