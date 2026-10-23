-- Mention references belong to their post; keep notification and archive APIs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.mentions,public.posts in share row exclusive mode;
alter table public.posts add column post_mentions jsonb not null default '{}'::jsonb
 check(jsonb_typeof(post_mentions)='object');
update public.posts p set post_mentions=refs.data from (
 select post_id,jsonb_object_agg(id::text,jsonb_build_object('mentioned_user_id',mentioned_user_id,'created_at',created_at)) data
 from public.mentions group by post_id
) refs where p.id=refs.post_id;
do $$ begin
 if exists(select 1 from public.mentions m left join public.posts p on p.id=m.post_id
  where p.id is null or not(p.post_mentions?m.id::text)
   or (p.post_mentions->m.id::text->>'mentioned_user_id')::uuid is distinct from m.mentioned_user_id
   or (p.post_mentions->m.id::text->>'created_at')::timestamptz is distinct from m.created_at) or
 (select count(*) from public.mentions)<>(select count(*) from public.posts p cross join lateral jsonb_each(p.post_mentions)) then
  raise exception 'Mention preservation mismatch';
 end if;
end $$;
drop table public.mentions;
drop function if exists public.create_mention_notification();
create view public.mentions with(security_invoker=true) as
 select ref.key::uuid as id,p.id as post_id,(ref.value->>'mentioned_user_id')::uuid as mentioned_user_id,
 (ref.value->>'created_at')::timestamptz as created_at
 from public.posts p cross join lateral jsonb_each(p.post_mentions) ref;
alter view public.mentions alter column id set default gen_random_uuid();
alter view public.mentions alter column created_at set default now();
revoke all on public.mentions from public,anon,authenticated,service_role;
grant select on public.mentions to anon,authenticated,service_role;
grant insert on public.mentions to authenticated,service_role;

create function public.validate_post_mentions() returns trigger
language plpgsql set search_path='' as $$
declare ref record;
begin
 if tg_op='UPDATE' and new.post_mentions=old.post_mentions then return new;end if;
 if current_user in ('anon','authenticated') and new.post_mentions<>'{}'::jsonb then
  raise exception 'Use the mention endpoint' using errcode='42501';
 end if;
 if current_user in ('anon','authenticated') and tg_op='UPDATE' then
  raise exception 'Use the mention endpoint' using errcode='42501';
 end if;
 for ref in select * from jsonb_each(new.post_mentions) loop
  perform ref.key::uuid;
  if ref.value->>'mentioned_user_id' is null then raise exception 'Missing mention recipient' using errcode='23502';end if;
  if not exists(select 1 from public.profiles where id=(ref.value->>'mentioned_user_id')::uuid) then
   raise exception 'Unknown mention recipient' using errcode='23503';
  end if;
  perform (ref.value->>'created_at')::timestamptz;
  perform pg_advisory_xact_lock(hashtextextended(ref.key,0));
  if exists(select 1 from public.posts p where p.id<>new.id and p.post_mentions?ref.key) then
   raise exception 'Duplicate mention ID' using errcode='23505';
  end if;
 end loop;
 return new;
end $$;
create trigger validate_post_mentions before insert or update of post_mentions on public.posts
 for each row execute function public.validate_post_mentions();

create function public.write_post_mention() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid;audience text;role_name text:=current_setting('role',true);
begin
 if new.id is null or new.post_id is null or new.mentioned_user_id is null then
  raise exception 'Missing mention reference' using errcode='23502';
 end if;
 if public.is_account_suspended(auth.uid()) then raise exception 'ACCOUNT_SUSPENDED' using errcode='42501';end if;
 select user_id,visibility into actor,audience from public.posts where id=new.post_id for update;
 if not found then raise exception 'Post not found' using errcode='23503';end if;
 if role_name in ('anon','authenticated') and (role_name<>'authenticated' or auth.uid() is null or actor is distinct from auth.uid() or not public.can_view_post_audience(actor,audience)) then
  raise exception 'Cannot mention from another post' using errcode='42501';
 end if;
 update public.posts set post_mentions=post_mentions||jsonb_build_object(new.id::text,
  jsonb_build_object('mentioned_user_id',new.mentioned_user_id,'created_at',new.created_at))
 where id=new.post_id and not(post_mentions?new.id::text);
 if not found then raise exception 'Duplicate mention ID' using errcode='23505';end if;
 perform public.create_activity_notification(new.mentioned_user_id,actor,'mention',new.post_id,null,null,'mention:'||new.id);
 return new;
end $$;
revoke all on function public.write_post_mention(),public.validate_post_mentions() from public,anon,authenticated;
create trigger write_post_mention instead of insert on public.mentions
 for each row execute function public.write_post_mention();

create function public.remove_deleted_mention_recipient() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.posts p set post_mentions=coalesce((select jsonb_object_agg(ref.key,ref.value)
  from jsonb_each(p.post_mentions) ref where ref.value->>'mentioned_user_id'<>old.id::text),'{}'::jsonb)
 where exists(select 1 from jsonb_each(p.post_mentions) ref where ref.value->>'mentioned_user_id'=old.id::text);
 return old;
end $$;
create trigger remove_deleted_mention_recipient after delete on public.profiles
 for each row execute function public.remove_deleted_mention_recipient();
revoke all on function public.remove_deleted_mention_recipient() from public,anon,authenticated;

do $$ declare definition text;needle text;begin
 -- The scheduled publisher previously used a table-only ON CONFLICT clause.
 definition:=pg_get_functiondef('public.publish_scheduled_posts()'::regprocedure);
 needle:=' m) on conflict do nothing;';
 if strpos(definition,needle)=0 then raise exception 'Unexpected scheduled mention definition';end if;
 execute replace(definition,needle,' m);');
 definition:=pg_get_functiondef('public.account_export_tables()'::regprocedure);
 needle:='or c.table_name in (''user_entitlements'',''poll_votes'')';
 if strpos(definition,needle)=0 then raise exception 'Unexpected export source definition';end if;
 execute replace(definition,needle,'or c.table_name in (''user_entitlements'',''poll_votes'',''mentions'')');
 definition:=pg_get_functiondef('public.account_export_rows(uuid,text,integer,timestamptz)'::regprocedure);
 needle:='if p_table=''poll_votes'' then ordering:=''t.post_id,t.user_id'';end if;';
 if strpos(definition,needle)=0 then raise exception 'Unexpected export ordering definition';end if;
 execute replace(definition,needle,needle||' if p_table=''mentions'' then ordering:=''t.id'';end if;');
end $$;
notify pgrst,'reload schema';
commit;
