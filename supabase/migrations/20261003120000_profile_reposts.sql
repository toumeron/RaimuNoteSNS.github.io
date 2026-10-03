begin;

create table public.reposts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index reposts_profile_timeline_idx on public.reposts (user_id, created_at desc, post_id desc);
alter table public.reposts enable row level security;
grant select on public.reposts to anon;
grant select, insert, delete on public.reposts to authenticated;

-- Existing posts policies include permissive legacy policies. Check the actual
-- audience here too, instead of relying on that table's SELECT policy alone.
create policy reposts_select_visible on public.reposts for select to anon, authenticated
using (exists (
  select 1 from public.posts p where p.id = post_id and (
    coalesce(p.visibility, 'public') = 'public'
    or p.user_id = auth.uid()
    or (p.visibility = 'following' and exists (
      select 1 from public.follows f where f.follower_id = p.user_id and f.followee_id = auth.uid()
    ))
    or (p.visibility = 'members' and exists (
      select 1 from public.memberships m where m.creator_id = p.user_id and m.member_id = auth.uid()
    ))
  )
));
create policy reposts_insert_own on public.reposts for insert to authenticated
with check (user_id = auth.uid() and exists (
  select 1 from public.posts p where p.id = post_id and (
    coalesce(p.visibility, 'public') = 'public'
    or p.user_id = auth.uid()
    or (p.visibility = 'following' and exists (
      select 1 from public.follows f where f.follower_id = p.user_id and f.followee_id = auth.uid()
    ))
    or (p.visibility = 'members' and exists (
      select 1 from public.memberships m where m.creator_id = p.user_id and m.member_id = auth.uid()
    ))
  )
));
create policy reposts_delete_own on public.reposts for delete to authenticated
using (user_id = auth.uid());

-- The existing posts trigger already counts quote inserts/deletes. Repost
-- records only adjust their own contribution, atomically, without client writes.
create function public.adjust_profile_repost_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set reposts_count = coalesce(reposts_count, 0) + 1 where id = new.post_id;
    return new;
  end if;
  update public.posts set reposts_count = greatest(0, coalesce(reposts_count, 0) - 1) where id = old.post_id;
  return old;
end;
$$;
revoke all on function public.adjust_profile_repost_count() from public, anon, authenticated;
create trigger adjust_profile_repost_count after insert or delete on public.reposts
for each row execute function public.adjust_profile_repost_count();

notify pgrst, 'reload schema';
commit;
