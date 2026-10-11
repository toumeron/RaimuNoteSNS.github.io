import type { SVGProps } from "react";

export type ComposerIconKind = 'image' | 'poll' | 'smile' | 'globe' | 'users' | 'members' | 'send';

/** Original toolbar drawings: common 32-unit canvas and 20px toolbar scale. */
export function ComposerIcon({kind,...props}:SVGProps<SVGSVGElement>&{kind:ComposerIconKind}) {
 const drawings={
  image:<><rect x="4" y="4" width="24" height="24" rx="5"/><circle cx="21" cy="11" r="2.2" fill="currentColor" stroke="none"/><path d="m5 21 6.5-6.5L25 28"/></>,
  poll:<><circle cx="7.5" cy="9" r="3.5"/><circle cx="7.5" cy="23" r="3.5"/><path d="M17 9h11M17 23h11"/></>,
  smile:<><circle cx="16" cy="16" r="12"/><ellipse cx="11.5" cy="12.5" rx="1.6" ry="2.1" fill="currentColor" stroke="none"/><ellipse cx="20.5" cy="12.5" rx="1.6" ry="2.1" fill="currentColor" stroke="none"/><path d="M10 20q6 6 12 0"/></>,
  globe:<><circle cx="16" cy="16" r="12"/><path d="m8 6 3 4-2 4 5 3 1 9 4-5 1-5 5-2-5-3-1-6M5 16l4 3"/></>,
  users:<><circle cx="12" cy="9" r="4.5"/><path d="M3 27a9 9 0 0 1 18 0ZM23 13l3 3 4-7"/></>,
  members:<><path d="m4 9 6 5 6-9 6 9 6-5-3 15H7ZM8 28h16"/><circle cx="4" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="28" cy="7" r="1" fill="currentColor" stroke="none"/></>,
  send:<><path d="m4 5 24 11L4 27l4-11ZM8 16h20"/></>,
 };
 return <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-composer-icon={kind} {...props}>{drawings[kind]}</svg>;
}

export function PollIcon(props:SVGProps<SVGSVGElement>) {
 return <ComposerIcon kind="poll" {...props}/>;
}

// Opposing vertical arrows with rounded bends, matching the supplied reference.
export function RepostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5 4v12a4 4 0 0 0 4 4h5M2 7l3-3 3 3M10 4h5a4 4 0 0 1 4 4v12m-3-3 3 3 3-3" />
    </svg>
  );
}
