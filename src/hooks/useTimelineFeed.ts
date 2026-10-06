import { useEffect, useState } from 'react';
import {useAuth} from './useAuth';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getFeed, getFollowingFeed } from '@/api/posts';
import { fetchBlueskyAuthorFeed, getConfiguredBlueskyHandles } from '@/lib/bluesky';
import { createTimelineCursor, loadTimelinePage } from '@/lib/timelinePaging';

export function useTimelineFeed(tab: 'all' | 'following', enabled = true) {
  const {user,loading}=useAuth();
  const [handles, setHandles] = useState(getConfiguredBlueskyHandles);
  useEffect(() => {
    const update = () => setHandles(getConfiguredBlueskyHandles());
    const storage = (event: StorageEvent) => {
      if (event.key === 'lime_bluesky_author_handles' || event.key === null) update();
    };
    window.addEventListener('lime-bluesky-handles-changed', update);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('lime-bluesky-handles-changed', update);
      window.removeEventListener('storage', storage);
    };
  }, []);

  return useInfiniteQuery({
    enabled:enabled&&!loading&&!!user,
    queryKey: ['feed', tab, 'timeline', user?.id, handles],
    initialPageParam: createTimelineCursor(handles),
    queryFn: ({ pageParam, signal }) => loadTimelinePage(pageParam, {
      lime: tab === 'all' ? getFeed : getFollowingFeed,
      bluesky: (actor, cursor, limit) => fetchBlueskyAuthorFeed({ actor, cursor, limit, signal }),
    }),
    getNextPageParam: lastPage => lastPage.next,
    staleTime: 1000 * 60,
  });
}
