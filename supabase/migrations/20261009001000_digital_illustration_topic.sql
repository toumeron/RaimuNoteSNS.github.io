begin;
alter table public.profile_private_settings drop constraint known_followed_topics, drop constraint known_dismissed_topics;
alter table public.profile_private_settings add constraint known_followed_topics check (followed_topics <@ array['economy','politics','sports','business','science','technology','ai','art','digital-illustration','film','games','crypto','travel','anime','food','career','pets','music','design','fashion','memes','fitness']::text[] and array_position(followed_topics,null) is null), add constraint known_dismissed_topics check (dismissed_topics <@ array['economy','politics','sports','business','science','technology','ai','art','digital-illustration','film','games','crypto','travel','anime','food','career','pets','music','design','fashion','memes','fitness']::text[] and array_position(dismissed_topics,null) is null);
create or replace function public.update_topic_preferences(topic_ids text[],disposition text) returns void
language plpgsql security definer set search_path='' as $$
declare allowed constant text[]:=array['economy','politics','sports','business','science','technology','ai','art','digital-illustration','film','games','crypto','travel','anime','food','career','pets','music','design','fashion','memes','fitness'];
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if topic_ids is null or cardinality(topic_ids) not between 1 and 22 or array_ndims(topic_ids)<>1
  or not topic_ids <@ allowed or array_position(topic_ids,null) is not null
  or disposition is null or disposition not in ('follow','dismiss','clear') then
  raise exception 'Invalid topic preferences' using errcode='22023';
 end if;
 insert into public.profile_private_settings(user_id) values(auth.uid()) on conflict do nothing;
 -- One row update serializes concurrent devices and preserves other preferences.
 update public.profile_private_settings set
  followed_topics=array(select distinct t from unnest(followed_topics || case when disposition='follow' then topic_ids else '{}'::text[] end) t where disposition='follow' or not t=any(topic_ids) order by t),
  dismissed_topics=array(select distinct t from unnest(dismissed_topics || case when disposition='dismiss' then topic_ids else '{}'::text[] end) t where disposition='dismiss' or not t=any(topic_ids) order by t)
 where user_id=auth.uid();
end;
$$;
notify pgrst,'reload schema';
commit;
