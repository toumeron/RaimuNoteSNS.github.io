begin;
-- Reuse the per-account private storage. No new application table or public history.
alter table public.profile_private_settings add column recommendation_training jsonb not null default '[]'::jsonb
 check (jsonb_typeof(recommendation_training)='array' and jsonb_array_length(recommendation_training)<=2000);
create function public.record_recommendation_training(p_event jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old_events jsonb; candidate jsonb; merged jsonb;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not coalesce(jsonb_typeof(p_event)='object' and p_event ?& array['id','qid','features','label'],false) then raise exception 'Invalid event'; end if;
 if jsonb_typeof(p_event->'id')<>'string' or jsonb_typeof(p_event->'qid')<>'string' or jsonb_typeof(p_event->'label')<>'number' then raise exception 'Invalid event'; end if;
 if jsonb_typeof(p_event)<>'object' or length(p_event->>'id') not between 1 and 512 or (p_event->>'qid') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_event->'features')<>'array' or jsonb_array_length(p_event->'features')<>15 or (p_event->>'label') not in ('0','2') then raise exception 'Invalid event'; end if;
 if p_event->'id'='null'::jsonb or p_event->'qid'='null'::jsonb or p_event->'features'='null'::jsonb or p_event->'label'='null'::jsonb then raise exception 'Invalid event'; end if;
 if exists(select 1 from jsonb_array_elements(p_event->'features') n where jsonb_typeof(n)<>'number' or abs(n::text::numeric)>1000) then raise exception 'Invalid features'; end if;
 insert into public.profile_private_settings(user_id) values(actor) on conflict do nothing;
 select recommendation_training into old_events from public.profile_private_settings where user_id=actor for update;
 select value into candidate from jsonb_array_elements(old_events) where value->>'qid'=p_event->>'qid' and value->>'id'=p_event->>'id' limit 1;
 -- Keep the feature vector/date as observed, and never downgrade a confirmed like.
 candidate:=coalesce(candidate,jsonb_build_object('qid',p_event->>'qid','id',p_event->>'id','features',p_event->'features','at',now(),'label',0));
 candidate:=candidate||jsonb_build_object('label',greatest((candidate->>'label')::int,(p_event->>'label')::int));
 select coalesce(jsonb_agg(value),'[]'::jsonb) into merged from (
  select candidate as value,now() as at union all
  select value,(value->>'at')::timestamptz from jsonb_array_elements(old_events)
   where (value->>'at')::timestamptz>now()-interval '30 days' and not(value->>'qid'=p_event->>'qid' and value->>'id'=p_event->>'id')
  order by at desc limit 2000
 ) retained;
 update public.profile_private_settings set recommendation_training=merged where user_id=actor;
end;$$;
revoke all on function public.record_recommendation_training(jsonb) from public,anon;
grant execute on function public.record_recommendation_training(jsonb) to authenticated;
-- Private model objects are read and replaced by the service-side function only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('recommendation-models','recommendation-models',false,4194304,array['application/json']) on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
