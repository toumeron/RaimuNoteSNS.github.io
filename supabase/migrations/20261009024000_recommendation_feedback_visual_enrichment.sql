-- Extend the existing private feedback RPC. No new tables or scheduled jobs.
create or replace function public.dismiss_recommendation(feedback jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if feedback is null or jsonb_typeof(feedback)<>'object' or coalesce(length(feedback->>'id'),0) not between 1 and 2048 or coalesce(length(feedback->>'userId'),0) not between 1 and 512 or octet_length(feedback::text)>16384 then raise exception 'Invalid feedback' using errcode='22023';end if;
 if feedback->>'enrichment'='true' then
  if coalesce(jsonb_typeof(feedback->'vector'),'')<>'array' or jsonb_array_length(feedback->'vector')<>512 or exists(select 1 from jsonb_array_elements(feedback->'vector') v where jsonb_typeof(v)<>'number') then raise exception 'Invalid visual vector' using errcode='22023';end if;
  update public.profile_private_settings set recommendation_feedback=(
   select jsonb_agg(case when v->>'id'=feedback->>'id' and v->>'userId'=feedback->>'userId' then v||jsonb_build_object('vector',feedback->'vector','visualKind',feedback->'visualKind','imageUrls',feedback->'imageUrls') else v end order by ordinal)
   from jsonb_array_elements(recommendation_feedback) with ordinality a(v,ordinal)
  ) where user_id=auth.uid() and exists(select 1 from jsonb_array_elements(recommendation_feedback) v where v->>'id'=feedback->>'id' and v->>'userId'=feedback->>'userId');
  return;
 end if;
 insert into public.profile_private_settings(user_id) values(auth.uid()) on conflict do nothing;
 update public.profile_private_settings set recommendation_feedback=(
  select jsonb_agg(v order by ordinal) from (select v,ordinal from jsonb_array_elements(jsonb_build_array((feedback-'enrichment')||jsonb_build_object('createdAt',now()))||recommendation_feedback) with ordinality a(v,ordinal) where ordinal=1 or v->>'id'<>feedback->>'id' order by ordinal limit 200) recent
 ) where user_id=auth.uid();
end $$;
