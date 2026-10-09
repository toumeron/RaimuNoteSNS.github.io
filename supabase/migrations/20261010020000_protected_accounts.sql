begin;
alter table public.profiles add column is_private boolean not null default false;
-- Pending requests share the existing relationship store; old followers stay accepted.
alter table public.follows add column approved boolean not null default true;
create index follows_pending_requests_idx on public.follows(followee_id,created_at) where not approved;

create function public.can_view_account_activity(account_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=account_id and
 (not p.is_private or p.id=auth.uid() or exists(select 1 from public.follows f
 where f.follower_id=auth.uid() and f.followee_id=p.id and f.approved)));
$$;
revoke all on function public.can_view_account_activity(uuid) from public;
grant execute on function public.can_view_account_activity(uuid) to anon,authenticated;

create policy protected_posts on public.posts as restrictive for select to anon,authenticated
 using(public.can_view_account_activity(user_id));
create policy protected_follows on public.follows as restrictive for select to anon,authenticated
 using(approved and (follower_id=auth.uid() or followee_id=auth.uid() or
 (public.can_view_account_activity(follower_id) and
 (followee_id is null or public.can_view_account_activity(followee_id)))));
do $$declare t text;begin
 foreach t in array array['comments','likes','post_reactions','reposts','reply_reposts','external_reposts','comment_likes','comment_reactions','profile_pins','profile_highlights'] loop
  -- profile_pins is optional and confirmed absent on the linked deployment.
  -- Never skip a missing core activity table: those must fail the transaction.
  if t='profile_pins' and to_regclass('public.profile_pins') is null then continue;end if;
  execute format('create policy protected_activity on public.%I as restrictive for select to anon,authenticated using(public.can_view_account_activity(user_id))',t);
 end loop;
end$$;
-- Guard the new flag even on databases with legacy broad update policies.
create function public.guard_account_privacy() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') and new.id is distinct from auth.uid()
 and (tg_op='INSERT' or new.is_private is distinct from old.is_private) then
  raise exception 'Only the account owner can change protection' using errcode='42501';
 end if;
 return new;
end$$;
revoke all on function public.guard_account_privacy() from public,anon,authenticated;
create trigger guard_account_privacy before insert or update on public.profiles
 for each row execute function public.guard_account_privacy();
create policy protected_follow_delete on public.follows as restrictive for delete to anon,authenticated using(follower_id=auth.uid());
create policy protected_follow_update on public.follows as restrictive for update to anon,authenticated using(follower_id=auth.uid()) with check(follower_id=auth.uid());

-- Request approval cannot be forged using direct inserts/updates through REST.
create function public.guard_protected_follow() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') then
  if new.follower_id is distinct from auth.uid() then raise exception 'Invalid follower' using errcode='42501';end if;
  if not new.approved or (tg_op='UPDATE' and (new.approved is distinct from old.approved or new.followee_id is distinct from old.followee_id)) then
   raise exception 'Use follow request actions' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=new.followee_id and is_private) then
   raise exception 'Follow approval required' using errcode='42501';
  end if;
 end if;
 return new;
end$$;
create trigger guard_protected_follow before insert or update on public.follows for each row execute function public.guard_protected_follow();

