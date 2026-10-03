import type { SVGProps } from 'react';

// Opposing vertical arrows with rounded bends, matching the supplied reference.
export function RepostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5 4v12a4 4 0 0 0 4 4h5M2 7l3-3 3 3M10 4h5a4 4 0 0 1 4 4v12m-3-3 3 3 3-3" />
    </svg>
  );
}
