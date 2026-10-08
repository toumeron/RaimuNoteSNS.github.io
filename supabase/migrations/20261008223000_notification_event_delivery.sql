-- No timer: expired rows are hidden by the existing 30-day RLS immediately,
-- and physically removed when another notification is inserted.
create function public.expire_notifications_on_insert() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.expire_notifications();
 return null;
end $$;
revoke all on function public.expire_notifications_on_insert() from public,anon,authenticated;
create trigger notification_expiry_on_insert after insert on public.notifications
for each statement execute function public.expire_notifications_on_insert();
-- Existing tables only. Subscription INSERT/DELETE events drive the listener.
do $$ declare relation text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach relation in array array['notifications','post_notification_subscriptions'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=relation) then
    execute format('alter publication supabase_realtime add table public.%I',relation);
   end if;
  end loop;
 end if;
end $$;
