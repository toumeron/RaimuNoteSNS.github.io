import { useEffect, useState } from 'react';
import {initialiseExternalAccounts,setExternalAccountOwner} from '@/lib/externalAccounts';
import {useAuth} from './useAuth';
import { useInfiniteQuery,useQueryClient } from '@tanstack/react-query';
import { getFeed, getFollowingFeed } from '@/api/posts';
import { fetchBlueskyAuthorFeed, getConfiguredExternalHandles } from '@/lib/bluesky';
import { createTimelineCursor, loadTimelinePage,watchTimelineSources,collectReadyTimelineSources } from '@/lib/timelinePaging';

export function useTimelineFeed(tab: 'all' | 'following', enabled = true) {
  const {user,loading}=useAuth();
  const client=useQueryClient();
  const [handles, setHandles] = useState(getConfiguredExternalHandles);
  useEffect(() => {
    if(tab!=='following')return;
    const update = () => setHandles(getConfiguredExternalHandles());
    setExternalAccountOwner(user?.id??null);
    update();
    if(user)void initialiseExternalAccounts().then(update).catch(()=>{});
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
  }, [user?.id,tab]);

  const sourceHandles=tab==='following'?handles:[];
  const queryKey=['feed',tab,tab==='all'?'timeline-native-v2':'timeline',user?.id,sourceHandles];
  const query=useInfiniteQuery({
    enabled:enabled&&!loading&&!!user,
    queryKey,
    initialPageParam: createTimelineCursor(sourceHandles),
    queryFn: ({ pageParam, signal }) => loadTimelinePage(pageParam, {
      lime: (page,limit,before)=>(tab === 'all' ? getFeed : getFollowingFeed)(page,limit,before,signal),
      bluesky: async (actor, cursor, limit) => {
        try { return await fetchBlueskyAuthorFeed({ actor, cursor, limit, signal }); }
        catch(error) {
          if (signal.aborted || (!actor.includes('@') && actor!=='misskey.io' && !actor.startsWith('x-user:'))) throw error;
          console.warn('Misskey feed unavailable; retaining LimeNote timeline',error);
          return {posts:[],cursor:null};
        }
      },
    }),
    getNextPageParam: lastPage => lastPage.next,
    staleTime: 1000 * 60,
    retry:false,
  });
  useEffect(()=>{
    const cursor=query.data?.pages.at(-1)?.next;
    if(!enabled||query.isFetching||!cursor)return;
    return watchTimelineSources(cursor,()=>{
      if(client.getQueryState(queryKey)?.fetchStatus==='fetching')return;
      client.setQueryData<NonNullable<typeof query.data>>(queryKey,data=>{
        const last=data?.pages.at(-1);
        if(!data||!last?.next||last.next!==cursor)return data;
        const ready=collectReadyTimelineSources(cursor);if(!ready)return data;
        const shown=new Set(data.pages.flatMap(page=>page.posts.map(post=>post.id)));
        const posts=ready.posts.filter(post=>{if(shown.has(post.id))return false;shown.add(post.id);return true;});
        return {...data,pages:[...data.pages.slice(0,-1),{posts:[...last.posts,...posts],next:ready.next}]};
      });
    });
  },[enabled,query.isFetching,query.data,client]);
  return query;
}
