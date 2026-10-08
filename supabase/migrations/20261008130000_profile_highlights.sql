begin;

create table public.profile_highlights (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index profile_highlights_user_created_idx on public.profile_highlights (user_id, created_at desc, post_id desc);
create index profile_highlights_post_idx on public.profile_highlights (post_id);
alter table public.profile_highlights enable row level security;
grant select on public.profile_highlights to anon, authenticated;
grant insert, delete on public.profile_highlights to authenticated;

-- The post's own audience policies also apply to highlight reads.
create policy profile_highlights_read on public.profile_highlights
  for select to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.user_id = profile_highlights.user_id));
create policy profile_highlights_insert on public.profile_highlights
  for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
create policy profile_highlights_delete on public.profile_highlights
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
commit;
