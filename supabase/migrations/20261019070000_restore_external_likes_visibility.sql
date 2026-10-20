-- A later security policy reset restored native-only parent checks, hiding
-- external snapshots even though the existing likes relation supports them.
-- Keep native post RLS, account protection and owner policies in force.
drop policy if exists security_visible_parent on public.likes;
create policy security_visible_parent on public.likes as restrictive for select to anon,authenticated
 using (
  (external_post_id is not null and post_snapshot->>'id'=external_post_id and post_snapshot->>'visibility'='public')
  or exists(select 1 from public.posts p where p.id=likes.post_id)
 );
drop policy if exists security_insert_visible_parent on public.likes;
create policy security_insert_visible_parent on public.likes as restrictive for insert to anon,authenticated
 with check (
  (external_post_id is not null and post_snapshot->>'id'=external_post_id and post_snapshot->>'visibility'='public')
  or exists(select 1 from public.posts p where p.id=likes.post_id)
 );
