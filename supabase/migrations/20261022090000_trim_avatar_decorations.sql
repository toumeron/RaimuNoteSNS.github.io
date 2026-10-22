-- Removed decorations are no longer rendered or offered in settings.
update public.profiles set avatar_decoration=null,avatar_decoration_options=null where avatar_decoration in ('hearts','anger','crown');
alter table public.profiles drop constraint profiles_avatar_decoration_check;
alter table public.profiles add constraint profiles_avatar_decoration_check check (avatar_decoration is null or avatar_decoration in ('santa','restricted','sunglasses'));
notify pgrst,'reload schema';
