-- Extend the existing profile decoration without changing avatar images or ownership RLS.
alter table public.profiles add column if not exists avatar_decoration_options jsonb;
alter table public.profiles drop constraint if exists profiles_avatar_decoration_check;
alter table public.profiles add constraint profiles_avatar_decoration_check check (avatar_decoration is null or avatar_decoration in ('santa','restricted','sunglasses','hearts','anger','crown'));
alter table public.profiles add constraint profiles_avatar_decoration_options_check check (
 avatar_decoration_options is null or coalesce(case when
  jsonb_typeof(avatar_decoration_options)='object'
  and jsonb_typeof(avatar_decoration_options->'angle')='number'
  and jsonb_typeof(avatar_decoration_options->'x')='number'
  and jsonb_typeof(avatar_decoration_options->'y')='number'
  and jsonb_typeof(avatar_decoration_options->'flip')='boolean'
 then (avatar_decoration_options->>'angle')::numeric between -180 and 180
  and (avatar_decoration_options->>'x')::numeric between -100 and 100
  and (avatar_decoration_options->>'y')::numeric between -100 and 100
  and avatar_decoration_options - array['angle','x','y','flip'] = '{}'::jsonb
 else false end,false));
grant select(avatar_decoration_options),update(avatar_decoration_options) on public.profiles to authenticated;
grant select(avatar_decoration_options) on public.profiles to anon;
notify pgrst,'reload schema';
