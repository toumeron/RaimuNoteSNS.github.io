begin;
-- Preserve Unicode/case as entered; URL parsing/IDNA checks also run in the client.
alter table public.profiles drop constraint profiles_website_host_check;
alter table public.profiles add constraint profiles_website_host_check check (
 website_url is null or website_url ~* '^https?://(([[:alnum:]]([[:alnum:]-]{0,61}[[:alnum:]])?\.)+([[:alpha:]]{2,63}|xn--[a-z0-9-]+)|((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))(:[0-9]+)?([/?#][^[:space:]]*)?$'
) not valid;
notify pgrst, 'reload schema';
commit;
