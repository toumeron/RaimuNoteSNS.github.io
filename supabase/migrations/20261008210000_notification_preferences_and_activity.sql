begin;
-- Extend the existing public event store, private settings and subscriptions.
alter table public.profile_private_settings add column notification_preferences jsonb not null default '{}'::jsonb
  check (jsonb_typeof(notification_preferences)='object');
alter table public.notifications alter column actor_id drop not null;
alter table public.notifications add column actor_username text, add column actor_is_official boolean not null default false,
 add column comment_id uuid references public.comments(id) on delete cascade,
 add column image_urls text[] not null default '{}', add column emoji text,
 add column external_post_id text, add column event_key text;
create unique index notifications_event_key_unique on public.notifications(user_id,event_key) where event_key is not null;
alter table public.post_notification_subscriptions alter column target_user_id drop not null;
alter table public.post_notification_subscriptions add column provider text not null default 'limenote',
 add column external_actor text, add column target_name text, add column target_avatar_url text,
 add column external_cursor jsonb, add column last_checked_at timestamptz;
alter table public.post_notification_subscriptions add constraint subscription_target_valid check (
 (provider='limenote' and target_user_id is not null and external_actor is null) or
 (provider in ('bluesky','misskey') and target_user_id is null and external_actor is not null and length(external_actor) between 1 and 300));
create unique index notification_external_target_unique on public.post_notification_subscriptions(subscriber_id,provider,external_actor) where provider<>'limenote';
-- Cursor is maintained by the server, never by the subscribing client.
create function public.guard_notification_subscription() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated') then
  NEW.external_cursor:=null;NEW.last_checked_at:=null;NEW.created_at:=now();
 end if;return NEW;
end $$;
create trigger guard_notification_subscription before insert on public.post_notification_subscriptions for each row execute function public.guard_notification_subscription();
create function public.set_notification_preference(kind text,enabled boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if kind not in ('new_post','mention','reply','like','repost','reaction','follow','push') or enabled is null then raise exception 'Invalid preference';end if;
 insert into public.profile_private_settings(user_id,notification_preferences) values(auth.uid(),jsonb_build_object(kind,enabled))
 on conflict(user_id) do update set notification_preferences=public.profile_private_settings.notification_preferences||excluded.notification_preferences;
end $$;
revoke all on function public.set_notification_preference(text,boolean) from public;
grant execute on function public.set_notification_preference(text,boolean) to authenticated;
create function public.notification_enabled(recipient uuid,kind text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select notification_preferences->kind <> 'false'::jsonb from public.profile_private_settings where user_id=recipient),true)
$$;
revoke all on function public.notification_enabled(uuid,text) from public;
-- One trusted entry point for activity triggers; self notifications are omitted.
create function public.create_activity_notification(recipient uuid,actor uuid,kind text,post uuid default null,comment uuid default null,reaction text default null,event text default null) returns void
language plpgsql security definer set search_path='' as $$ declare profile public.profiles;preview text;images text[];begin
 if recipient is null or actor is null or recipient=actor or not public.notification_enabled(recipient,kind) then return;end if;
 select * into profile from public.profiles where id=actor;
 if not found then return;end if;
 if comment is not null then select left(content,160),image_urls into preview,images from public.comments where id=comment;
 elsif post is not null then select left(content,160),image_urls into preview,images from public.posts where id=post;end if;
 insert into public.notifications(user_id,actor_id,type,post_id,comment_id,actor_name,actor_username,actor_avatar_url,actor_is_official,content_preview,image_urls,emoji,event_key,is_read)
 values(recipient,actor,kind,post,comment,coalesce(nullif(profile.display_name,''),profile.username),profile.username,profile.avatar_url,coalesce(profile.is_official,false),preview,coalesce(images,'{}'),reaction,event,false)
 on conflict(user_id,event_key) where event_key is not null do nothing;
end $$;
revoke all on function public.create_activity_notification(uuid,uuid,text,uuid,uuid,text,text) from public;
create or replace function public.create_mention_notification() returns trigger language plpgsql security definer set search_path='' as $$ declare actor uuid;begin
 select user_id into actor from public.posts where id=NEW.post_id;
 perform public.create_activity_notification(NEW.mentioned_user_id,actor,'mention',NEW.post_id,null,null,'mention:'||NEW.id);return NEW;
