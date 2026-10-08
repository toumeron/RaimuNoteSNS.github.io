begin;

-- Country-level metadata only; IP addresses and coordinates are never stored.
create table public.account_about (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  country_code text check (country_code ~ '^[A-Z]{2}$' and country_code <> 'XX'),
  connection_source text check (connection_source in (
    'LimeNote for Web','LimeNote for iPhone','LimeNote for iPad','LimeNote for Android',
    'LimeNote for Windows','LimeNote for Mac','LimeNote for Linux')),
  connection_updated_at timestamptz,
  username_change_count integer not null default 0 check (username_change_count >= 0),
  last_username_change_at timestamptz,
  tracking_since timestamptz not null default now()
);
alter table public.account_about enable row level security;
create policy account_about_read on public.account_about for select to anon, authenticated using (true);
grant select on public.account_about to anon, authenticated;
revoke insert, update, delete on public.account_about from anon, authenticated;
insert into public.account_about(user_id) select id from public.profiles;

create function public.record_account_username_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.account_about(user_id) values (NEW.id) on conflict do nothing;
  elsif NEW.username is distinct from OLD.username then
    insert into public.account_about(user_id,username_change_count,last_username_change_at)
    values (NEW.id,1,now()) on conflict (user_id) do update
    set username_change_count = public.account_about.username_change_count + 1,
        last_username_change_at = now();
  end if;
  return NEW;
end;
$$;
revoke all on function public.record_account_username_change() from public;
create trigger account_username_changed after insert or update of username on public.profiles
for each row execute function public.record_account_username_change();

create function public.update_account_connection(expected_user_id uuid, country text, client text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() <> expected_user_id then
    raise exception 'Unauthenticated account' using errcode = '42501';
  end if;
  if country is null or country !~ '^[A-Z]{2}$' or country = 'XX' then
    raise exception 'Invalid country';
  end if;
  insert into public.account_about(user_id,country_code,connection_source,connection_updated_at)
  values (auth.uid(),country,client,now()) on conflict (user_id) do update
  set country_code = excluded.country_code,
      connection_source = excluded.connection_source,
      connection_updated_at = excluded.connection_updated_at;
end;
$$;
revoke all on function public.update_account_connection(uuid,text,text) from public;
grant execute on function public.update_account_connection(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
