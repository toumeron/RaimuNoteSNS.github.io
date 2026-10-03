-- Quote posts have their own reactions. Changes to a quote must not bubble up
-- to its source, and newly inserted quotes must not inherit source counters.
drop trigger if exists trg_sync_parent_counts on public.posts;
drop trigger if exists trg_sync_counts_to_reposts on public.posts;

create or replace function public.update_repost_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.parent_id is not null then
    update public.posts set reposts_count = coalesce(reposts_count, 0) + 1 where id = new.parent_id;
  elsif tg_op = 'DELETE' and old.parent_id is not null then
    update public.posts set reposts_count = greatest(0, coalesce(reposts_count, 0) - 1) where id = old.parent_id;
  end if;
  return null;
end;
$$;

-- Repair counts that were previously inherited or recursively propagated.
update public.posts p set reposts_count =
  (select count(*) from public.reposts r where r.post_id = p.id) +
  (select count(*) from public.posts q where q.parent_id = p.id);
update public.posts p set likes_count = (select count(*) from public.likes l where l.post_id = p.id)
where p.is_quote = true;

-- External public posts use text identifiers and cannot be stored in the UUID
-- posts FK. Keep profile-only shares separate from the Lime timeline.
alter table public.posts add column if not exists quoted_external_post jsonb;
create table public.external_reposts (
  post_id text not null check (post_id like 'bsky:at://%'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_snapshot jsonb not null check (post_snapshot->>'id' = post_id and post_snapshot->>'visibility' = 'public'),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index external_reposts_profile_idx on public.external_reposts (user_id, created_at desc);
alter table public.external_reposts enable row level security;
grant select on public.external_reposts to anon, authenticated;
grant insert, delete on public.external_reposts to authenticated;
create policy external_reposts_read on public.external_reposts for select to anon, authenticated using (true);
create policy external_reposts_insert on public.external_reposts for insert to authenticated with check (user_id = auth.uid());
create policy external_reposts_delete on public.external_reposts for delete to authenticated using (user_id = auth.uid());
create index if not exists posts_quoted_external_id_idx on public.posts ((quoted_external_post->>'id')) where quoted_external_post is not null;
alter table public.external_reposts drop constraint if exists external_reposts_post_snapshot_check;
alter table public.external_reposts add constraint external_reposts_post_snapshot_check check (coalesce(post_snapshot->>'id' = post_id and post_snapshot->>'visibility' = 'public', false));
