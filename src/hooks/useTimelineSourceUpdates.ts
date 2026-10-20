import {useEffect} from 'react';
import {useQueryClient,type InfiniteData,type QueryKey} from '@tanstack/react-query';
import {watchTimelineSources,collectReadyTimelineSources,type TimelinePage} from '@/lib/timelinePaging';

/** Publish every delayed account as it finishes, even if the user has not scrolled again. */
export function useTimelineSourceUpdates(queryKey:QueryKey,data:InfiniteData<TimelinePage>|undefined,fetching:boolean,enabled=true){
 const client=useQueryClient(),key=JSON.stringify(queryKey);
 useEffect(()=>{
  const cursor=data?.pages.at(-1)?.next;if(!enabled||fetching||!cursor)return;
  return watchTimelineSources(cursor,()=>{
   if(client.getQueryState(queryKey)?.fetchStatus==='fetching')return;
   client.setQueryData<InfiniteData<TimelinePage>>(queryKey,current=>{
    const last=current?.pages.at(-1);if(!current||last?.next!==cursor)return current;
    const ready=collectReadyTimelineSources(cursor);if(!ready)return current;
    const seen=new Set(current.pages.flatMap(page=>page.posts.map(post=>post.id)));
    const posts=ready.posts.filter(post=>{if(seen.has(post.id))return false;seen.add(post.id);return true;});
    return {...current,pages:[...current.pages.slice(0,-1),{posts:[...last.posts,...posts],next:ready.next}]};
   });
  });
 },[client,key,data,fetching,enabled]);
}
