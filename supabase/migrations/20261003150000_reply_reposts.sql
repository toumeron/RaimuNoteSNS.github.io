alter table public.posts add column if not exists quoted_reply_id uuid references public.comments(id) on delete set null;
create index posts_quoted_reply_idx on public.posts(quoted_reply_id) where quoted_reply_id is not null;
create table public.reply_reposts (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(comment_id,user_id)
);
create index reply_reposts_profile_idx on public.reply_reposts(user_id,created_at desc,comment_id);
alter table public.reply_reposts enable row level security;
grant select on public.reply_reposts to anon,authenticated;
grant insert,delete on public.reply_reposts to authenticated;
create policy reply_reposts_read on public.reply_reposts for select to anon,authenticated using (
  exists(select 1 from public.comments c join public.posts p on p.id=c.post_id where c.id=comment_id)
);
create policy reply_reposts_insert on public.reply_reposts for insert to authenticated with check (
  user_id=auth.uid() and exists(select 1 from public.comments c join public.posts p on p.id=c.post_id where c.id=comment_id)
);
create policy reply_reposts_delete on public.reply_reposts for delete to authenticated using(user_id=auth.uid());
