-- Public decoration metadata stays on the existing profile. Avatar files are unchanged.
alter table public.profiles add column if not exists avatar_decoration text;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_avatar_decoration_check') then
  alter table public.profiles add constraint profiles_avatar_decoration_check check (avatar_decoration is null or avatar_decoration = 'santa');
 end if;
end $$;
grant select(avatar_decoration), update(avatar_decoration) on public.profiles to authenticated;
grant select(avatar_decoration) on public.profiles to anon;
-- Existing profile UPDATE ownership RLS remains responsible for authorizing writes.
notify pgrst, 'reload schema';
