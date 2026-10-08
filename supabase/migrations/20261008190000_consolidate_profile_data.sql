-- Apply together with the frontend that reads pins/about directly from profiles.
-- Existing rows are copied and checked before retiring the redundant tables.
begin;
lock table public.profiles, public.profile_pins, public.account_about,
  public.profile_private_settings, public.external_account_imports in share row exclusive mode;

alter table public.profiles add column if not exists pinned_post_id uuid;
alter table public.profiles
  add column country_code text check (country_code ~ '^[A-Z]{2}$' and country_code <> 'XX'),
  add column connection_source text check (connection_source in (
    'LimeNote for Web','LimeNote for iPhone','LimeNote for iPad','LimeNote for Android',
    'LimeNote for Windows','LimeNote for Mac','LimeNote for Linux')),
  add column connection_updated_at timestamptz,
  add column username_change_count integer not null default 0 check (username_change_count >= 0),
  add column last_username_change_at timestamptz,
  add column username_tracking_since timestamptz not null default now();
alter table public.profile_private_settings add column external_accounts_imported_at timestamptz;

update public.profiles p set pinned_post_id=pin.post_id from public.profile_pins pin where pin.user_id=p.id;
update public.profiles p set country_code=a.country_code, connection_source=a.connection_source,
  connection_updated_at=a.connection_updated_at,username_change_count=a.username_change_count,
  last_username_change_at=a.last_username_change_at,username_tracking_since=a.tracking_since
from public.account_about a where a.user_id=p.id;
insert into public.profile_private_settings(user_id,external_accounts_imported_at)
  select user_id,imported_at from public.external_account_imports
  on conflict(user_id) do update set external_accounts_imported_at=excluded.external_accounts_imported_at;

-- Verify every source row. Any mismatch aborts the transaction without a drop.
do $$ begin
  if exists(select 1 from public.profile_pins s left join public.profiles p on p.id=s.user_id where p.id is null or p.pinned_post_id is distinct from s.post_id) then
    raise exception 'Pin migration mismatch';
  end if;
  if exists(select 1 from public.account_about s left join public.profiles p on p.id=s.user_id where p.id is null or
    row(p.country_code,p.connection_source,p.connection_updated_at,p.username_change_count,p.last_username_change_at,p.username_tracking_since)
    is distinct from row(s.country_code,s.connection_source,s.connection_updated_at,s.username_change_count,s.last_username_change_at,s.tracking_since)) then
    raise exception 'Account information migration mismatch';
  end if;
  if exists(select 1 from public.external_account_imports s left join public.profile_private_settings p on p.user_id=s.user_id
    where p.user_id is null or p.external_accounts_imported_at is distinct from s.imported_at) then
    raise exception 'Import marker migration mismatch';
  end if;
end $$;

-- Replace an existing FK if needed so deleting a post clears its profile pin.
do $$ declare fk record; begin
  for fk in select c.conname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
    where c.conrelid='public.profiles'::regclass and c.contype='f' and a.attname='pinned_post_id'
  loop execute format('alter table public.profiles drop constraint %I',fk.conname); end loop;
end $$;
alter table public.profiles add constraint profiles_pinned_post_id_fkey
  foreign key(pinned_post_id) references public.posts(id) on delete set null;

drop trigger account_username_changed on public.profiles;
drop function public.record_account_username_change();
create function public.guard_profile_account_fields() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    if current_user in ('anon','authenticated') then
      if NEW.id is distinct from auth.uid() then raise exception 'Cannot create another profile' using errcode='42501'; end if;
      NEW.country_code:=null;NEW.connection_source:=null;NEW.connection_updated_at:=null;
      NEW.username_change_count:=0;NEW.last_username_change_at:=null;NEW.username_tracking_since:=now();
    end if;
  else
    if current_user in ('anon','authenticated') then
      if row(NEW.country_code,NEW.connection_source,NEW.connection_updated_at,NEW.username_change_count,NEW.last_username_change_at,NEW.username_tracking_since)
        is distinct from row(OLD.country_code,OLD.connection_source,OLD.connection_updated_at,OLD.username_change_count,OLD.last_username_change_at,OLD.username_tracking_since) then
        raise exception 'Account metadata is maintained by the server' using errcode='42501';
      end if;
      if (NEW.pinned_post_id is distinct from OLD.pinned_post_id or NEW.username is distinct from OLD.username)
        and NEW.id is distinct from auth.uid() then raise exception 'Cannot update another profile' using errcode='42501'; end if;
    end if;
    if NEW.username is distinct from OLD.username then
      NEW.username_change_count:=OLD.username_change_count+1;NEW.last_username_change_at:=now();
    end if;
  end if;
  if NEW.pinned_post_id is not null and (TG_OP='INSERT' or NEW.pinned_post_id is distinct from OLD.pinned_post_id) then
    if not exists(select 1 from public.posts p where p.id=NEW.pinned_post_id and p.user_id=NEW.id) then
      raise exception 'Only an own post can be pinned' using errcode='42501';
    end if;
  end if;
  return NEW;
end $$;
revoke all on function public.guard_profile_account_fields() from public;
create trigger profile_account_fields before insert or update on public.profiles
for each row execute function public.guard_profile_account_fields();

create or replace function public.update_account_connection(expected_user_id uuid,country text,client text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.uid() <> expected_user_id then raise exception 'Unauthenticated account' using errcode='42501'; end if;
  if country is null or country !~ '^[A-Z]{2}$' or country='XX' then raise exception 'Invalid country'; end if;
  update public.profiles set country_code=country,connection_source=client,connection_updated_at=now() where id=auth.uid();
  if not found then raise exception 'Profile not found'; end if;
end $$;

create or replace function public.import_external_account_users(legacy jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
  if legacy is null or jsonb_typeof(legacy)<>'array' or jsonb_array_length(legacy)>1000 then raise exception 'Invalid legacy accounts'; end if;
  insert into public.profile_private_settings(user_id,external_accounts_imported_at) values(auth.uid(),now())
    on conflict(user_id) do update set external_accounts_imported_at=excluded.external_accounts_imported_at
    where public.profile_private_settings.external_accounts_imported_at is null;
  if not found then return; end if;
  insert into public.external_account_users(user_id,provider,handle)
    select auth.uid(),item->>'provider',item->>'handle' from jsonb_array_elements(legacy) item on conflict do nothing;
end $$;

-- No CASCADE: an unexpected dependency stops the migration for review.
drop table public.profile_pins;
drop table public.account_about;
drop table public.external_account_imports;
notify pgrst,'reload schema';
commit;
