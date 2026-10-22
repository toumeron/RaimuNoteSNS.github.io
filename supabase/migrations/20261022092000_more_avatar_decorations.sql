-- Add mouth censor and sleep overlays. Existing images and transform options stay intact.
alter table public.profiles drop constraint profiles_avatar_decoration_check;
alter table public.profiles add constraint profiles_avatar_decoration_check check (avatar_decoration is null or avatar_decoration in ('santa','sunglasses','censored','sleep'));
notify pgrst,'reload schema';
