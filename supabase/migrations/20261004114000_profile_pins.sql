-- One native post per profile. The post itself still follows its existing audience RLS.
create table public.profile_pins (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 post_id uuid not null references public.posts(id) on delete cascade
);
alter table public.profile_pins enable row level security;
grant select on public.profile_pins to anon,authenticated;
grant insert,update,delete on public.profile_pins to authenticated;
create policy profile_pins_read on public.profile_pins for select to anon,authenticated using(true);
create policy profile_pins_insert on public.profile_pins for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid()));
create policy profile_pins_update on public.profile_pins for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.posts p where p.id=post_id and p.user_id=auth.uid()));
create policy profile_pins_delete on public.profile_pins for delete to authenticated using(user_id=auth.uid());
