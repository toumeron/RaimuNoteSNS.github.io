begin;
alter table public.profile_private_settings add column if not exists friend_state jsonb not null default '{}'::jsonb;
create or replace function public.sync_private_friends(p_owner uuid,p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); result jsonb; entry record;
begin
 if owner_id is null or owner_id is distinct from p_owner then raise exception 'Authentication required' using errcode='42501'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>2097152 then
  raise exception 'Invalid friend settings' using errcode='22023';
 end if;
 for entry in select key,value from jsonb_each(p_patch) loop
  if entry.key !~ '^(assistants|avatars|settings|memories|session-meta|backgrounds|companion)/.+' or length(entry.key)>512 then
   raise exception 'Invalid setting key' using errcode='22023';
  end if;
  if entry.key ~ '^(avatars|backgrounds)/' and entry.value <> 'null'::jsonb and
   (jsonb_typeof(entry.value)<>'string' or (entry.value #>> '{}') !~ '^(https://res[.]cloudinary[.]com/|$)') then
   raise exception 'Images must use Cloudinary' using errcode='22023';
  end if;
  if entry.key ~ '^assistants/' and entry.value <> 'null'::jsonb and
   (jsonb_typeof(entry.value)<>'object' or
    (coalesce(entry.value->>'coverUrl','') !~ '^(https://res[.]cloudinary[.]com/|$)')) then
   raise exception 'Invalid friend profile' using errcode='22023';
  end if;
 end loop;
 if p_patch='{}'::jsonb then
  select friend_state into result from public.profile_private_settings where user_id=owner_id;
 else
  insert into public.profile_private_settings(user_id,friend_state) values(owner_id,p_patch)
  on conflict(user_id) do update set friend_state=profile_private_settings.friend_state||excluded.friend_state
  returning friend_state into result;
  if octet_length(result::text)>8388608 then raise exception 'Friend settings too large' using errcode='22023'; end if;
 end if;
 return coalesce(result,'{}'::jsonb);
end; $$;
revoke all on function public.sync_private_friends(uuid,jsonb) from public,anon;
grant execute on function public.sync_private_friends(uuid,jsonb) to authenticated;
-- Only the existing owner SELECT policy may deliver private changes.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
  select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='profile_private_settings'
 ) then alter publication supabase_realtime add table public.profile_private_settings; end if;
end $$;
notify pgrst,'reload schema';
commit;
