begin;
-- The token endpoint reads the host, expiry and speaker policy before authorizing audio.
grant select on public.spaces to service_role;
notify pgrst, 'reload schema';
commit;
