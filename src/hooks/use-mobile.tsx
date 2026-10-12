import { useInView } from 'react-intersection-observer';
import * as React from "react";

const MOBILE_BREAKPOINT = 768;
export const TIMELINE_PAGINATION_MARGIN = '300px 0px 500px 0px';

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

export function useIsPWA() {
  const [isPwa, setIsPwa] = React.useState(false);
  React.useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                         || (window.navigator as any).standalone;
    setIsPwa(!!isStandalone);
  }, []);
  return isPwa;
}

/** The same viewport-driven pagination used by the home timeline. */
export function useAutoPagination(query: {hasNextPage?: boolean; isFetching: boolean; isError: boolean; isFetchNextPageError?: boolean; fetchNextPage: (options?: {cancelRefetch?: boolean}) => Promise<unknown>}, enabled = true) {
  const {ref, inView} = useInView({rootMargin: TIMELINE_PAGINATION_MARGIN, fallbackInView: false});
  React.useEffect(() => {
    if (enabled && inView && query.hasNextPage && !query.isFetching && !query.isError && !query.isFetchNextPageError) void query.fetchNextPage({cancelRefetch: false});
  }, [enabled, inView, query.hasNextPage, query.isFetching, query.isError, query.isFetchNextPageError, query.fetchNextPage]);
  return ref;
}
