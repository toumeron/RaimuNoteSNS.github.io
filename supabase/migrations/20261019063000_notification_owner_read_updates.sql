-- Restrictive owner policies only narrow access; they cannot grant UPDATE by themselves.
-- Permit owners to update the existing read flag while retaining all restrictive policies.
drop policy if exists notifications_owner_read_update on public.notifications;
create policy notifications_owner_read_update on public.notifications
 as permissive for update to authenticated
 using (user_id = (select auth.uid()))
 with check (user_id = (select auth.uid()));
-- Keep every other notification field protected.
grant update(is_read) on public.notifications to authenticated;
