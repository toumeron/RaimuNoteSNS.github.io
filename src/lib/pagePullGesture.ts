/** Portaled dialogs sit outside the page but their touch events still reach window. */
export function isPagePullBlocked(target?: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[role="dialog"][aria-modal="true"], [data-lime-audience-sheet], [data-lime-mobile-composer], .lime-media-lightbox')) return true;
  return target instanceof Element && !!target.closest('[role="dialog"], input, textarea, select, [contenteditable="true"]');
}