create function public.get_account_follow_state(target_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('followed',exists(select 1 from public.follows where follower_id=auth.uid() and followee_id=target_user_id and approved),
 'requested',exists(select 1 from public.follows where follower_id=auth.uid() and followee_id=target_user_id and not approved),
 'canView',public.can_view_account_activity(target_user_id));
$$;
create function public.toggle_account_follow(target_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare private_account boolean;begin
 if auth.uid() is null or auth.uid()=target_user_id then raise exception 'Invalid follow' using errcode='42501';end if;
 select is_private into private_account from public.profiles where id=target_user_id for update;
 if not found then raise exception 'Account not found';end if;
 delete from public.follows where follower_id=auth.uid() and followee_id=target_user_id;
 if not found then insert into public.follows(follower_id,followee_id,approved) values(auth.uid(),target_user_id,not private_account);end if;
 return public.get_account_follow_state(target_user_id);
end$$;
create function public.get_account_follow_requests() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',p.display_name,'avatarUrl',p.avatar_url,'isPrivate',p.is_private,'isOfficial',p.is_official,'createdAt',f.created_at) order by f.created_at),'[]'::jsonb)
 from public.follows f join public.profiles p on p.id=f.follower_id where f.followee_id=auth.uid() and not f.approved;
$$;
create function public.respond_account_follow_request(requester_id uuid,accept_request boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if accept_request then update public.follows set approved=true where follower_id=requester_id and followee_id=auth.uid() and not approved;
 else delete from public.follows where follower_id=requester_id and followee_id=auth.uid() and not approved;end if;
end$$;
revoke all on function public.get_account_follow_state(uuid),public.toggle_account_follow(uuid),public.get_account_follow_requests(),public.respond_account_follow_request(uuid,boolean) from public;
grant execute on function public.get_account_follow_state(uuid) to anon,authenticated;
grant execute on function public.toggle_account_follow(uuid),public.get_account_follow_requests(),public.respond_account_follow_request(uuid,boolean) to authenticated;

-- Pending requests must not emit a misleading "followed you" notification.
drop trigger notify_account_activity on public.follows;
create trigger notify_account_activity after insert on public.follows for each row
 when(new.followee_id is not null and new.approved) execute function public.notify_account_activity();
create policy protected_notification_actor on public.notifications as restrictive for select to anon,authenticated
 using(actor_id is null or public.can_view_account_activity(actor_id));

create or replace function public.can_view_post_audience(post_author uuid,post_visibility text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.can_view_account_activity(post_author) and (
 coalesce(post_visibility,'public')='public' or post_author=auth.uid()
 or (post_visibility='following' and exists(select 1 from public.follows f where f.follower_id=post_author and f.followee_id=auth.uid() and f.approved))
 or (post_visibility='members' and exists(select 1 from public.memberships m where m.creator_id=post_author and m.member_id=auth.uid())));
$$;

-- Cached news must disappear when any native source account becomes protected.
create or replace function public.news_sources_are_public(news_source text,ids text[]) returns boolean
language sql stable security definer set search_path='' as $$
 select cardinality(ids) between 1 and 10 and case when news_source='bluesky'
 then not exists(select 1 from unnest(ids) refs(post_id) where refs.post_id not like 'bsky:at://%')
 else not exists(select 1 from unnest(ids) refs(post_id) where not exists(
 select 1 from public.posts p join public.profiles a on a.id=p.user_id
 where p.id::text=refs.post_id and p.visibility='public' and not a.is_private)) end;
$$;

-- Server-managed aggregates must not expose activity hidden by the new RLS.
alter function public.get_profile_activity_count(uuid) rename to get_profile_activity_count_unprotected;
revoke all on function public.get_profile_activity_count_unprotected(uuid) from public,anon,authenticated;
create function public.get_profile_activity_count(target_user_id uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select case when public.can_view_account_activity(target_user_id) then public.get_profile_activity_count_unprotected(target_user_id) else null end;
$$;
grant execute on function public.get_profile_activity_count(uuid) to anon,authenticated;
-- account_reviews remain publicly readable through their existing RPC, intentionally.
-- Turning protection off accepts outstanding requests, like a public account.
create function public.accept_requests_on_public_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.is_private and not new.is_private then
  update public.follows set approved=true where followee_id=new.id and not approved;
 end if;
 return new;
end$$;
revoke all on function public.accept_requests_on_public_account(),public.guard_protected_follow() from public,anon,authenticated;
create trigger accept_requests_on_public_account after update of is_private on public.profiles
 for each row execute function public.accept_requests_on_public_account();

create or replace function public.get_account_reviews(target_profile uuid, page_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if page_offset<0 then raise exception 'Invalid offset'; end if;
  if not exists(select 1 from public.profiles where id=target_profile and review) then
    return jsonb_build_object('enabled',false,'total',0,'average',0,'distribution','{}'::jsonb,'reviews','[]'::jsonb);
  end if;
  select jsonb_build_object('enabled',true,'total',count(*),'average',coalesce(round(avg(rating),1),0),
    'distribution',jsonb_build_object('5',count(*) filter(where rating=5),'4',count(*) filter(where rating=4),
      '3',count(*) filter(where rating=3),'2',count(*) filter(where rating=2),'1',count(*) filter(where rating=1)))
  into result from public.account_reviews where profile_id=target_profile;
  return result || jsonb_build_object('reviews',coalesce((
    select jsonb_agg(row_data order by created_at desc,id desc) from (
      select r.id,r.created_at,jsonb_build_object('id',r.id,'author_id',r.author_id,'rating',r.rating,'title',r.title,
        'content',r.content,'created_at',r.created_at,'likes_count',cardinality(r.liked_by),
        'liked_by_me',coalesce(auth.uid()=any(r.liked_by),false),'author',jsonb_build_object(
          'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'is_official',p.is_official,'is_private',p.is_private)) row_data
      from public.account_reviews r join public.profiles p on p.id=r.author_id
      where r.profile_id=target_profile order by r.created_at desc,r.id desc limit 50 offset page_offset
    ) rows
  ),'[]'::jsonb));
end $$;

notify pgrst,'reload schema';
commit;
