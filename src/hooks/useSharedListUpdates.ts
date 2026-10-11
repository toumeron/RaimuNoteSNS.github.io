import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAccountReadClient } from '@/lib/accountReadClient';
/** Subscribe only while a shared list is open. No timers or notification polling. */
export function useSharedListUpdates(table:'bookmarks'|'notifications', ids:string[], enabled:boolean) {
  const queries=useQueryClient();
  const key=JSON.stringify(ids);
  useEffect(()=>{
    if(!enabled||!ids.length)return;
    let stopped=false,generation=0;
    const subscriptions: (()=>void)[]=[];
    const connect=async()=>{
      const epoch=++generation;
      subscriptions.splice(0).forEach(close=>close());
      await Promise.all(ids.map(async id=>{
        try {
          const client=await getAccountReadClient(id);
          if(stopped||epoch!==generation)return;
          const channel=client.channel(`shared-${table}-${id}`).on('postgres_changes',{event:'*',schema:'public',table,filter:`user_id=eq.${id}`},()=>{
            void queries.invalidateQueries({queryKey:[table,'shared']});
            if(table==='notifications')void queries.invalidateQueries({queryKey:['notification-unread-count',id],exact:true});
          }).subscribe();
          subscriptions.push(()=>{void client.removeChannel(channel);});
        } catch { /* The list query reports missing authentication or read errors. */ }
      }));
    };
    const focus=()=>{void connect();};
    void connect();window.addEventListener('focus',focus);
    return()=>{stopped=true;generation++;window.removeEventListener('focus',focus);subscriptions.splice(0).forEach(close=>close());};
  },[table,key,enabled,queries]);
}
