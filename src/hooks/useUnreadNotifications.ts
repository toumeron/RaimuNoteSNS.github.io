import { useEffect } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccountReadClient } from '@/lib/accountReadClient';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export const unreadNotificationKey = (userId: string) => ['notification-unread-count', userId] as const;
export async function getUnreadNotificationCount(userId: string, activeUserId?: string, signal?: AbortSignal) {
  let client = supabase;
  if (userId !== activeUserId) client = await getAccountReadClient(userId);
  let request = client.from('notifications').select('id', {count: 'exact', head: true}).eq('user_id', userId).eq('is_read', false);
  if (signal) request = request.abortSignal(signal);
  const {count, error} = await request;
  if (error) throw error;
  return Math.max(0, count ?? 0);
}

export function useUnreadNotifications(userId?: string, enabled = true) {
  const {user} = useAuth();
  const client = useQueryClient();
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{userId: string; count: number}>).detail;
      if (userId && detail?.userId === userId && Number.isFinite(detail.count)) {
        // Cancel stale reads before applying the count produced by a read/new-notification update.
        void client.cancelQueries({queryKey: unreadNotificationKey(userId), exact: true});
        client.setQueryData(unreadNotificationKey(userId), Math.max(0, detail.count));
      }
    };
    window.addEventListener('lime-notification-count-changed', update);
    return () => window.removeEventListener('lime-notification-count-changed', update);
  }, [client, userId]);
  return useQuery({queryKey: unreadNotificationKey(userId ?? ''), queryFn: ({signal}) => getUnreadNotificationCount(userId!, user?.id, signal), enabled: enabled && !!userId, staleTime: 30_000, retry: false});
}


export function useSavedAccountUnreadTotal(enabled = true) {
  const {user, accounts} = useAuth();
  const active = useUnreadNotifications(user?.id);
  const others = useQueries({queries: accounts.filter(account => account.id !== user?.id && !account.needsLogin).map(account => ({
    queryKey: unreadNotificationKey(account.id),
    queryFn: ({signal}: {signal: AbortSignal}) => getUnreadNotificationCount(account.id, user?.id, signal),
    enabled: enabled && !!user,
    staleTime: 30_000,
    retry: false,
  }))});
  return (active.isError ? 0 : active.data ?? 0) + others.reduce((total, result) => total + (result.isError ? 0 : result.data ?? 0), 0);
}
