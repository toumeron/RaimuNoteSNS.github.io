begin;
-- A list is a small curated collection; membership stays with its single owner row.
create table public.user_lists (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
 name text not null check(char_length(btrim(name)) between 1 and 50),
 description text not null default '' check(char_length(description)<=500),
 is_private boolean not null default false,
 cover_ref text,
 members jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index user_lists_owner on public.user_lists(owner_id,created_at desc);
create index user_lists_public on public.user_lists(created_at desc) where not is_private;
alter table public.user_lists enable row level security;
revoke all on public.user_lists from public,anon,authenticated;
grant select on public.user_lists to anon,authenticated;
grant insert,delete on public.user_lists to authenticated;
grant update(name,description,is_private,cover_ref,members) on public.user_lists to authenticated;
grant all on public.user_lists to service_role;
create policy lists_read on public.user_lists for select using(not is_private or owner_id=(select auth.uid()));
create policy lists_insert on public.user_lists for insert to authenticated with check(owner_id=(select auth.uid()));
create policy lists_update on public.user_lists for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy lists_delete on public.user_lists for delete to authenticated using(owner_id=(select auth.uid()));
create function public.validate_user_list() returns trigger language plpgsql set search_path='' as $$
declare member jsonb; external_count integer:=0;
begin
 if tg_op='INSERT' and (select count(*) from public.user_lists where owner_id=new.owner_id)>=100 then raise exception 'Lists limit reached'; end if;
 new.name:=btrim(new.name);
 if new.cover_ref is not null and new.cover_ref !~ ('^cloudinary:lists/'||new.owner_id||'/'||new.id||'/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$') then raise exception 'Invalid list cover'; end if;
 if jsonb_typeof(new.members) is distinct from 'array' or jsonb_array_length(new.members)>100 then raise exception 'Invalid members';end if;
 if (select count(distinct m->>'id') from jsonb_array_elements(new.members) m)<>jsonb_array_length(new.members) then raise exception 'Duplicate member';end if;
 for member in select * from jsonb_array_elements(new.members) loop
  if jsonb_typeof(member) is distinct from 'object' or jsonb_typeof(member->'id') is distinct from 'string' or char_length(member->>'id') not between 1 and 200 or jsonb_typeof(member->'username') is distinct from 'string' or char_length(member->>'username') not between 1 and 200 or char_length(member::text)>5000 then raise exception 'Invalid member';end if;
  if (member->>'id') !~ '^[0-9a-f-]{36}$' then external_count:=external_count+1;end if;
 end loop;
 if external_count>20 then raise exception 'External members limit reached';end if;
 new.updated_at:=now();return new;
end;$$;
revoke all on function public.validate_user_list() from public,anon,authenticated;
create trigger user_list_validation before insert or update on public.user_lists for each row execute function public.validate_user_list();
-- Atomic per-member edits prevent two open screens from losing each other's changes.
create function public.set_list_member(list_id uuid, member jsonb, included boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.user_lists l set members=(select coalesce(jsonb_agg(m),'[]'::jsonb) from jsonb_array_elements(l.members) m where m->>'id' is distinct from member->>'id') || case when included then jsonb_build_array(member) else '[]'::jsonb end
 where l.id=list_id and l.owner_id=auth.uid();
 if not found then raise exception 'List not found or not owner' using errcode='42501';end if;
end;$$;
revoke all on function public.set_list_member(uuid,jsonb,boolean) from public,anon;
grant execute on function public.set_list_member(uuid,jsonb,boolean) to authenticated;
alter table public.profile_private_settings add column saved_lists uuid[] not null default '{}';
create index private_settings_saved_lists on public.profile_private_settings using gin(saved_lists);
create function public.set_saved_list(list_id uuid, included boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if included and not exists(select 1 from public.user_lists where id=list_id and (not is_private or owner_id=auth.uid())) then raise exception 'List not readable' using errcode='42501';end if;
 insert into public.profile_private_settings(user_id,saved_lists) values(auth.uid(),case when included then array[list_id] else '{}'::uuid[] end)
 on conflict(user_id) do update set saved_lists=case when included then array_append(array_remove(public.profile_private_settings.saved_lists,list_id),list_id) else array_remove(public.profile_private_settings.saved_lists,list_id) end;
 if (select cardinality(saved_lists) from public.profile_private_settings where user_id=auth.uid())>100 then raise exception 'Saved lists limit reached';end if;
end;$$;
revoke all on function public.set_saved_list(uuid,boolean) from public,anon;
grant execute on function public.set_saved_list(uuid,boolean) to authenticated;
create function public.list_follower_counts(list_ids uuid[]) returns table(id uuid,followers bigint) language sql stable security definer set search_path='' as $$
 select l.id,(select count(*) from public.profile_private_settings s where s.saved_lists @> array[l.id]) from public.user_lists l where l.id=any(list_ids) and (not l.is_private or l.owner_id=auth.uid()) and cardinality(list_ids)<=100;
$$;
revoke all on function public.list_follower_counts(uuid[]) from public;
grant execute on function public.list_follower_counts(uuid[]) to anon,authenticated;
create function public.cleanup_deleted_list() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.profile_private_settings set saved_lists=array_remove(saved_lists,old.id) where saved_lists @> array[old.id];return old;
end;$$;
revoke all on function public.cleanup_deleted_list() from public,anon,authenticated;
create trigger deleted_list_cleanup after delete on public.user_lists for each row execute function public.cleanup_deleted_list();
commit;
