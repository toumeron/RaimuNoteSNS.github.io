import { useEffect, useState } from 'react';
import { openOfflineBookmarks, readOfflineBookmarks } from '@/lib/offlineBookmarks';
import { useSharedAccountIds } from './useSharedAccountLists';
type Opened = ReturnType<typeof openOfflineBookmarks>;
export function useSharedOfflineBookmarks(enabled: boolean) {
  const ids = useSharedAccountIds();
  const key = enabled ? JSON.stringify(ids) : '';
  const [state, setState] = useState<{key:string; snapshots:Opened[]; error:boolean}>({key:'',snapshots:[],error:false});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const opened: Opened[] = [];
    void Promise.all(ids.map(id => readOfflineBookmarks(id))).then(values => {
      if (!alive) return;
      for (const value of values) if (value) opened.push(openOfflineBookmarks(value));
      setState({key,snapshots:opened,error:false});
    }).catch(() => { if(alive)setState({key,snapshots:[],error:true}); });
    return () => { alive=false; opened.forEach(snapshot=>snapshot.release()); };
  }, [key]);
  const snapshots = state.key === key ? state.snapshots : [];
  const posts = [...new Map(snapshots.flatMap(s=>s.posts).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).map(p=>[p.id,p])).values()];
  const context = snapshots.length ? {
    bookmarkIds:posts.map(p=>p.id),
    emojis:[...new Map(snapshots.flatMap(s=>s.emojis).map(e=>[e.id,e])).values()],
    media:new Map(snapshots.flatMap(s=>[...s.media])),
    spaces:Object.assign({},...snapshots.map(s=>s.spaces)),
    linkPreviews:Object.assign({},...snapshots.map(s=>s.linkPreviews)),
  } : null;
  return {posts,context,checking:enabled&&state.key!==key,error:enabled&&state.key===key&&state.error};
}
