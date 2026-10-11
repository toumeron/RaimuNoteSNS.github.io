begin;
-- Extend only training observations, never the underlying likes/reposts/bookmarks.
-- Distinguish an unengaged impression (1) from an explicit dismissal (0).
update public.profile_private_settings s set recommendation_training=(
 select coalesce(jsonb_agg(case when event ? 'signals' then event else event ||
  jsonb_build_object('signals',jsonb_build_object('like',event->>'label'='2'),'label',case when event->>'label'='2' then 2 else 1 end) end order by position),'[]'::jsonb)
 from jsonb_array_elements(s.recommendation_training) with ordinality as events(event,position)
) where recommendation_training<>'[]'::jsonb;
create or replace function public.record_recommendation_training(p_event jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old_events jsonb; candidate jsonb; merged jsonb; signals jsonb; action text; active boolean;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_event ? 'viewer' and (p_event->>'viewer') is distinct from actor::text then raise exception 'Account changed' using errcode='42501'; end if;
 if not coalesce(jsonb_typeof(p_event)='object' and p_event ?& array['id','qid','features'],false) then raise exception 'Invalid event'; end if;
 if jsonb_typeof(p_event->'id')<>'string' or jsonb_typeof(p_event->'qid')<>'string' then raise exception 'Invalid event'; end if;
 if jsonb_typeof(p_event)<>'object' or length(p_event->>'id') not between 1 and 512 or (p_event->>'qid') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_event->'features')<>'array' or jsonb_array_length(p_event->'features')<>15 then raise exception 'Invalid event'; end if;
 if p_event->'id'='null'::jsonb or p_event->'qid'='null'::jsonb or p_event->'features'='null'::jsonb then raise exception 'Invalid event'; end if;
 if exists(select 1 from jsonb_array_elements(p_event->'features') n where jsonb_typeof(n)<>'number' or abs(n::text::numeric)>1000) then raise exception 'Invalid features'; end if;
 if p_event ? 'action' then
  if jsonb_typeof(p_event->'action')<>'string' or not coalesce(p_event->>'action' in ('impression','like','repost','bookmark','not_interested'),false) or jsonb_typeof(p_event->'active') is distinct from 'boolean' then raise exception 'Invalid action'; end if;
  action:=p_event->>'action'; active:=(p_event->>'active')::boolean;
 else
  -- Keep older clients compatible: 0 was an impression, 2 was a like.
  if jsonb_typeof(p_event->'label') is distinct from 'number' or not coalesce(p_event->>'label' in ('0','2'),false) then raise exception 'Invalid label'; end if;
  action:=case when p_event->>'label'='2' then 'like' else 'impression' end; active:=true;
 end if;
 insert into public.profile_private_settings(user_id) values(actor) on conflict do nothing;
 select recommendation_training into old_events from public.profile_private_settings where user_id=actor for update;
 select value into candidate from jsonb_array_elements(old_events) where value->>'qid'=p_event->>'qid' and value->>'id'=p_event->>'id' limit 1;
 -- Keep the original feature vector/date and independently retain each action state.
 candidate:=coalesce(candidate,jsonb_build_object('qid',p_event->>'qid','id',p_event->>'id','features',p_event->'features','at',now(),'label',1,'signals','{}'::jsonb));
 signals:=coalesce(candidate->'signals',jsonb_build_object('like',candidate->>'label'='2')) || jsonb_build_object(action,active);
 candidate:=candidate||jsonb_build_object('signals',signals,'label',case
  when signals->>'not_interested'='true' then 0
  when signals->>'bookmark'='true' then 4
  when signals->>'repost'='true' then 3
  when signals->>'like'='true' then 2 else 1 end);
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
notify pgrst,'reload schema';
commit;
