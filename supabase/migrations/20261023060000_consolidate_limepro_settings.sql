-- LimePro is an account setting, not a separate entity. Keep the deployed API
-- writable until a separately authorized frontend release can retire it.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.user_entitlements,public.profile_private_settings in share row exclusive mode;
alter table public.profile_private_settings add column limepro_purchased_at timestamptz;
do $$ begin
 if exists(select 1 from public.user_entitlements where feature<>'limepro') then
  raise exception 'Unexpected entitlement feature; consolidation aborted';
 end if;
end $$;
insert into public.profile_private_settings(user_id,limepro_purchased_at)
 select user_id,purchased_at from public.user_entitlements
 on conflict(user_id) do update set limepro_purchased_at=excluded.limepro_purchased_at;
do $$ begin
 if exists(select 1 from public.user_entitlements e left join public.profile_private_settings s using(user_id)
  where s.user_id is null or s.limepro_purchased_at is distinct from e.purchased_at) then
  raise exception 'LimePro setting preservation mismatch';
 end if;
end $$;

-- Detach the known dependent view without changing its columns or grants.
create or replace view public.profiles_with_limepro with(security_invoker=true) as
 select id,username,display_name,bio,avatar_url,cover_url,created_at,is_official,
 emoji_effect,bot_enabled,bot_prompt,bot_interval_hours,prefecture,city,
 exists(select 1 from public.profile_private_settings s where s.user_id=p.id and s.limepro_purchased_at is not null) as has_limepro
 from public.profiles p;
-- No CASCADE: any unknown dependency aborts the entire transaction.
drop table public.user_entitlements;
create view public.user_entitlements with(security_invoker=true) as
 select user_id,'limepro'::text as feature,limepro_purchased_at as purchased_at
 from public.profile_private_settings where limepro_purchased_at is not null;
revoke all on public.user_entitlements from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.user_entitlements to authenticated,service_role;

create function public.write_limepro_setting() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text:=current_setting('role',true); target uuid;
begin
 target:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 if public.is_account_suspended(actor) then raise exception 'ACCOUNT_SUSPENDED' using errcode='42501';end if;
 if role_name in ('anon','authenticated') and (role_name<>'authenticated' or actor is null or target is distinct from actor) then
  raise exception 'Cannot change another account setting' using errcode='42501';
 end if;
 if tg_op<>'DELETE' and (new.feature is distinct from 'limepro' or new.user_id is null) then
  raise exception 'Invalid entitlement' using errcode='23514';
 end if;
 if tg_op='UPDATE' and new.user_id is distinct from old.user_id then
  raise exception 'Cannot move an account setting' using errcode='42501';
 end if;
 if tg_op='DELETE' then
  update public.profile_private_settings set limepro_purchased_at=null where user_id=old.user_id;
  return old;
 end if;
 new.purchased_at:=coalesce(new.purchased_at,now());
 insert into public.profile_private_settings(user_id) values(new.user_id) on conflict do nothing;
 update public.profile_private_settings set limepro_purchased_at=new.purchased_at
 where user_id=new.user_id and (tg_op<>'INSERT' or limepro_purchased_at is null);
 if not found then raise exception 'LimePro already enabled' using errcode='23505';end if;
 return new;
end $$;
revoke all on function public.write_limepro_setting() from public,anon,authenticated;
create trigger write_limepro_setting instead of insert or update or delete on public.user_entitlements
 for each row execute function public.write_limepro_setting();
notify pgrst,'reload schema';
commit;
