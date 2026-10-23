-- Export throttling is account metadata, not a separate entity.
-- Keep the service-only compatibility view for the deployed export function.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.account_exports, public.profile_private_settings in share row exclusive mode;

alter table public.profile_private_settings
 add column export_attempts integer not null default 0 check(export_attempts>=0),
 add column export_attempt_window timestamptz not null default now();

insert into public.profile_private_settings(user_id,export_attempts,export_attempt_window)
 select user_id,attempts,attempt_window from public.account_exports
 on conflict(user_id) do update set export_attempts=excluded.export_attempts,
 export_attempt_window=excluded.export_attempt_window;

do $$ begin
 if exists(select 1 from public.account_exports old
  left join public.profile_private_settings s using(user_id)
  where s.user_id is null or row(s.export_attempts,s.export_attempt_window)
   is distinct from row(old.attempts,old.attempt_window)) then
  raise exception 'Export limit consolidation mismatch';
 end if;
end $$;

create or replace function public.account_export_attempt(p_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
 insert into public.profile_private_settings(user_id) values(p_user_id) on conflict do nothing;
 update public.profile_private_settings
 set export_attempts=case when export_attempt_window<now()-interval '15 minutes' then 1 else export_attempts+1 end,
 export_attempt_window=case when export_attempt_window<now()-interval '15 minutes' then now() else export_attempt_window end
 where user_id=p_user_id returning export_attempts<=5 into allowed;
 return allowed;
end $$;
revoke all on function public.account_export_attempt(uuid) from public,anon,authenticated;
grant execute on function public.account_export_attempt(uuid) to service_role;

-- No CASCADE: unexpected dependencies must abort instead of disappearing.
drop table public.account_exports;
create view public.account_exports with (security_invoker=true) as
 select user_id,export_attempts as attempts,export_attempt_window as attempt_window
 from public.profile_private_settings;
revoke all on public.account_exports from public,anon,authenticated;
grant select,insert,update,delete on public.account_exports to service_role;

notify pgrst,'reload schema';
commit;
