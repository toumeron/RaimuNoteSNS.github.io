import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useSharedListUpdates } from './useSharedListUpdates';
import { getAccountReadClient } from '@/lib/accountReadClient';
import { mergeAccountPage, type MergedCursor } from '@/lib/mergeAccountPages';
import { getBookmarkPage } from '@/api/bookmarks';
import { getNotifications, type NotificationRow } from '@/api/notifications';

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
