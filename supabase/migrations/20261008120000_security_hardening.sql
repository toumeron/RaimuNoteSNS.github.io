begin;
-- Keep SECURITY DEFINER lookup paths free of attacker-created objects.
revoke create on schema public from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public;
do $$
declare routine record;
begin
 for routine in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.proconfig @> array['search_path=public'] loop
  execute format('alter function %s set search_path=public,pg_temp',routine.signature);
 end loop;
end;$$;
create schema if not exists limenote_security;
revoke all on schema limenote_security from public, anon, authenticated;

-- Distributed counters: a new isolate or a forged client ID cannot reset quotas.
create table if not exists limenote_security.request_limits (
 actor_id uuid not null references auth.users(id) on delete cascade,
 scope text not null, window_start timestamptz not null, attempts integer not null,
 primary key(actor_id,scope)
);
alter table limenote_security.request_limits enable row level security;
revoke all on limenote_security.request_limits from public,anon,authenticated;
create or replace function public.consume_security_quota(p_actor uuid,p_scope text) returns boolean
language plpgsql security definer set search_path='' as $$
declare cap integer; used integer;
begin
 cap:=case p_scope when 'chat' then 30 when 'voice' then 60 when 'token' then 60 when 'preview' then 120 when 'upload' then 20 else null end;
 if cap is null or p_actor is null then return false; end if;
 insert into limenote_security.request_limits(actor_id,scope,window_start,attempts) values(p_actor,p_scope,now(),1)
 on conflict(actor_id,scope) do update set
 attempts=case when request_limits.window_start<now()-interval '5 minutes' then 1 else request_limits.attempts+1 end,
 window_start=case when request_limits.window_start<now()-interval '5 minutes' then now() else request_limits.window_start end
 returning attempts into used;
 return used<=cap;
end;$$;
revoke all on function public.consume_security_quota(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_security_quota(uuid,text) to service_role;

-- Restrictive policies remain effective even if old debug ALL policies exist.
-- Keep legacy permissive policies for application behavior, require ownership
-- independently for every client write and for all private account reads.
do $$
declare spec record; command text; expression text;
begin
 for spec in select * from (values
 ('posts','user_id',false),('comments','user_id',false),('profiles','id',false),
 ('follows','follower_id',false),('likes','user_id',false),('comment_likes','user_id',false),
 ('post_reactions','user_id',false),('comment_reactions','user_id',false),
 ('reposts','user_id',false),('reply_reposts','user_id',false),('external_reposts','user_id',false),
 ('custom_emojis','uploaded_by',false),('bookmarks','user_id',true),('chat_sessions','user_id',true),('push_subscriptions','user_id',true),
 ('post_notification_subscriptions','subscriber_id',true),('notifications','user_id',true),
 ('profile_pins','user_id',false),('memberships','member_id',false)
 ) v(table_name,owner_column,private_read)
 loop
  if to_regclass('public.'||spec.table_name) is null then continue; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=spec.table_name and column_name=spec.owner_column) then
   raise exception 'Unexpected owner column on %; review schema before deployment',spec.table_name;
  end if;
  execute format('alter table public.%I enable row level security',spec.table_name);
  expression:=format('%I = (select auth.uid())',spec.owner_column);
  foreach command in array array['insert','update','delete'] loop
   execute format('create policy %I on public.%I as restrictive for %s to anon,authenticated %s',
    'security_owner_'||command,spec.table_name,command,
    case command when 'insert' then 'with check ('||expression||')'
     when 'update' then 'using ('||expression||') with check ('||expression||')'
     else 'using ('||expression||')' end);
  end loop;
  if spec.private_read then
   execute format('create policy security_private_read on public.%I as restrictive for select to anon,authenticated using (%s)',spec.table_name,expression);
  end if;
 end loop;
end;$$;

-- Side tables must not reveal activity on a post hidden from the viewer.
do $$
declare spec record;
begin
 for spec in select * from (values ('likes','post_id','posts'),('post_reactions','post_id','posts'),
 ('reposts','post_id','posts'),('mentions','post_id','posts'),('profile_pins','post_id','posts'),
 ('comment_likes','comment_id','comments'),('comment_reactions','comment_id','comments'),('reply_reposts','comment_id','comments')) v(table_name,parent_column,parent_table)
 loop
  if to_regclass('public.'||spec.table_name) is null then continue; end if;
  execute format('alter table public.%I enable row level security',spec.table_name);
  execute format('create policy security_visible_parent on public.%I as restrictive for select to anon,authenticated using (exists(select 1 from public.%I p where p.id=%I.%I))',spec.table_name,spec.parent_table,spec.table_name,spec.parent_column);
  execute format('create policy security_insert_visible_parent on public.%I as restrictive for insert to anon,authenticated with check (exists(select 1 from public.%I p where p.id=%I.%I))',spec.table_name,spec.parent_table,spec.table_name,spec.parent_column);
 end loop;
end;$$;
create policy security_comment_parent_write on public.comments as restrictive for insert to anon,authenticated
 with check(exists(select 1 from public.posts p where p.id=post_id));
create policy security_notification_post_read on public.notifications as restrictive for select to anon,authenticated
 using(post_id is null or exists(select 1 from public.posts p where p.id=post_id));
-- Only trusted DB triggers/webhooks may create notifications; users mark read.
revoke insert on public.notifications from anon,authenticated;

-- Do not permit self-assignment of official/admin flags or account ownership.
create function limenote_security.protect_profile_flags() returns trigger language plpgsql set search_path='' as $$
declare field text;
begin
 if current_user not in ('anon','authenticated') then return new; end if;
 foreach field in array array['is_official','is_admin','role','is_pro','is_lime_pro','lime_pro_until'] loop
  if tg_op='INSERT' then
   if coalesce(to_jsonb(new)->>field,'false') not in ('false','', 'user') then
    raise exception 'Privileged profile fields are server-managed' using errcode='42501';
   end if;
  elsif (to_jsonb(new)->field) is distinct from (to_jsonb(old)->field) then
   raise exception 'Privileged profile fields are server-managed' using errcode='42501';
  end if;
 end loop;
 return new;
end;$$;
revoke all on function limenote_security.protect_profile_flags() from public,anon,authenticated;
create trigger security_profile_flags before insert or update on public.profiles for each row execute function limenote_security.protect_profile_flags();

notify pgrst,'reload schema';
commit;
