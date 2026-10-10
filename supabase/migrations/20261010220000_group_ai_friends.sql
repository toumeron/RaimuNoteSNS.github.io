-- Share invited character snapshots in the existing group, not separate user accounts.
alter table public.direct_conversations add column group_friends jsonb not null default '{}';
alter table public.direct_messages add column friend_id text,add column friend_name text,add column friend_avatar text,add column reply_to uuid references public.direct_messages(id);
create unique index dm_friend_reply_once on public.direct_messages(reply_to,friend_id) where friend_id is not null;
alter function public.dm_group_summary(public.direct_conversations) rename to dm_group_summary_without_friends;
create function public.dm_group_summary(c public.direct_conversations) returns jsonb language sql stable security definer set search_path='' as $$
 select public.dm_group_summary_without_friends(c)||jsonb_build_object('friends',(select coalesce(jsonb_agg(jsonb_build_object('id',key,'displayName',value->>'name','avatarUrl',value->>'avatar','username','フレンド','createdAt','','ownerId',value->>'owner')),'[]') from jsonb_each(c.group_friends)));
$$;
create function public.dm_add_group_friends(c public.direct_conversations,friends jsonb,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb:=c.group_friends;f jsonb;k text;begin
 if jsonb_typeof(friends)<>'array' or jsonb_array_length(friends)>5 then raise exception 'フレンドは5人まで追加できます';end if;
 for f in select value from jsonb_array_elements(friends) loop
  if coalesce(length(f->>'id'),0) not between 1 and 100 or coalesce(length(trim(f->>'name')),0) not between 1 and 100 or coalesce(length(f->>'prompt'),0)>2000 or coalesce(length(f->>'avatar'),0)>250000 then raise exception 'Invalid friend';end if;
  if coalesce(f->>'avatar','')<>'' and f->>'avatar' not like 'https://res.cloudinary.com/%' and f->>'avatar' !~ '^data:image/(svg\+xml|png|jpeg|webp)[;,]' then raise exception 'Invalid avatar';end if;
  k:=actor::text||':'||(f->>'id');
  result:=result||jsonb_build_object(k,jsonb_build_object('name',trim(f->>'name'),'avatar',coalesce(f->>'avatar',''),'prompt',coalesce(f->>'prompt',''),'owner',actor));
 end loop;
 if (select count(*) from jsonb_each(result))>5 then raise exception 'フレンドは5人まで追加できます';end if;return result;
end$$;
create function public.create_group_with_friends(people uuid[],friends jsonb,name text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;actor uuid:=auth.uid();begin
 if actor is null then raise exception 'Login required' using errcode='42501';end if;
 if length(name)>100 then raise exception 'Invalid name';end if;
 c.is_group:=true;c.group_friends:='{}';c.group_members:=jsonb_build_object(actor,jsonb_build_object('status','accepted','admin',true,'joinedAt',clock_timestamp()));
 c.group_members:=public.dm_group_add(c,people,actor);c.group_friends:=public.dm_add_group_friends(c,friends,actor);
 if (select count(*) from jsonb_each(c.group_members))+(select count(*) from jsonb_each(c.group_friends))<3 then raise exception '2人以上の参加者を選択してください';end if;
 insert into public.direct_conversations(is_group,initiated_by,status,group_members,group_friends,group_name) values(true,actor,'accepted',c.group_members,c.group_friends,coalesce(nullif(trim(name),''),(select string_agg(value->>'name','さんと')||'さん' from jsonb_each(c.group_friends)))) returning * into c;
 insert into public.direct_messages(conversation_id,sender_id,content,system_event) values(c.id,actor,'グループを作成しました','group_created');return c.id;
end$$;
create function public.add_group_ai_friends(target uuid,friends jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;begin
 select * into c from public.direct_conversations where id=target for update;
 if not public.dm_group_member(c,auth.uid()) or (c.admin_only and not coalesce((c.group_members->auth.uid()::text->>'admin')::boolean,false)) then raise exception '管理者のみ追加できます' using errcode='42501';end if;
 update public.direct_conversations set group_friends=public.dm_add_group_friends(c,friends,auth.uid()),updated_at=clock_timestamp() where id=target;
end$$;
create function public.remove_group_ai_friend(target uuid,friend text) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;begin
 select * into c from public.direct_conversations where id=target for update;
 if not public.dm_group_member(c,auth.uid()) or not coalesce((c.group_members->auth.uid()::text->>'admin')::boolean,false) then raise exception '管理者のみ削除できます' using errcode='42501';end if;
 update public.direct_conversations set group_friends=group_friends-friend,updated_at=clock_timestamp() where id=target;
end$$;
-- Generated replies are written only by the authenticated Edge handler, never by clients.
create function public.save_group_friend_reply(target uuid,actor uuid,trigger_message uuid,friend text,body text) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;m public.direct_messages;f jsonb;begin
 select * into c from public.direct_conversations where id=target for update;f:=c.group_friends->friend;
 select * into m from public.direct_messages where id=trigger_message and conversation_id=target and sender_id=actor and friend_id is null and system_event is null;
 if not public.dm_group_member(c,actor) or m.id is null or f is null or not public.dm_can_actor_view_group_message(c,actor,m.created_at) or (m.expires_at is not null and m.expires_at<=clock_timestamp()) then raise exception 'Not permitted' using errcode='42501';end if;
 if length(trim(body))=0 or length(body)>4000 then raise exception 'Invalid reply';end if;
 insert into public.direct_messages(conversation_id,sender_id,content,friend_id,friend_name,friend_avatar,reply_to,expires_at) values(target,actor,body,friend,f->>'name',f->>'avatar',trigger_message,case when c.disappearing_seconds>0 then clock_timestamp()+c.disappearing_seconds*interval '1 second' end) on conflict(reply_to,friend_id) where friend_id is not null do nothing;
 update public.direct_conversations set updated_at=clock_timestamp() where id=target;
end$$;
create function public.dm_can_actor_view_group_message(c public.direct_conversations,actor uuid,t timestamptz) returns boolean language sql stable set search_path='' as $$select t>=coalesce((c.group_members->actor::text->>'joinedAt')::timestamptz,'infinity') and t>coalesce((c.group_members->actor::text->>'deletedAt')::timestamptz,'-infinity')$$;
revoke all on function public.dm_group_summary(public.direct_conversations),public.dm_group_summary_without_friends(public.direct_conversations),public.dm_add_group_friends(public.direct_conversations,jsonb,uuid),public.dm_can_actor_view_group_message(public.direct_conversations,uuid,timestamptz),public.save_group_friend_reply(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_group_friend_reply(uuid,uuid,uuid,text,text) to service_role;
revoke all on function public.create_group_with_friends(uuid[],jsonb,text),public.add_group_ai_friends(uuid,jsonb),public.remove_group_ai_friend(uuid,text) from public,anon;
grant execute on function public.create_group_with_friends(uuid[],jsonb,text),public.add_group_ai_friends(uuid,jsonb),public.remove_group_ai_friend(uuid,text) to authenticated;

create or replace function public.notify_direct_message() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;actor public.profiles;recipient uuid;kind text;member jsonb;begin
 select * into c from public.direct_conversations where id=NEW.conversation_id;
 if c.status='declined' then return NEW;end if;
 select * into actor from public.profiles where id=NEW.sender_id;
 if NEW.friend_id is not null then actor.display_name:=NEW.friend_name;actor.username:='';actor.avatar_url:=NEW.friend_avatar;actor.is_official:=false;end if;
 for recipient,member in select key::uuid,value from jsonb_each(case when c.is_group then c.group_members else jsonb_build_object(c.user_low,'{}'::jsonb,c.user_high,'{}'::jsonb) end) loop
  if recipient=NEW.sender_id then continue;end if;
  if c.is_group then
   if member->>'status'='removed' or member->>'muted'='true' then continue;end if;
   if NEW.system_event is not null and member->>'status'<>'pending' then continue;end if;
   if NEW.system_event is null and member->>'status'<>'accepted' then continue;end if;
  end if;
  kind:=case when c.status='pending' or member->>'status'='pending' then 'dm_request' else 'dm' end;
  if not public.notification_enabled(recipient,kind) then continue;end if;
  insert into public.notifications(user_id,actor_id,type,actor_name,actor_username,actor_avatar_url,actor_is_official,content_preview,event_key,is_read,conversation_id,direct_message_id)
  values(recipient,NEW.sender_id,kind,coalesce(nullif(actor.display_name,''),actor.username),actor.username,actor.avatar_url,coalesce(actor.is_official,false),case when NEW.system_event is not null then 'グループに招待されました' when length(trim(NEW.content))>0 then left(NEW.content,160) else '画像を送信しました' end,'direct:'||NEW.id,false,c.id,NEW.id)
  on conflict(user_id,event_key) where event_key is not null do nothing;
 end loop;return NEW;
end$$;
