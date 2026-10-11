import { useSharedListUpdates } from "@/hooks/useSharedListUpdates";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getAccountReadClient, mergeAccountPage, type MergedCursor } from "@/lib/accountReadClient";
import { getBookmarkPage } from "@/api/bookmarks";
import { getNotifications, type NotificationRow } from "@/api/notifications";
import { useEffect, useState } from "react";
import { openOfflineBookmarks, readOfflineBookmarks } from "@/lib/offlineBookmarks";

type BookmarkEntry = Awaited<ReturnType<typeof getBookmarkPage>>['entries'][number];
export function useSharedAccountIds() {
  const { user, accounts = [] } = useAuth();
  return user ? [...new Set([user.id, ...accounts.filter(a => !a.needsLogin).map(a => a.id)])].sort() : [];
}
export function useSharedBookmarks(enabled: boolean) {
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
export function useSharedNotifications(enabled: boolean) {
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
