begin;
-- Only structured appearance settings are accepted; executable CSS/HTML is never rendered.
create function public.valid_style_spec(spec jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare mode text; field text;
begin
  if jsonb_typeof(spec) is distinct from 'object' or spec->>'version' is distinct from '1' or jsonb_typeof(spec->'version') is distinct from 'number'
     or coalesce(spec->>'font', '') not in ('rounded', 'system', 'serif')
     or jsonb_typeof(spec->'radius') is distinct from 'number'
     or (spec->>'radius') !~ '^(0|[1-9]|1[0-9]|2[0-4])$' then return false; end if;
  foreach mode in array array['light','dark'] loop
    if jsonb_typeof(spec->mode) is distinct from 'object' then return false; end if;
    foreach field in array array['background','surface','text','accent','border'] loop
      if jsonb_typeof(spec->mode->field) is distinct from 'string'
         or coalesce(spec->mode->>field, '') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
create table public.style_apps (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  spec jsonb not null check (public.valid_style_spec(spec)),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index style_apps_public_updated_idx on public.style_apps(updated_at desc, id) where is_published;
create index style_apps_author_updated_idx on public.style_apps(author_id, updated_at desc, id);
create function public.style_app_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger style_app_updated before update on public.style_apps for each row execute function public.style_app_updated_at();
alter table public.style_apps enable row level security;
grant select, insert, update, delete on public.style_apps to authenticated;
create policy style_apps_read on public.style_apps for select to authenticated using (is_published or author_id = auth.uid());
create policy style_apps_insert on public.style_apps for insert to authenticated with check (author_id = auth.uid());
create policy style_apps_update on public.style_apps for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy style_apps_delete on public.style_apps for delete to authenticated using (author_id = auth.uid());
create table public.style_app_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  style_id uuid references public.style_apps(id) on delete set null,
  style_name text,
  spec jsonb check (spec is null or public.valid_style_spec(spec)),
  updated_at timestamptz not null default now()
);
alter table public.style_app_preferences enable row level security;
grant select on public.style_app_preferences to authenticated;
create policy style_app_preferences_read on public.style_app_preferences for select to authenticated using (user_id = auth.uid());
-- Copy a validated snapshot on the server. Installed styles survive unpublishing/deletion.
create function public.install_style_app(selected_style_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); selected public.style_apps%rowtype;
begin
  if viewer is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if selected_style_id is null then
    delete from public.style_app_preferences where user_id = viewer;
    return jsonb_build_object('style_id', null, 'style_name', null, 'spec', null);
  end if;
  select * into selected from public.style_apps where id = selected_style_id and (is_published or author_id = viewer);
  if not found then raise exception 'Style is unavailable' using errcode = '42501'; end if;
  insert into public.style_app_preferences(user_id, style_id, style_name, spec)
    values(viewer, selected.id, selected.title, selected.spec)
    on conflict(user_id) do update set style_id = excluded.style_id, style_name = excluded.style_name, spec = excluded.spec, updated_at = now();
  return jsonb_build_object('style_id', selected.id, 'style_name', selected.title, 'spec', selected.spec);
end $$;
revoke all on function public.install_style_app(uuid) from public, anon;
grant execute on function public.install_style_app(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
