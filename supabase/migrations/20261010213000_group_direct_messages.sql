begin;
-- Reuse the existing conversation and message stores. Group membership is bounded to 100 people.
alter table public.direct_conversations alter column user_low drop not null,alter column user_high drop not null;
alter table public.direct_conversations add column is_group boolean not null default false,
 add column group_name text not null default '',add column group_description text not null default '',
 add column group_avatar text not null default '',add column group_members jsonb not null default '{}',
 add column group_requests jsonb not null default '{}',add column invite_token text,
 add column admin_only boolean not null default true,add column disappearing_seconds integer not null default 0 check(disappearing_seconds in(0,86400,604800));
alter table public.direct_conversations add constraint dm_group_shape check(
 (not is_group and user_low is not null and user_high is not null) or
 (is_group and user_low is null and user_high is null and jsonb_typeof(group_members)='object'));
create index direct_group_members_idx on public.direct_conversations using gin(group_members) where is_group;
alter table public.direct_messages add column system_event text,add column expires_at timestamptz;
create function public.dm_group_member(c public.direct_conversations,actor uuid,accepted_only boolean default true) returns boolean language sql immutable set search_path='' as $$
 select actor is not null and coalesce(c.is_group,false) and coalesce(c.group_members->actor::text->>'status','') in(case when accepted_only then 'accepted' else 'pending' end,'accepted');
$$;
create or replace function public.dm_is_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.direct_conversations c where c.id=target and c.status<>'declined' and (auth.uid() in(c.user_low,c.user_high) or public.dm_group_member(c,auth.uid())));
$$;
drop policy dm_conversations_read on public.direct_conversations;
create policy dm_conversations_read on public.direct_conversations for select to authenticated using(auth.uid() in(user_low,user_high) or public.dm_group_member(direct_conversations,auth.uid(),false));
create or replace function public.dm_can_view_message(target uuid,message_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.direct_conversations c where c.id=target and c.status<>'declined' and (
 (not c.is_group and auth.uid() in(c.user_low,c.user_high) and message_time>coalesce(case when c.user_low=auth.uid() then c.deleted_low else c.deleted_high end,'-infinity'::timestamptz)) or
 (public.dm_group_member(c,auth.uid()) and message_time>=coalesce((c.group_members->auth.uid()::text->>'joinedAt')::timestamptz,'infinity') and message_time>coalesce((c.group_members->auth.uid()::text->>'deletedAt')::timestamptz,'-infinity'))));
$$;
drop policy dm_messages_read on public.direct_messages;
create policy dm_messages_read on public.direct_messages for select to authenticated using(public.dm_can_view_message(conversation_id,created_at) and (expires_at is null or expires_at>now()));
create function public.dm_group_summary(c public.direct_conversations) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'isGroup',true,'status',c.group_members->auth.uid()::text->>'status','initiatedBy',c.initiated_by,'updatedAt',c.updated_at,'createdAt',c.created_at,
 'peer',jsonb_build_object('id',c.id,'username','','displayName',coalesce(nullif(c.group_name,''),(select string_agg(coalesce(p.display_name,p.username),'さんと' order by p.username)||'さん' from public.profiles p where c.group_members?p.id::text and p.id<>auth.uid() and c.group_members->p.id::text->>'status'<>'removed')),'avatarUrl',c.group_avatar,'createdAt',c.created_at),
 'disappearingSeconds',c.disappearing_seconds,'description',c.group_description,'adminOnly',c.admin_only,'inviteToken',case when (c.group_members->auth.uid()::text->>'admin')::boolean then c.invite_token end,
 'muted',coalesce((c.group_members->auth.uid()::text->>'muted')::boolean,false),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',coalesce(p.display_name,p.username),'avatarUrl',p.avatar_url,'isPrivate',p.is_private,'isOfficial',p.is_official,'createdAt',p.created_at,'status',c.group_members->p.id::text->>'status','admin',coalesce((c.group_members->p.id::text->>'admin')::boolean,false)) order by p.username),'[]') from public.profiles p where c.group_members?p.id::text and c.group_members->p.id::text->>'status'<>'removed'),
 'requests',case when (c.group_members->auth.uid()::text->>'admin')::boolean then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',coalesce(p.display_name,p.username),'avatarUrl',p.avatar_url,'createdAt',p.created_at)),'[]') from public.profiles p where c.group_requests?p.id::text) else '[]'::jsonb end);
