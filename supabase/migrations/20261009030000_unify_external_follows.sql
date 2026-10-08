begin;
lock table public.follows,public.external_account_users in share row exclusive mode;
alter table public.follows drop constraint follows_pkey;
alter table public.follows alter column followee_id drop not null;
alter table public.follows add column external_provider text, add column external_handle text, add column external_profile jsonb;
alter table public.follows add column follow_key text generated always as (coalesce(followee_id::text,external_provider||':'||external_handle)) stored;
alter table public.follows add primary key(follower_id,follow_key),add unique(follower_id,followee_id);
alter table public.follows add constraint follows_target_check check (
 (followee_id is not null and external_provider is null and external_handle is null and external_profile is null) or
 (followee_id is null and external_provider in ('bluesky','misskey') and external_handle is not null and length(external_handle) between 1 and 253 and external_handle !~ '[[:space:]/]' and external_handle=lower(external_handle) and (external_profile is null or (jsonb_typeof(external_profile)='object' and octet_length(external_profile::text)<32768)))
);
drop trigger notify_account_activity on public.follows;
create trigger notify_account_activity after insert on public.follows for each row when (new.followee_id is not null) execute function public.notify_account_activity();
insert into public.follows(follower_id,external_provider,external_handle,created_at) select user_id,provider,handle,created_at from public.external_account_users on conflict do nothing;
do $$begin
 if exists(select 1 from public.external_account_users e where not exists(select 1 from public.follows f where f.follower_id=e.user_id and f.external_provider=e.provider and f.external_handle=e.handle and f.created_at=e.created_at)) then raise exception 'External follow migration mismatch';end if;
end $$;
-- Keep the old read API as an updatable, RLS-respecting projection of follows.
drop table public.external_account_users;
create view public.external_account_users with(security_invoker=true) as select follower_id as user_id,external_provider as provider,external_handle as handle,created_at from public.follows where external_provider is not null with local check option;
grant select,insert,delete on public.external_account_users to authenticated;
create or replace function public.import_external_account_users(legacy jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if legacy is null or jsonb_typeof(legacy)<>'array' or jsonb_array_length(legacy)>1000 then raise exception 'Invalid legacy accounts';end if;
 insert into public.profile_private_settings(user_id,external_accounts_imported_at) values(auth.uid(),now()) on conflict(user_id) do update set external_accounts_imported_at=excluded.external_accounts_imported_at where public.profile_private_settings.external_accounts_imported_at is null;
 if not found then return;end if;
 insert into public.follows(follower_id,external_provider,external_handle) select auth.uid(),v->>'provider',v->>'handle' from jsonb_array_elements(legacy) v on conflict do nothing;
end $$;
create function public.set_external_follow(provider text,handle text,enabled boolean,profile jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if provider is null or provider not in ('bluesky','misskey') or handle is null or length(handle) not between 1 and 253 or handle ~ '[[:space:]/]' or handle<>lower(handle) then raise exception 'Invalid external follow';end if;
 if enabled then
  insert into public.follows(follower_id,external_provider,external_handle,external_profile) values(auth.uid(),provider,handle,profile) on conflict(follower_id,follow_key) do nothing;
 else delete from public.follows f where f.follower_id=auth.uid() and f.external_provider=provider and f.external_handle=handle;end if;
end $$;
revoke all on function public.set_external_follow(text,text,boolean,jsonb) from public;
grant execute on function public.set_external_follow(text,text,boolean,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
