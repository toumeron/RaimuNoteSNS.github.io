begin;
do $$
declare owner uuid;source jsonb;i integer;
begin
 if has_table_privilege('authenticated','public.account_exports','SELECT') or has_table_privilege('anon','public.account_exports','SELECT') then raise exception 'Private password-attempt metadata is exposed';end if;
 if has_function_privilege('authenticated','public.account_export_rows(uuid,text,integer,timestamptz)','EXECUTE') then raise exception 'Personal-data collector is exposed';end if;
 if has_function_privilege('anon','public.account_export_attempt(uuid)','EXECUTE') then raise exception 'Password-attempt guard is exposed';end if;
 if exists(select 1 from storage.buckets where id='account-exports') then raise exception 'Exports must not have a server storage bucket';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='account_exports' and column_name in ('snapshot_path','archive_path')) then raise exception 'Server archive caching remains enabled';end if;
 for source in select value from jsonb_array_elements(public.account_export_tables()) loop
  if source->>'table'='account_exports' then raise exception 'Internal metadata is included';end if;
  if public.account_export_rows('00000000-0000-0000-0000-000000000000',source->>'table',0,now())<>'[]'::jsonb then raise exception 'Collector returned other-account data';end if;
 end loop;
 -- Only attempt counts change, and this entire transaction is rolled back.
 select id into owner from auth.users order by id limit 1;
 if owner is null then raise exception 'A fixture user is required';end if;
 insert into public.account_exports(user_id) values(owner) on conflict(user_id) do update set attempts=0,attempt_window=now();
 for i in 1..5 loop
  if not public.account_export_attempt(owner) then raise exception 'Password guard rejected too early';end if;
 end loop;
 if public.account_export_attempt(owner) then raise exception 'Password guard failed to limit repeated attempts';end if;
 update public.account_exports set attempt_window=now()-interval '16 minutes' where user_id=owner;
 if not public.account_export_attempt(owner) then raise exception 'Expired attempt limit was not reset';end if;
end;$$;
rollback;