$$;
create function public.get_group_direct_conversation(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.direct_conversations;begin
 select * into c from public.direct_conversations where id=target;
 if not public.dm_group_member(c,auth.uid(),false) then raise exception 'Not a participant' using errcode='42501';end if;
 return public.dm_group_summary(c);
end$$;
create function public.dm_group_add(c public.direct_conversations,people uuid[],actor uuid) returns jsonb language plpgsql set search_path='' as $$
declare members jsonb:=c.group_members;person uuid;mutual boolean;begin
 if people is null or cardinality(people)>99 then raise exception '参加者が多すぎます';end if;
 foreach person in array people loop
  if person is null or not exists(select 1 from public.profiles where id=person) then raise exception 'Invalid participant';end if;
  if members->person::text->>'status' in('accepted','pending') then continue;end if;
  select exists(select 1 from public.follows where follower_id=actor and followee_id=person and approved) and exists(select 1 from public.follows where follower_id=person and followee_id=actor and approved) into mutual;
  if not mutual and coalesce((select dm_requests from public.profile_private_settings where user_id=person),'everyone')='none' then raise exception 'メッセージリクエストを受け付けていない参加者がいます' using errcode='42501';end if;
  members:=members||jsonb_build_object(person,jsonb_build_object('status',case when mutual then 'accepted' else 'pending' end,'admin',false,'joinedAt',clock_timestamp()));
 end loop;
 if (select count(*) from jsonb_each(members) where value->>'status'<>'removed')>100 then raise exception 'グループは100人までです';end if;
 return members;
end$$;
create function public.create_group_direct_conversation(people uuid[],name text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.direct_conversations;begin
 if actor is null or people is null or cardinality(people)<2 or length(coalesce(name,''))>100 then raise exception '2人以上の参加者を選択してください';end if;
 c.is_group:=true;c.group_members:=jsonb_build_object(actor,jsonb_build_object('status','accepted','admin',true,'joinedAt',clock_timestamp()));
 c.group_members:=public.dm_group_add(c,people,actor);
 if (select count(*) from jsonb_each(c.group_members))<3 then raise exception '2人以上の参加者を選択してください';end if;
 insert into public.direct_conversations(is_group,initiated_by,status,group_members,group_name) values(true,actor,'accepted',c.group_members,trim(coalesce(name,''))) returning * into c;
 insert into public.direct_messages(conversation_id,sender_id,content,system_event) values(c.id,actor,'グループを作成しました','group_created');return c.id;
end$$;
create function public.update_group_direct_conversation(target uuid,name text,description text,avatar text,only_admin boolean,disappearing integer default 0) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;begin
 select * into c from public.direct_conversations where id=target for update;
 if not public.dm_group_member(c,auth.uid()) or (c.admin_only and not coalesce((c.group_members->auth.uid()::text->>'admin')::boolean,false)) then raise exception '管理者のみ変更できます' using errcode='42501';end if;
 if disappearing is null or disappearing not in(0,86400,604800) then raise exception 'Invalid expiry';end if;
 if name is null or description is null or avatar is null or only_admin is null or length(name)>100 or length(description)>1000 or length(avatar)>2048 or (avatar<>'' and avatar !~ '^https://res\.cloudinary\.com/') then raise exception 'Invalid group';end if;
 if only_admin<>c.admin_only and not coalesce((c.group_members->auth.uid()::text->>'admin')::boolean,false) then raise exception '管理者のみ変更できます' using errcode='42501';end if;
 update public.direct_conversations set group_name=trim(name),group_description=description,group_avatar=avatar,admin_only=only_admin,disappearing_seconds=disappearing,updated_at=clock_timestamp() where id=target;
end$$;
create function public.add_group_direct_members(target uuid,people uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;begin
 select * into c from public.direct_conversations where id=target for update;
 if not public.dm_group_member(c,auth.uid()) or (c.admin_only and not coalesce((c.group_members->auth.uid()::text->>'admin')::boolean,false)) then raise exception '管理者のみ追加できます' using errcode='42501';end if;
 update public.direct_conversations set group_members=public.dm_group_add(c,people,auth.uid()),updated_at=clock_timestamp() where id=target;
 insert into public.direct_messages(conversation_id,sender_id,content,system_event) values(target,auth.uid(),'メンバーを追加しました','members_added');
end$$;
create function public.manage_group_direct_member(target uuid,person uuid,action text) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;members jsonb;begin
 select * into c from public.direct_conversations where id=target for update;members:=c.group_members;
 if not public.dm_group_member(c,auth.uid()) or (person<>auth.uid() and not coalesce((members->auth.uid()::text->>'admin')::boolean,false)) then raise exception '管理者のみ変更できます' using errcode='42501';end if;
 if action='approve' and c.group_requests?person::text then
  members:=members||jsonb_build_object(person,jsonb_build_object('status','accepted','admin',false,'joinedAt',clock_timestamp()));
 elsif action='reject' and c.group_requests?person::text then null;
 elsif action='admin' and members->person::text->>'status'='accepted' and person<>auth.uid() then members:=jsonb_set(members,array[person::text,'admin'],'true');
 elsif action='remove' and members->person::text->>'status' in('accepted','pending') then
  if coalesce((members->person::text->>'admin')::boolean,false) and (select count(*) from jsonb_each(members) where value->>'status'='accepted' and value->>'admin'='true')<=1 and (select count(*) from jsonb_each(members) where value->>'status'='accepted')>1 then raise exception '別のメンバーを管理者にしてから退出してください';end if;
  members:=jsonb_set(members,array[person::text,'status'],'"removed"');
 else raise exception 'Invalid action';end if;
 if (select count(*) from jsonb_each(members) where value->>'status'<>'removed')>100 then raise exception 'グループは100人までです';end if;
 update public.direct_conversations set group_members=members,group_requests=group_requests-person::text,updated_at=clock_timestamp() where id=target;
end$$;
create function public.set_group_direct_muted(target uuid,value boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 if value is null then raise exception 'Invalid value';end if;
 update public.direct_conversations c set group_members=jsonb_set(group_members,array[auth.uid()::text,'muted'],to_jsonb(value)) where id=target and public.dm_group_member(c,auth.uid(),false);
 if not found then raise exception 'Not a participant' using errcode='42501';end if;
end$$;
create function public.set_group_direct_invite(target uuid,enabled boolean) returns text language plpgsql security definer set search_path='' as $$
declare token text;begin
 if enabled is null then raise exception 'Invalid value';end if;
 update public.direct_conversations c set invite_token=case when enabled then coalesce(invite_token,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')) else null end where id=target and public.dm_group_member(c,auth.uid()) and c.group_members->auth.uid()::text->>'admin'='true' returning invite_token into token;
 if not found then raise exception '管理者のみ変更できます' using errcode='42501';end if;return token;
end$$;
create function public.get_group_direct_invitation(token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',coalesce(nullif(group_name,''),'グループ'),'avatarUrl',group_avatar,'memberCount',(select count(*) from jsonb_each(group_members) where value->>'status'<>'removed')) from public.direct_conversations where is_group and invite_token=token and length(token)=64;
$$;
create function public.request_group_direct_join(token text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501';end if;
 select * into c from public.direct_conversations where is_group and invite_token=token and length(token)=64 for update;
 if c.id is null then raise exception '招待リンクは無効です';end if;
 if public.dm_group_member(c,auth.uid(),false) then return c.id;end if;
 if (select count(*) from jsonb_each(c.group_requests))>=100 then raise exception '参加リクエストが上限に達しました';end if;
 update public.direct_conversations set group_requests=group_requests||jsonb_build_object(auth.uid(),clock_timestamp()) where id=c.id;return c.id;
end$$;
create function public.send_group_direct_message(target uuid,body text,media text[] default '{}',message_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.direct_conversations;existing public.direct_messages;ref text;begin
 select * into c from public.direct_conversations where id=target for update;
 if not public.dm_group_member(c,actor) then raise exception 'Not a participant' using errcode='42501';end if;
 if body is null or media is null or message_id is null or length(body)>4000 or cardinality(media)>4 or (length(trim(body))=0 and cardinality(media)=0) then raise exception 'Invalid message';end if;
 select * into existing from public.direct_messages where id=message_id;
 if existing.id is not null then if existing.sender_id=actor and existing.conversation_id=target then return target;end if;raise exception 'Invalid message id' using errcode='42501';end if;
 foreach ref in array media loop if ref not like 'cloudinary:%' or c.media_assets->ref->>'owner' is distinct from actor::text then raise exception 'Invalid attachment' using errcode='42501';end if;end loop;
 insert into public.direct_messages(id,conversation_id,sender_id,content,attachments,expires_at) values(message_id,target,actor,body,media,case when c.disappearing_seconds>0 then clock_timestamp()+c.disappearing_seconds*interval '1 second' end);
 update public.direct_conversations set updated_at=clock_timestamp(),group_members=jsonb_set(group_members,array[actor::text,'readAt'],to_jsonb(clock_timestamp())) where id=target;return target;
end$$;
-- Preserve the existing two-person functions verbatim behind group-aware entry points.
alter function public.get_direct_inbox() rename to get_pair_direct_inbox;
create function public.get_direct_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by entry->>'updatedAt' desc),'[]') from (
 select value as entry from jsonb_array_elements(public.get_pair_direct_inbox()) union all
 select public.dm_group_summary(c)||jsonb_build_object('preview',case when c.group_members->auth.uid()::text->>'status'='pending' then 'グループへの招待' else coalesce(m.content,'') end,'hasMedia',cardinality(m.attachments)>0,'unreadCount',case when c.group_members->auth.uid()::text->>'status'='pending' then 1 else (select count(*) from public.direct_messages d where d.conversation_id=c.id and d.sender_id<>auth.uid() and d.system_event is null and public.dm_can_view_message(c.id,d.created_at) and (d.expires_at is null or d.expires_at>now()) and d.created_at>coalesce((c.group_members->auth.uid()::text->>'readAt')::timestamptz,'-infinity')) end)
 from public.direct_conversations c left join lateral(select content,attachments from public.direct_messages where conversation_id=c.id and public.dm_can_view_message(c.id,created_at) and (expires_at is null or expires_at>now()) order by created_at desc,id desc limit 1)m on true
 where c.is_group and c.group_members?auth.uid()::text and public.dm_group_member(c,auth.uid(),false) and (c.group_members->auth.uid()::text->>'deletedAt' is null or m.content is not null)
 )q;
$$;
alter function public.read_direct_conversation(uuid,timestamptz) rename to read_pair_direct_conversation;
create function public.read_direct_conversation(target uuid,through_time timestamptz) returns void language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.direct_conversations where id=target and is_group) then
  if through_time is null then return;end if;
  update public.direct_conversations c set group_members=jsonb_set(group_members,array[auth.uid()::text,'readAt'],to_jsonb(greatest(coalesce((group_members->auth.uid()::text->>'readAt')::timestamptz,'-infinity'),least(through_time,clock_timestamp())))) where id=target and public.dm_group_member(c,auth.uid());
  if not found then raise exception 'Not a participant' using errcode='42501';end if;
 else perform public.read_pair_direct_conversation(target,through_time);end if;
end$$;
alter function public.delete_direct_chat(uuid) rename to delete_pair_direct_chat;
create function public.delete_direct_chat(target uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.direct_conversations where id=target and is_group) then
  update public.direct_conversations c set group_members=jsonb_set(group_members,array[auth.uid()::text,'deletedAt'],to_jsonb(clock_timestamp())) where id=target and public.dm_group_member(c,auth.uid());
  if not found then raise exception 'Not a participant' using errcode='42501';end if;perform public.set_chat_inbox_preference(target::text,'pins',false);
 else perform public.delete_pair_direct_chat(target);end if;
end$$;
alter function public.respond_direct_request(uuid,boolean) rename to respond_pair_direct_request;
create function public.respond_direct_request(target uuid,accept_request boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 if accept_request is null then raise exception 'Invalid response';end if;
 if exists(select 1 from public.direct_conversations where id=target and is_group) then
  update public.direct_conversations set group_members=jsonb_set(group_members,array[auth.uid()::text,'status'],to_jsonb(case when accept_request then 'accepted' else 'removed' end)) where id=target and group_members->auth.uid()::text->>'status'='pending';
  if not found then raise exception 'Not a received request' using errcode='42501';end if;
 else perform public.respond_pair_direct_request(target,accept_request);end if;
end$$;
create or replace function public.register_direct_media(target uuid,actor uuid,ref text,format text) returns void language plpgsql security definer set search_path='' as $$ begin
 if actor is null or ref is null or ref !~ ('^cloudinary:direct_messages/'||target::text||'/'||actor::text||'/[0-9a-f-]{36}$') or format not in('jpg','jpeg','png','webp') then raise exception 'Invalid asset';end if;
 update public.direct_conversations c set media_assets=media_assets||jsonb_build_object(ref,jsonb_build_object('owner',actor,'format',format)) where c.id=target and (public.dm_group_member(c,actor) or (actor in(c.user_low,c.user_high) and (c.status='accepted' or (c.status='pending' and c.initiated_by=actor and not exists(select 1 from public.direct_messages m where m.conversation_id=c.id)))));
 if not found then raise exception 'Upload not allowed' using errcode='42501';end if;
end$$;
create or replace function public.notify_direct_message() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;actor public.profiles;recipient uuid;kind text;member jsonb;begin
 select * into c from public.direct_conversations where id=NEW.conversation_id;
 if c.status='declined' then return NEW;end if;
 select * into actor from public.profiles where id=NEW.sender_id;
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
create or replace function public.read_direct_notifications() returns trigger language plpgsql security definer set search_path='' as $$ begin
 update public.notifications n set is_read=true from public.direct_messages m where n.conversation_id=NEW.id and n.direct_message_id=m.id and not n.is_read and (
 NEW.status='declined' or (not NEW.is_group and ((n.user_id=NEW.user_low and m.created_at<=greatest(NEW.read_low,NEW.deleted_low)) or (n.user_id=NEW.user_high and m.created_at<=greatest(NEW.read_high,NEW.deleted_high)))) or
 (NEW.is_group and (NEW.group_members->n.user_id::text->>'status'='removed' or (n.type='dm_request' and NEW.group_members->n.user_id::text->>'status'='accepted') or m.created_at<=greatest((NEW.group_members->n.user_id::text->>'readAt')::timestamptz,(NEW.group_members->n.user_id::text->>'deletedAt')::timestamptz))));return NEW;
end$$;
drop trigger direct_notifications_read on public.direct_conversations;
create trigger direct_notifications_read after update of read_low,read_high,deleted_low,deleted_high,status,group_members on public.direct_conversations for each row execute function public.read_direct_notifications();
do $$declare signature text;begin
 foreach signature in array array['dm_group_member(public.direct_conversations,uuid,boolean)','dm_group_summary(public.direct_conversations)','dm_group_add(public.direct_conversations,uuid[],uuid)','get_pair_direct_inbox()','read_pair_direct_conversation(uuid,timestamp with time zone)','delete_pair_direct_chat(uuid)','respond_pair_direct_request(uuid,boolean)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';end loop;
 foreach signature in array array['get_group_direct_conversation(uuid)','create_group_direct_conversation(uuid[],text)','update_group_direct_conversation(uuid,text,text,text,boolean,integer)','add_group_direct_members(uuid,uuid[])','manage_group_direct_member(uuid,uuid,text)','set_group_direct_muted(uuid,boolean)','set_group_direct_invite(uuid,boolean)','get_group_direct_invitation(text)','request_group_direct_join(text)','send_group_direct_message(uuid,text,text[],uuid)','get_direct_inbox()','read_direct_conversation(uuid,timestamp with time zone)','delete_direct_chat(uuid)','respond_direct_request(uuid,boolean)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon';execute 'grant execute on function public.'||signature||' to authenticated';end loop;
 -- RLS helper must be callable by authenticated readers, without accepting forged row data.
 grant execute on function public.dm_group_member(public.direct_conversations,uuid,boolean) to authenticated;
end$$;
notify pgrst,'reload schema';
commit;
