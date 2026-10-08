-- External snapshots use the same owner/privacy policies for both networks.
alter table public.bookmarks drop constraint bookmark_public_external;
alter table public.bookmarks add constraint bookmark_public_external check (
  (external_id is null and external_snapshot is null) or
  (external_id is not null and
   (external_id like 'bsky:at://%' or external_id ~ '^misskey:https://misskey[.]io/notes/[A-Za-z0-9]+$') and
   coalesce(jsonb_typeof(external_snapshot) = 'object' and
     external_snapshot->>'id' = external_id and external_snapshot->>'visibility' = 'public', false))
);
alter table public.external_reposts drop constraint external_reposts_post_id_check;
alter table public.external_reposts add constraint external_reposts_post_id_check check (
  post_id like 'bsky:at://%' or post_id ~ '^misskey:https://misskey[.]io/notes/[A-Za-z0-9]+$'
);

-- Five hours is a rolling interval, not a cron hour expression that resets at midnight.
-- A lease prevents overlapping GitHub/manual invocations from generating duplicates.
create table public.news_generation_state (
  source text primary key check (source in ('limenote','bluesky')),
  last_completed_at timestamptz,
  last_attempted_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  last_error text
);
alter table public.news_generation_state enable row level security;
revoke all on public.news_generation_state from anon, authenticated;
grant all on public.news_generation_state to service_role;

create function public.claim_news_generation(p_source text, p_scheduled boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  claimed uuid;
begin
  if p_source not in ('limenote','bluesky') then
    raise exception 'Unknown news source';
  end if;
  insert into public.news_generation_state(source,last_completed_at)
  select p_source,max(created_at) from public.news_summaries
  where source=p_source and public_sources_verified=true
  on conflict(source) do nothing;
  update public.news_generation_state
  set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
      last_attempted_at=now(),last_error=null
  where source=p_source and (lease_until is null or lease_until<now()) and
    (not p_scheduled or last_completed_at is null or last_completed_at<=now()-interval '5 hours')
  returning lease_token into claimed;
  return claimed;
end;
$$;
revoke all on function public.claim_news_generation(text,boolean) from public,anon,authenticated;
grant execute on function public.claim_news_generation(text,boolean) to service_role;
notify pgrst,'reload schema';
