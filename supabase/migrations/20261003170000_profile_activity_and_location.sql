begin;

alter table public.profiles add column if not exists location text not null default '';
alter table public.profiles add constraint profiles_location_length check (char_length(location) <= 100);

-- Publish only the aggregate. Existing audience policies still protect bodies,
-- attachments, and individual repost/reply rows.
create or replace function public.get_profile_activity_count(target_user_id uuid)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select sum(activity_count)::bigint from (
    select count(*) as activity_count from public.posts where user_id = target_user_id
    union all select count(*) from public.comments where user_id = target_user_id
    union all select count(*) from public.reposts where user_id = target_user_id
    union all select count(*) from public.reply_reposts where user_id = target_user_id
    union all select count(*) from public.external_reposts where user_id = target_user_id
  ) activity;
$$;
revoke all on function public.get_profile_activity_count(uuid) from public;
grant execute on function public.get_profile_activity_count(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
