begin;
-- An arbitrary word is not a website. Permit DNS domains and dotted IPv4 hosts.
alter table public.profiles add constraint profiles_website_host_check check (
 website_url is null or website_url ~* '^https?://(([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]+)|((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))(:[0-9]+)?([/?#][^[:space:]]*)?$'
) not valid;
-- Existing values are retained. All new writes must pass this constraint.
notify pgrst, 'reload schema';
commit;
