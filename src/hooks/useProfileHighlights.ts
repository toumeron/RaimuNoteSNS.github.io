import { useInfiniteQuery } from '@tanstack/react-query';
import { getHighlightedPosts } from '@/api/posts';
import { profileHighlightsKey } from '@/api/profile-highlights';

const LIMIT = 10;

// The first page also determines whether the profile should show the tab.
// Include the viewer so cached private posts cannot cross account boundaries.
export const useProfileHighlights = (userId: string | undefined, viewerId: string | undefined) =>
  useInfiniteQuery({
    queryKey: [...profileHighlightsKey(userId ?? ''), viewerId ?? null],
    queryFn: ({ pageParam }) => getHighlightedPosts(userId!, pageParam, LIMIT),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => lastPage.length < LIMIT ? undefined : allPages.length,
    enabled: !!userId,
  });
