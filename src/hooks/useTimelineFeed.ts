import { useEffect, useState } from 'react';
import {useAuth} from './useAuth';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getFeed, getFollowingFeed } from '@/api/posts';
import { fetchBlueskyAuthorFeed, getConfiguredExternalHandles } from '@/lib/bluesky';
import { createTimelineCursor, loadTimelinePage } from '@/lib/timelinePaging';

export function useTimelineFeed(tab: 'all' | 'following', enabled = true) {
  const {user,loading}=useAuth();
  const [handles, setHandles] = useState(getConfiguredExternalHandles);
  useEffect(() => {
    const update = () => setHandles(getConfiguredExternalHandles());
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith('lime_misskey_') || event.key === 'lime_bluesky_author_handles' || event.key === null) update();
    };
    window.addEventListener('lime-bluesky-handles-changed', update);
    window.addEventListener('lime-misskey-changed', update);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('lime-bluesky-handles-changed', update);
      window.removeEventListener('lime-misskey-changed', update);
      window.removeEventListener('storage', storage);
    };
  }, []);

  return useInfiniteQuery({
    enabled:enabled&&!loading&&!!user,
    queryKey: ['feed', tab, 'timeline', user?.id, handles],
    initialPageParam: createTimelineCursor(handles),
    queryFn: ({ pageParam, signal }) => loadTimelinePage(pageParam, {
      lime: tab === 'all' ? getFeed : getFollowingFeed,
      bluesky: async (actor, cursor, limit) => {
        try { return await fetchBlueskyAuthorFeed({ actor, cursor, limit, signal }); }
        catch(error) {
          if (signal.aborted || (!actor.includes('@') && actor!=='misskey.io')) throw error;
          console.warn('Misskey feed unavailable; retaining LimeNote timeline',error);
          return {posts:[],cursor:null};
        }
      },
    }),
    getNextPageParam: lastPage => lastPage.next,
    staleTime: 1000 * 60,
  });
}
