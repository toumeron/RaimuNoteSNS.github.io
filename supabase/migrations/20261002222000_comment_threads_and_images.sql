begin;

alter table public.comments
  add column parent_comment_id uuid references public.comments(id) on delete set null,
  add column image_urls text[] not null default '{}'::text[],
  add constraint comments_image_limit check (cardinality(image_urls) <= 4),
  add constraint comments_parent_not_self check (parent_comment_id is distinct from id);

create index comments_thread_idx on public.comments (post_id, parent_comment_id, created_at);

-- Keep all descendants attached to the same original post. Parentage is fixed
-- on insertion; deleting a parent may detach its children without deleting them.
create function public.validate_comment_parent()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.post_id is distinct from old.post_id
       or (new.parent_comment_id is not null and new.parent_comment_id is distinct from old.parent_comment_id) then
      raise exception 'Cannot move a reply to another thread';
    end if;
  end if;
  if new.parent_comment_id is not null and not exists (
    select 1 from public.comments parent
    where parent.id = new.parent_comment_id and parent.post_id = new.post_id
  ) then
    raise exception 'Reply parent must belong to the same post';
  end if;
  return new;
end;
$$;

create trigger validate_comment_parent
before insert or update of post_id, parent_comment_id on public.comments
for each row execute function public.validate_comment_parent();

-- The existing INSERT/DELETE post-count trigger and RLS policies are retained.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
