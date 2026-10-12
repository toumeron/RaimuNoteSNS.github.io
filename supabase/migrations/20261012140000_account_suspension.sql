begin;
set local lock_timeout='3s';
alter table public.profiles add column if not exists "Account_suspension" boolean not null default false;
grant select("Account_suspension") on public.profiles to anon,authenticated;

-- Lookup must bypass profile RLS without exposing private profile fields.
create or replace function public.is_account_suspended(account_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select p."Account_suspension" from public.profiles p where p.id=account_id),false);
$$;
revoke all on function public.is_account_suspended(uuid) from public;
grant execute on function public.is_account_suspended(uuid) to anon,authenticated,service_role;

-- auth.uid() survives SECURITY DEFINER RPCs; current_user alone does not.
create or replace function limenote_security.guard_suspended_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.is_account_suspended(auth.uid()) then
  raise exception 'ACCOUNT_SUSPENDED: このアカウントは凍結されているため、閲覧以外の操作は許可されていません' using errcode='42501';
 end if;
 return null;
end;$$;
revoke all on function limenote_security.guard_suspended_write() from public,anon,authenticated;
create or replace function limenote_security.protect_suspension_flag() returns trigger
language plpgsql set search_path='' as $$
begin
 if auth.uid() is not null or current_user in('anon','authenticated') then
  if (tg_op='INSERT' and new."Account_suspension") or
   (tg_op='UPDATE' and new."Account_suspension" is distinct from old."Account_suspension") then
   raise exception 'Account_suspension is administrator-managed' using errcode='42501';
  end if;
 end if;
 return new;
end;$$;
revoke all on function limenote_security.protect_suspension_flag() from public,anon,authenticated;
create trigger security_suspension_flag before insert or update on public.profiles
 for each row execute function limenote_security.protect_suspension_flag();

-- Cover direct writes, nested RPC writes and TRUNCATE without altering data.
do $$declare t record;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
 loop
  execute format('create trigger security_suspended_write before insert or update or delete or truncate on public.%I for each statement execute function limenote_security.guard_suspended_write()',t.relname);
 end loop;
end;$$;

-- Public contributions disappear while frozen, including their linked media
-- and children through the existing parent-visibility policies.
do $$declare s record;begin
 for s in select * from (values
 ('posts','user_id'),('comments','user_id'),('reposts','user_id'),('reply_reposts','user_id'),
 ('external_reposts','user_id'),('timeline_posts','user_id'),('account_reviews','author_id'),
 ('user_lists','owner_id'),('spaces','host_id'),('style_apps','author_id'),('profile_highlights','user_id'),
 ('likes','user_id'),('comment_likes','user_id'),('post_reactions','user_id'),('comment_reactions','user_id'),('reactions','user_id')) x(tab,col)
 loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=s.tab and c.relkind='r') then continue;end if;
  execute format('alter table public.%I enable row level security',s.tab);
  execute format('create policy security_suspended_author on public.%I as restrictive for select to anon,authenticated using(not public.is_account_suspended(%I))',s.tab,s.col);
 end loop;
end;$$;
-- Storage is managed by Supabase: use policies, not owner-only triggers.
create policy security_suspended_storage_insert on storage.objects as restrictive for insert to anon,authenticated with check(not public.is_account_suspended(auth.uid()));
create policy security_suspended_storage_update on storage.objects as restrictive for update to anon,authenticated using(not public.is_account_suspended(auth.uid())) with check(not public.is_account_suspended(auth.uid()));
create policy security_suspended_storage_delete on storage.objects as restrictive for delete to anon,authenticated using(not public.is_account_suspended(auth.uid()));

-- Keep existing activity RPCs and notification policies consistent with RLS.
create or replace function public.can_view_account_activity(account_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=account_id and not p."Account_suspension" and
 (not p.is_private or p.id=auth.uid() or exists(select 1 from public.follows f
 where f.follower_id=auth.uid() and f.followee_id=p.id and f.approved)));
$$;
create policy security_suspended_notification_actor on public.notifications as restrictive for select to anon,authenticated
 using(actor_id is null or not public.is_account_suspended(actor_id));
create policy security_suspended_post_media_author on storage.objects as restrictive for select to anon,authenticated
 using(bucket_id<>'post-media' or case when split_part(name,'/',1) ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
 then not public.is_account_suspended(split_part(name,'/',1)::uuid) else false end);

-- Server-side bot posting must also respect the author's suspension.
create function limenote_security.guard_suspended_post_author() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if public.is_account_suspended(new.user_id) then
  raise exception 'ACCOUNT_SUSPENDED: 凍結されたアカウントは投稿できません' using errcode='42501';
 end if;
 return new;
end;$$;
revoke all on function limenote_security.guard_suspended_post_author() from public,anon,authenticated;
create trigger security_suspended_post_author before insert on public.posts for each row execute function limenote_security.guard_suspended_post_author();

-- News summaries must not keep advertising hidden source posts.
create or replace function public.news_sources_are_public(news_source text, ids text[]) returns boolean
language sql stable security definer set search_path='' as $$
 select cardinality(ids) between 1 and 10 and case when news_source='bluesky'
 then not exists(select 1 from unnest(ids) refs(post_id) where refs.post_id not like 'bsky:at://%')
 else not exists(select 1 from unnest(ids) refs(post_id) where not exists(
 select 1 from public.posts p join public.profiles a on a.id=p.user_id
 where p.id::text=refs.post_id and p.visibility='public' and not a.is_private and not a."Account_suspension")) end;
$$;
notify pgrst,'reload schema';
commit;
