begin;
alter table public.notifications add column conversation_id uuid references public.direct_conversations(id) on delete cascade, add column direct_message_id uuid references public.direct_messages(id) on delete cascade;
create index notifications_direct_conversation_idx on public.notifications(user_id,conversation_id) where conversation_id is not null;
create or replace function public.set_notification_preference(kind text,enabled boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 if kind not in ('new_post','mention','reply','like','repost','reaction','follow','dm','dm_request','push') or enabled is null then raise exception 'Invalid preference';end if;
 insert into public.profile_private_settings(user_id,notification_preferences) values(auth.uid(),jsonb_build_object(kind,enabled)) on conflict(user_id) do update set notification_preferences=public.profile_private_settings.notification_preferences||excluded.notification_preferences;
end$$;
create function public.notify_direct_message() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;actor public.profiles;recipient uuid;kind text;
begin
 select * into c from public.direct_conversations where id=NEW.conversation_id;
 if c.status='declined' or NEW.sender_id not in(c.user_low,c.user_high) then return NEW;end if;
 recipient:=case when NEW.sender_id=c.user_low then c.user_high else c.user_low end;
 kind:=case when c.status='pending' then 'dm_request' else 'dm' end;
 if not public.notification_enabled(recipient,kind) then return NEW;end if;
 select * into actor from public.profiles where id=NEW.sender_id;
 insert into public.notifications(user_id,actor_id,type,actor_name,actor_username,actor_avatar_url,actor_is_official,content_preview,event_key,is_read,conversation_id,direct_message_id)
 values(recipient,NEW.sender_id,kind,coalesce(nullif(actor.display_name,''),actor.username),actor.username,actor.avatar_url,coalesce(actor.is_official,false),case when length(trim(NEW.content))>0 then left(NEW.content,160) else '画像を送信しました' end,'direct:'||NEW.id,false,c.id,NEW.id)
 on conflict(user_id,event_key) where event_key is not null do nothing;
 return NEW;
end$$;
revoke all on function public.notify_direct_message() from public,anon,authenticated;
create trigger direct_message_notification after insert on public.direct_messages for each row execute function public.notify_direct_message();
-- The existing notifications INSERT webhook delivers Web Push, including while the app is closed.
create function public.read_direct_notifications() returns trigger language plpgsql security definer set search_path='' as $$ begin
 update public.notifications n set is_read=true from public.direct_messages m where n.conversation_id=NEW.id and n.direct_message_id=m.id and not n.is_read and (
 NEW.status='declined' or (n.user_id=NEW.user_low and m.created_at<=greatest(NEW.read_low,NEW.deleted_low)) or (n.user_id=NEW.user_high and m.created_at<=greatest(NEW.read_high,NEW.deleted_high)));
 return NEW;
end$$;
revoke all on function public.read_direct_notifications() from public,anon,authenticated;
create trigger direct_notifications_read after update of read_low,read_high,deleted_low,deleted_high,status on public.direct_conversations for each row execute function public.read_direct_notifications();
notify pgrst,'reload schema';
commit;
