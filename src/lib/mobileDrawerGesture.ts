// Feed-tab swipes and drawer swipes must reserve the same edge area.
export const MOBILE_DRAWER_EDGE_ZONE = 96;

export function isMobileDrawerBlocked(): boolean {
  return [...document.querySelectorAll<HTMLElement>(
    '[data-lime-maps], .lime-map-dialog, .lime-media-lightbox, [role="dialog"][aria-modal="true"]:not([data-lime-mobile-sidebar])'
  )].some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}
