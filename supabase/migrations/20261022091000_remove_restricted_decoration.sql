-- Only Santa and sunglasses remain available. Avatar images are unchanged.
update public.profiles set avatar_decoration=null,avatar_decoration_options=null where avatar_decoration='restricted';
alter table public.profiles drop constraint profiles_avatar_decoration_check;
alter table public.profiles add constraint profiles_avatar_decoration_check check (avatar_decoration is null or avatar_decoration in ('santa','sunglasses'));
notify pgrst,'reload schema';
