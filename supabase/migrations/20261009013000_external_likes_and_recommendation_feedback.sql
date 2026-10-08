-- External and native likes share the existing relation. Keep the native
-- (post_id,user_id) unique constraint and FK for existing upsert clients.
alter table public.likes
 add column external_post_id text,
 add column post_snapshot jsonb,
 add column external_mirrored boolean not null default false,
 add column like_key text generated always as (coalesce(post_id::text,external_post_id)) stored;
alter table public.likes drop constraint likes_pkey;
alter table public.likes alter column post_id drop not null;
alter table public.likes add primary key(like_key,user_id);
-- Some installations originally relied only on the old primary key.
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.likes'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (post_id, user_id)') then
  alter table public.likes add constraint likes_post_id_user_id_key unique(post_id,user_id);
 end if;
end$$;
alter table public.likes add constraint likes_target_valid check (
 (post_id is not null and external_post_id is null and post_snapshot is null and not external_mirrored)
 or (post_id is null and external_post_id is not null and post_snapshot is not null
  and length(external_post_id) between 1 and 2048
  and (external_post_id ~ '^bsky:at://did:[a-z0-9:._-]+/app[.]bsky[.]feed[.]post/[A-Za-z0-9._~-]+$' or external_post_id ~ '^misskey:https://misskey[.]io/notes/[A-Za-z0-9]+$')
  and coalesce(post_snapshot->>'id'=external_post_id and post_snapshot->>'visibility'='public',false)
  and coalesce(jsonb_typeof(post_snapshot->'author')='object',false)
  and octet_length(post_snapshot::text)<=65536)
);
create index likes_profile_time_idx on public.likes(user_id,created_at desc,like_key);
-- Restore these guards if they exist, extending only the visible external case.
drop policy if exists security_visible_parent on public.likes;
drop policy if exists security_insert_visible_parent on public.likes;
create policy security_visible_parent on public.likes as restrictive for select to anon,authenticated
 using(external_post_id is not null or exists(select 1 from public.posts p where p.id=likes.post_id));
create policy security_insert_visible_parent on public.likes as restrictive for insert to anon,authenticated
 with check(external_post_id is not null or exists(select 1 from public.posts p where p.id=likes.post_id));
create policy external_likes_owner_insert on public.likes as restrictive for insert to authenticated with check(user_id=auth.uid());
create policy external_likes_owner_update on public.likes as restrictive for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy external_likes_owner_delete on public.likes as restrictive for delete to authenticated using(user_id=auth.uid());
-- External authors are not native profile IDs; preserve native notifications.
drop trigger notify_account_activity on public.likes;
create trigger notify_account_activity after insert on public.likes for each row when(new.post_id is not null) execute function public.notify_account_activity();

create function public.external_like_states(post_ids text[]) returns table(post_id text,liked boolean,likes_count bigint,unmirrored_count bigint)
language sql stable security definer set search_path='' as $$
 select targets.id,coalesce(bool_or(l.user_id=auth.uid()),false),count(l.user_id),count(l.user_id) filter(where not l.external_mirrored)
 from (select distinct unnest(post_ids[1:100]) id) targets left join public.likes l on l.external_post_id=targets.id
 group by targets.id;
$$;
revoke all on function public.external_like_states(text[]) from public;
grant execute on function public.external_like_states(text[]) to anon,authenticated;
alter table public.profile_private_settings add column recommendation_feedback jsonb not null default '[]'::jsonb
 check(jsonb_typeof(recommendation_feedback)='array' and jsonb_array_length(recommendation_feedback)<=200 and octet_length(recommendation_feedback::text)<=2097152);
create function public.set_external_like(snapshot jsonb,enabled boolean,mirrored boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target text:=snapshot->>'id'; result jsonb;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if enabled is null or mirrored is null or target is null then raise exception 'Invalid like' using errcode='22023';end if;
 if enabled then
  insert into public.likes(user_id,external_post_id,post_snapshot,external_mirrored)
   values(auth.uid(),target,snapshot,mirrored)
   on conflict(like_key,user_id) do update set post_snapshot=excluded.post_snapshot,external_mirrored=public.likes.external_mirrored or excluded.external_mirrored;
  -- Explicit positive feedback supersedes dismissing this exact post.
  update public.profile_private_settings set recommendation_feedback=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(recommendation_feedback) v where v->>'id'<>target) where user_id=auth.uid();
 else delete from public.likes where external_post_id=target and user_id=auth.uid();end if;
 select jsonb_build_object('liked',s.liked,'count',s.likes_count,'unmirroredCount',s.unmirrored_count) into result from public.external_like_states(array[target]) s;
 return result;
end $$;
revoke all on function public.set_external_like(jsonb,boolean,boolean) from public;
grant execute on function public.set_external_like(jsonb,boolean,boolean) to authenticated;

create function public.dismiss_recommendation(feedback jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if feedback is null or jsonb_typeof(feedback)<>'object' or coalesce(length(feedback->>'id'),0) not between 1 and 2048 or coalesce(length(feedback->>'userId'),0) not between 1 and 512 or octet_length(feedback::text)>16384 then raise exception 'Invalid feedback' using errcode='22023';end if;
 insert into public.profile_private_settings(user_id) values(auth.uid()) on conflict do nothing;
 update public.profile_private_settings set recommendation_feedback=(
  select jsonb_agg(v order by ordinal) from (select v,ordinal from jsonb_array_elements(jsonb_build_array(feedback||jsonb_build_object('createdAt',now()))||recommendation_feedback) with ordinality a(v,ordinal) where ordinal=1 or v->>'id'<>feedback->>'id' order by ordinal limit 200) recent
 ) where user_id=auth.uid();
end $$;
revoke all on function public.dismiss_recommendation(jsonb) from public;
grant execute on function public.dismiss_recommendation(jsonb) to authenticated;
