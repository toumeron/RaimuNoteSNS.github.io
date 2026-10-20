import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getAccountReadClient, mergeAccountPage, type MergedCursor } from "@/lib/accountReadClient";
import { getBookmarkPage, spaceRpc } from "@/api/users";
import { getNotifications, type NotificationRow } from "@/api/users";
import { useEffect, useState, useRef } from "react";
import { openOfflineBookmarks, readOfflineBookmarks, type OfflineSpaceCard, bookmarkAssetUrls, deleteOfflineBookmarks, downloadBookmarkAssets, isInstalledPwa, writeOfflineBookmarks } from "@/lib/offlineBookmarks";
import { fetchLinkPreview, singlePreviewUrl, type LinkPreview } from "@/lib/mediaThumbnail";
import { spaceLinkIn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { splitStickers, stickerUrl, type CustomSticker } from "@/lib/utils";

// useSharedAccountLists
// useSharedListUpdates
/** Subscribe only while a shared list is open. No timers or notification polling. */
function useSharedListUpdates(table:'bookmarks'|'notifications', ids:string[], enabled:boolean) {
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

// useSharedAccountLists
type BookmarkEntry = Awaited<ReturnType<typeof getBookmarkPage>>['entries'][number];
function useSharedAccountIds() {
  const { user, accounts = [] } = useAuth();
  return user ? [...new Set([user.id, ...accounts.filter(a => !a.needsLogin).map(a => a.id)])].sort() : [];
}
function useSharedBookmarks(enabled: boolean) {
  const { user } = useAuth();
  const ids = useSharedAccountIds();
  useSharedListUpdates('bookmarks', ids, enabled);
  return useInfiniteQuery({
    queryKey: ['bookmarks', 'shared', user?.id, ids],
    enabled: enabled && !!user,
    initialPageParam: null as MergedCursor<BookmarkEntry> | null,
    queryFn: ({ pageParam, signal }) => mergeAccountPage(ids, pageParam, async (id, offset) => {
      const client = await getAccountReadClient(id);
      const page = await getBookmarkPage(id, offset, 20, { client, userId: id, signal });
      return { items: page.entries, next: page.next };
    }, (a,b) => b.savedAt.localeCompare(a.savedAt) || b.bookmarkId.localeCompare(a.bookmarkId), entry => entry.post.id, 20, signal),
    getNextPageParam: page => page.next,
    retry: false,
  });
}
function useSharedNotifications(enabled: boolean) {
  const { user } = useAuth();
  const ids = useSharedAccountIds();
  useSharedListUpdates('notifications', ids, enabled);
  return useInfiniteQuery({
    queryKey: ['notifications', 'shared', user?.id, ids],
    enabled: enabled && !!user,
    initialPageParam: null as MergedCursor<NotificationRow> | null,
    queryFn: ({ pageParam, signal }) => mergeAccountPage(ids, pageParam, async (id, pageNumber) => {
      const client = await getAccountReadClient(id);
      const items = await getNotifications(id, pageNumber, { client, userId: id, signal });
      return { items, next: items.length === 50 ? pageNumber + 1 : undefined };
    }, (a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id), row => `${row.user_id}:${row.id}`, 50, signal),
    getNextPageParam: page => page.next,
    retry: false,
  });
}

type Opened = ReturnType<typeof openOfflineBookmarks>;
function useSharedOfflineBookmarks(enabled: boolean) {
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

// useOfflineBookmarks
function useOfflineBookmarks(userId?:string) {
  const [pwa,setPwa]=useState(isInstalledPwa);
  const [online,setOnline]=useState(navigator.onLine);
  const [saved,setSaved]=useState<ReturnType<typeof openOfflineBookmarks>|null>(null);
  const [checking,setChecking]=useState(true);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const owner=useRef(userId);owner.current=userId;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const update=()=>{setOnline(navigator.onLine);setPwa(isInstalledPwa());};
    const display=window.matchMedia('(display-mode: standalone)');
    window.addEventListener('online',update);window.addEventListener('offline',update);display.addEventListener?.('change',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);display.removeEventListener?.('change',update);};
  },[]);
  useEffect(()=>{
    let live=true,opened:ReturnType<typeof openOfflineBookmarks>|null=null;
    setSaved(null);setChecking(!!userId);setBusy(false);setProgress('');
    if(userId)void readOfflineBookmarks(userId,!online).then(value=>{
      if(!live)return;if(value)opened=openOfflineBookmarks(value);setSaved(opened);
    }).catch(()=>{if(live)toast.error('オフライン保存データを読み込めませんでした');}).finally(()=>{if(live)setChecking(false);});
    return()=>{live=false;opened?.release();};
  },[pwa,userId,online]);
  // New downloads are owned by this mounted account; never publish a previous
  // account's snapshot into the next account's page.
  const visibleSaved=saved?.userId===userId?saved:null;
  const current=(id:string)=>mounted.current&&owner.current===id;
  const toggle=async()=>{
    if(!pwa||!userId||busy||checking)return;
    const id=userId;setBusy(true);
    try{
      if(visibleSaved){
        await deleteOfflineBookmarks(id);
        if(current(id)){visibleSaved.release();setSaved(null);toast.success('オフライン保存データを削除しました');}
      }else{
        if(!navigator.onLine)throw new Error('オンラインでブックマークを保存してください');
        await navigator.storage?.persist?.().catch(()=>false);
        const posts=[];
        for(let offset=0;;){
          const page=await getBookmarkPage(id,offset);
          if(!current(id))return;
          posts.push(...page.posts);setProgress(`${posts.length}件取得中`);
          if(page.next===undefined)break;offset=page.next;
        }
        const unique=[...new Map(posts.map(post=>[post.id,post])).values()];
        const contents:string[]=[],nativeContents:string[]=[];
        const visit=(post:typeof unique[number])=>{contents.push(post.content);if(post.source!=='bluesky'&&!post.id.startsWith('bsky:'))nativeContents.push(post.content);if(post.parentPost)visit(post.parentPost);};unique.forEach(visit);
        const names=new Set(contents.flatMap(text=>[...splitStickers(text).flatMap(part=>part.name?[part.name]:[]),...[...text.matchAll(/:([\w-]+):/g)].map(match=>match[1])]));
        let emojis:CustomSticker[]=[];
        if(names.size){const {data,error}=await supabase.from('custom_emojis').select('*');if(error)throw error;emojis=(data??[]).filter(emoji=>names.has(emoji.name));}
        const spaces:Record<string,OfflineSpaceCard|null>={};
        for(const spaceId of new Set(contents.flatMap(text=>{const link=spaceLinkIn(text);return link?[link.id]:[];})))spaces[spaceId]=await spaceRpc<OfflineSpaceCard|null>('get_space_card',{p_space_id:spaceId});
        const linkPreviews:Record<string,LinkPreview|null>={};
        const linkUrls=[...new Set(nativeContents.flatMap(text=>{const url=singlePreviewUrl(text);return url?[url]:[];}))];
        for(let start=0;start<linkUrls.length;start+=4)await Promise.all(linkUrls.slice(start,start+4).map(async url=>{linkPreviews[url]=await fetchLinkPreview(url);}));
        const urls=[...new Set([...bookmarkAssetUrls([...unique,...Object.values(spaces).filter(Boolean),...Object.values(linkPreviews).filter(Boolean)] as typeof unique),...emojis.flatMap(emoji=>{const url=stickerUrl(emoji);return url?[url]:[];})])];
        const assets=await downloadBookmarkAssets(urls,(done,total)=>{if(current(id))setProgress(`画像 ${done}/${total}`);});
        if(!current(id))return;
        if(!navigator.onLine)throw new Error('通信が切れたため保存できませんでした。もう一度お試しください');
        const value={userId:id,savedAt:new Date().toISOString(),posts:unique,emojis,spaces,linkPreviews,assets};
        await writeOfflineBookmarks(value);
        void navigator.storage?.persist?.().catch(()=>false);
        if(current(id)){setSaved(openOfflineBookmarks({...value,assets:[]}));toast.success(`${unique.length}件のブックマークをオフラインに保存しました`);}
      }
    }catch(error){if(current(id))toast.error(error instanceof Error?error.message:'オフライン保存に失敗しました');}
    finally{if(current(id)){setBusy(false);setProgress('');}}
  };
  // Release object URLs allocated by a save action as well as those from a read.
  useEffect(()=>()=>saved?.release(),[saved]);
  return {pwa,online,saved:visibleSaved,checking,busy,progress,toggle};
}

export { useSharedAccountIds };
export { useSharedBookmarks };
export { useSharedNotifications };
export { useSharedOfflineBookmarks };
export { useSharedListUpdates };
export { useOfflineBookmarks };
