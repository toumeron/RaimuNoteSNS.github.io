-- Keep community content out of legacy timeline/trend views and subscriber notifications.
begin;
set local lock_timeout='5s';
create or replace view public.latest_30_ids with(security_invoker=true) as
 select id from public.posts where community_id is null order by created_at desc limit 30;
create or replace view public.timeline_posts with(security_invoker=true) as
 select id,user_id,content,image_urls,created_at,likes_count,client_name,parent_id,is_quote,reposts_count
 from public.posts where community_id is null order by created_at desc limit 30;
create or replace view public.trending_hashtags with(security_invoker=true) as
 select h.tag,count(*)::integer as posts_24h
 from public.post_hashtags ph join public.hashtags h on h.id=ph.hashtag_id
 join public.posts p on p.id=ph.post_id
 where ph.created_at>now()-interval '24 hours' and p.community_id is null and p.visibility='public'
 group by h.tag order by count(*)::integer desc limit 20;
CREATE OR REPLACE FUNCTION public.notify_post_subscribers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare subscriber record;begin
 if NEW.community_id is not null or coalesce(NEW.visibility,'public')<>'public' then return NEW;end if;
 for subscriber in select subscriber_id from public.post_notification_subscriptions where provider='limenote' and target_user_id=NEW.user_id loop
 perform public.create_activity_notification(subscriber.subscriber_id,NEW.user_id,'new_post',NEW.id,null,null,'new_post:'||NEW.id);end loop;return NEW;
end $function$
;
create function public.guard_community_quote_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_community uuid;
begin
 if new.parent_id is not null then
  select community_id into source_community from public.posts where id=new.parent_id;
  if source_community is not null and source_community is distinct from new.community_id then
   raise exception 'コミュニティのポストは同じコミュニティ内で引用してください' using errcode='42501';
  end if;
 end if;
 if new.quoted_reply_id is not null then
  select p.community_id into source_community from public.comments c join public.posts p on p.id=c.post_id where c.id=new.quoted_reply_id;
  if source_community is not null and source_community is distinct from new.community_id then
   raise exception 'コミュニティの返信は同じコミュニティ内で引用してください' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_community_quote_scope() from public,anon,authenticated;
create trigger guard_community_quote_scope before insert or update of parent_id,quoted_reply_id,community_id
 on public.posts for each row execute function public.guard_community_quote_scope();
notify pgrst,'reload schema';
commit;
