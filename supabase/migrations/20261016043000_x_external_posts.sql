-- Reuse external snapshots and follows; retain all owner/privacy checks.
begin;
alter table public.follows drop constraint follows_target_check;
alter table public.follows add constraint follows_target_check check (
 (followee_id is not null and external_provider is null and external_handle is null and external_profile is null) or
 (followee_id is null and external_provider in ('bluesky','misskey','x') and external_handle is not null and length(external_handle) between 1 and 253 and external_handle !~ '[[:space:]/]' and external_handle=lower(external_handle) and (external_provider<>'x' or external_handle ~ '^[a-z0-9_]{1,15}$') and (external_profile is null or (jsonb_typeof(external_profile)='object' and octet_length(external_profile::text)<32768)))
);
alter table public.bookmarks drop constraint bookmark_public_external;
alter table public.bookmarks add constraint bookmark_public_external check (
 (external_id is null and external_snapshot is null) or
 (external_id is not null and
  (external_id like 'bsky:at://%' or external_id ~ '^misskey:https://misskey[.]io/notes/[A-Za-z0-9]+$' or external_id ~ '^x:[0-9]{2,20}$') and
  coalesce(jsonb_typeof(external_snapshot)='object' and external_snapshot->>'id'=external_id and external_snapshot->>'visibility'='public',false))
);
alter table public.external_reposts drop constraint external_reposts_post_id_check;
alter table public.external_reposts add constraint external_reposts_post_id_check check (
 post_id like 'bsky:at://%' or post_id ~ '^misskey:https://misskey[.]io/notes/[A-Za-z0-9]+$' or post_id ~ '^x:[0-9]{2,20}$'
);
alter table public.likes drop constraint likes_target_valid;
alter table public.likes add constraint likes_target_valid check (
 (post_id is not null and external_post_id is null and post_snapshot is null and not external_mirrored) or
 (post_id is null and external_post_id is not null and post_snapshot is not null and length(external_post_id) between 1 and 2048
  and (external_post_id ~ '^bsky:at://did:[a-z0-9:._-]+/app[.]bsky[.]feed[.]post/[A-Za-z0-9._~-]+$' or external_post_id ~ '^misskey:https://misskey[.]io/notes/[A-Za-z0-9]+$' or external_post_id ~ '^x:[0-9]{2,20}$')
  and coalesce(post_snapshot->>'id'=external_post_id and post_snapshot->>'visibility'='public',false)
  and coalesce(jsonb_typeof(post_snapshot->'author')='object',false) and octet_length(post_snapshot::text)<=65536)
);
create or replace function public.set_external_follow(provider text,handle text,enabled boolean,profile jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if provider is null or provider not in ('bluesky','misskey','x') or handle is null or length(handle) not between 1 and 253 or handle ~ '[[:space:]/]' or handle<>lower(handle) or (provider='x' and handle !~ '^[a-z0-9_]{1,15}$') then raise exception 'Invalid external follow';end if;
 if enabled then
  insert into public.follows(follower_id,external_provider,external_handle,external_profile) values(auth.uid(),provider,handle,profile) on conflict(follower_id,follow_key) do nothing;
 else delete from public.follows f where f.follower_id=auth.uid() and f.external_provider=provider and f.external_handle=handle;end if;
end $$;
notify pgrst,'reload schema';
commit;
