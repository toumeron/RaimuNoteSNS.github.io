import { memo } from 'react';
import { useDesktopLayout } from '@/components/layout/DesktopLayoutContext';

// Reuse the mobile post loading shape at every size. Desktop borders stay
// inside the content column; mobile borders reach the screen edges.
function PostCardSkeletonComponent() {
  const desktopLayout = useDesktopLayout();
  return (
    <div data-lime-post-skeleton role="presentation" aria-hidden="true"
      className={`relative w-full py-3 ${desktopLayout ? 'px-6' : 'px-0'}`}>
      <div data-lime-post-skeleton-divider className="pointer-events-none absolute bottom-0 left-1/2 w-screen -translate-x-1/2 border-b border-border/60 sm:w-full" />
      <div className="flex animate-pulse items-start gap-3">
        <div className="h-11 w-11 shrink-0 translate-y-1 rounded-full bg-muted" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <div className="h-4 w-24 rounded-full bg-muted" />
            <div className="h-3.5 w-16 rounded-full bg-muted/60" />
            <div className="h-3.5 w-6 rounded-full bg-muted/40" />
          </div>
          <div className="mt-1 space-y-2">
            <div className="h-4 w-[92%] rounded-full bg-muted" />
            <div className="h-4 w-[68%] rounded-full bg-muted" />
          </div>
          <div className="relative mt-2 flex h-8 items-center gap-1 text-muted-foreground">
            <div className="h-6 w-11 rounded-full bg-muted/55" />
            <div className="h-6 w-11 rounded-full bg-muted/55" />
            <div className="h-6 w-8 rounded-full bg-muted/45" />
            <div className="ml-auto h-6 w-8 rounded-full bg-muted/45" />
          </div>
        </div>
      </div>
    </div>
  );
}
export const PostCardSkeleton = memo(PostCardSkeletonComponent);
PostCardSkeleton.displayName = 'PostCardSkeleton';