end $$;
create or replace function public.notify_post_subscribers() returns trigger language plpgsql security definer set search_path='' as $$ declare subscriber record;begin
 if coalesce(NEW.visibility,'public')<>'public' then return NEW;end if;
 for subscriber in select subscriber_id from public.post_notification_subscriptions where provider='limenote' and target_user_id=NEW.user_id loop
 perform public.create_activity_notification(subscriber.subscriber_id,NEW.user_id,'new_post',NEW.id,null,null,'new_post:'||NEW.id);end loop;return NEW;
end $$;
create function public.notify_account_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;post uuid;comment uuid;actor uuid;kind text;reaction text;event text;row_data jsonb:=to_jsonb(NEW);begin
 actor:=coalesce((row_data->>'user_id')::uuid,(row_data->>'follower_id')::uuid);
 if TG_TABLE_NAME='follows' then recipient:=NEW.followee_id;kind:='follow';event:='follow:'||actor||':'||recipient;
 elsif TG_TABLE_NAME='comments' then
  post:=NEW.post_id;comment:=NEW.id;kind:='reply';
  if NEW.parent_comment_id is not null then select user_id into recipient from public.comments where id=NEW.parent_comment_id;
  else select user_id into recipient from public.posts where id=post;end if;
  event:='reply:'||comment;
 else
  if row_data->>'comment_id' is not null then
   comment:=(row_data->>'comment_id')::uuid;select user_id,post_id into recipient,post from public.comments where id=comment;
  else post:=(row_data->>'post_id')::uuid;select user_id into recipient from public.posts where id=post;end if;
  kind:=case when TG_TABLE_NAME in ('likes','comment_likes') then 'like' when TG_TABLE_NAME in ('reposts','reply_reposts') then 'repost' else 'reaction' end;
  reaction:=row_data->>'emoji';event:=TG_TABLE_NAME||':'||actor||':'||coalesce(comment,post)||':'||coalesce(reaction,'');
 end if;
 perform public.create_activity_notification(recipient,actor,kind,post,comment,reaction,event);return NEW;
end $$;
revoke all on function public.notify_account_activity() from public;
do $$ declare relation text;begin
 foreach relation in array array['comments','likes','comment_likes','reposts','reply_reposts','post_reactions','comment_reactions','follows'] loop
 execute format('create trigger notify_account_activity after insert on public.%I for each row execute function public.notify_account_activity()',relation);end loop;
end $$;
-- Existing owner RLS still applies; read state is the only writable notification field.
revoke update on public.notifications from authenticated;
grant update(is_read) on public.notifications to authenticated;
revoke update on public.post_notification_subscriptions from authenticated;
-- Worker writes only to an existing subscription and only once per source post.
create function public.record_external_post_notifications(subscription uuid,events jsonb,cursor jsonb) returns integer
language plpgsql security definer set search_path='' as $$ declare target public.post_notification_subscriptions;event jsonb;inserted integer:=0;affected integer;begin
 select * into target from public.post_notification_subscriptions where id=subscription and provider<>'limenote' for update;
 if not found then return 0;end if;
 if jsonb_typeof(events)<>'array' or jsonb_array_length(events)>1000 then raise exception 'Invalid events';end if;
 for event in select * from jsonb_array_elements(events) loop
  if (event->>'created_at')::timestamptz<target.created_at then continue;end if;
  if public.notification_enabled(target.subscriber_id,'new_post') then
   insert into public.notifications(user_id,actor_id,type,external_post_id,actor_name,actor_username,actor_avatar_url,content_preview,image_urls,event_key,is_read)
   values(target.subscriber_id,null,'new_post',event->>'id',coalesce(event->>'name',target.target_name,target.external_actor),target.external_actor,
    event->>'avatar',left(event->>'content',160),array(select jsonb_array_elements_text(coalesce(event->'images','[]'))),
    target.provider||':'||target.external_actor||':'||(event->>'id'),false)
   on conflict(user_id,event_key) where event_key is not null do nothing;
   get diagnostics affected=row_count;inserted:=inserted+affected;
  end if;
 end loop;
 update public.post_notification_subscriptions set external_cursor=cursor,last_checked_at=now() where id=subscription;
 return inserted;
end $$;
revoke all on function public.record_external_post_notifications(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_external_post_notifications(uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
