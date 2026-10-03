create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  external_id text,
  external_snapshot jsonb,
  created_at timestamptz not null default now(),
  constraint bookmark_one_source check (num_nonnulls(post_id, comment_id, external_id) = 1),
  constraint bookmark_public_external check (
    (external_id is null and external_snapshot is null) or
    (external_id is not null and external_id like 'bsky:at://%' and coalesce(
      jsonb_typeof(external_snapshot) = 'object' and
      external_snapshot->>'id' = external_id and
      external_snapshot->>'visibility' = 'public', false))
  ),
  unique(user_id, post_id),
  unique(user_id, comment_id),
  unique(user_id, external_id)
);
create index bookmarks_owner_created_idx on public.bookmarks(user_id, created_at desc, id desc);
alter table public.bookmarks enable row level security;
grant select, insert, delete on public.bookmarks to authenticated;
create policy bookmarks_owner_read on public.bookmarks for select to authenticated using(user_id = auth.uid());
create policy bookmarks_owner_delete on public.bookmarks for delete to authenticated using(user_id = auth.uid());
create policy bookmarks_owner_insert on public.bookmarks for insert to authenticated with check (
  user_id = auth.uid() and (
    exists(select 1 from public.posts p where p.id = bookmarks.post_id) or
    exists(select 1 from public.comments c join public.posts p on p.id = c.post_id where c.id = bookmarks.comment_id) or
    external_id is not null
  )
);

notify pgrst, 'reload schema';
