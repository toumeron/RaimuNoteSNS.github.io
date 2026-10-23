begin;
alter table public.profiles
  add column if not exists website_url text,
  add column if not exists birth_date date;
alter table public.profiles
  add constraint profiles_website_url_check check (
    website_url is null or (length(website_url) <= 2048 and website_url ~* '^https?://[^/[:space:]@:]+(:[0-9]+)?([/?#][^[:space:]]*)?$' and position(chr(92) in website_url) = 0)
  ),
  add constraint profiles_birth_date_check check (
    birth_date is null or (birth_date >= date '0001-01-01' and birth_date <= current_date)
  );
grant select (website_url, birth_date) on public.profiles to anon, authenticated;
grant update (website_url, birth_date) on public.profiles to authenticated;
comment on column public.profiles.website_url is 'Optional public profile website (HTTP/HTTPS).';
comment on column public.profiles.birth_date is 'Optional public birthday stored as a calendar date.';
notify pgrst, 'reload schema';
commit;
