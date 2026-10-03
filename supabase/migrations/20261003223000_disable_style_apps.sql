-- Retire the design store without deleting saved user data or rewriting migration history.
begin;
revoke all privileges on table public.style_apps from public, anon, authenticated;
revoke all privileges on table public.style_app_preferences from public, anon, authenticated;
revoke all privileges on function public.install_style_app(uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
