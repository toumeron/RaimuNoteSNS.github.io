begin;
create table public.external_account_users (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('bluesky','misskey')),
  handle text not null check (length(handle) between 1 and 253 and handle !~ '[[:space:]/]' and handle = lower(handle)),
  created_at timestamptz not null default now(),
  primary key (user_id,provider,handle)
);
create table public.external_account_imports (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  imported_at timestamptz not null default now()
);
alter table public.external_account_users enable row level security;
alter table public.external_account_imports enable row level security;
create policy external_users_read on public.external_account_users for select to authenticated using(user_id=auth.uid());
create policy external_users_add on public.external_account_users for insert to authenticated with check(user_id=auth.uid());
create policy external_users_remove on public.external_account_users for delete to authenticated using(user_id=auth.uid());
revoke all on public.external_account_users from authenticated;
grant select,insert,delete on public.external_account_users to authenticated;
revoke all on public.external_account_users from anon;
revoke all on public.external_account_imports from anon,authenticated;
create function public.import_external_account_users(legacy jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
  if jsonb_typeof(legacy) <> 'array' or legacy is null or jsonb_array_length(legacy)>1000 then
    raise exception 'Invalid legacy accounts';
  end if;
  insert into public.external_account_imports(user_id) values(auth.uid()) on conflict do nothing;
  if not found then return; end if;
  insert into public.external_account_users(user_id,provider,handle)
    select auth.uid(),item->>'provider',item->>'handle' from jsonb_array_elements(legacy) item
    on conflict do nothing;
end;
$$;
revoke all on function public.import_external_account_users(jsonb) from public;
grant execute on function public.import_external_account_users(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
