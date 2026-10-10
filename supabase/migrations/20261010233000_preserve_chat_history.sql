begin;
-- Stop only the legacy LimeAI history deletion job. Backups and other schedules remain.
do $$begin
 if to_regclass('cron.job') is not null then
  perform cron.unschedule(jobid) from cron.job where jobname='delete_old_chat_sessions';
 end if;
end$$;
-- Retain the old RPC argument for cached clients, but never expire messages.
create or replace function public.dm_group_summary_without_friends(c public.direct_conversations) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'isGroup',true,'status',c.group_members->auth.uid()::text->>'status','initiatedBy',c.initiated_by,'updatedAt',c.updated_at,'createdAt',c.created_at,
 'peer',jsonb_build_object('id',c.id,'username','','displayName',coalesce(nullif(c.group_name,''),(select string_agg(coalesce(p.display_name,p.username),'さんと' order by p.username)||'さん' from public.profiles p where c.group_members?p.id::text and p.id<>auth.uid() and c.group_members->p.id::text->>'status'<>'removed')),'avatarUrl',c.group_avatar,'createdAt',c.created_at),
 'description',c.group_description,'adminOnly',c.admin_only,'inviteToken',case when (c.group_members->auth.uid()::text->>'admin')::boolean then c.invite_token end,
 'muted',coalesce((c.group_members->auth.uid()::text->>'muted')::boolean,false),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',coalesce(p.display_name,p.username),'avatarUrl',p.avatar_url,'isPrivate',p.is_private,'isOfficial',p.is_official,'createdAt',p.created_at,'status',c.group_members->p.id::text->>'status','admin',coalesce((c.group_members->p.id::text->>'admin')::boolean,false)) order by p.username),'[]') from public.profiles p where c.group_members?p.id::text and c.group_members->p.id::text->>'status'<>'removed'),
 'requests',case when (c.group_members->auth.uid()::text->>'admin')::boolean then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',coalesce(p.display_name,p.username),'avatarUrl',p.avatar_url,'createdAt',p.created_at)),'[]') from public.profiles p where c.group_requests?p.id::text) else '[]'::jsonb end);
$$;
create or replace function public.update_group_direct_conversation(target uuid,name text,description text,avatar text,only_admin boolean,disappearing integer default 0) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;begin
 select * into c from public.direct_conversations where id=target for update;
 if not public.dm_group_member(c,auth.uid()) or (c.admin_only and not coalesce((c.group_members->auth.uid()::text->>'admin')::boolean,false)) then raise exception '管理者のみ変更できます' using errcode='42501';end if;
 if name is null or description is null or avatar is null or only_admin is null or length(name)>100 or length(description)>1000 or length(avatar)>2048 or (avatar<>'' and avatar !~ '^https://res\.cloudinary\.com/') then raise exception 'Invalid group';end if;
 if only_admin<>c.admin_only and not coalesce((c.group_members->auth.uid()::text->>'admin')::boolean,false) then raise exception '管理者のみ変更できます' using errcode='42501';end if;
 update public.direct_conversations set group_name=trim(name),group_description=description,group_avatar=avatar,admin_only=only_admin,updated_at=clock_timestamp() where id=target;
end$$;
create or replace function public.send_group_direct_message(target uuid,body text,media text[] default '{}',message_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.direct_conversations;existing public.direct_messages;ref text;begin
 select * into c from public.direct_conversations where id=target for update;
 if not public.dm_group_member(c,actor) then raise exception 'Not a participant' using errcode='42501';end if;
 if body is null or media is null or message_id is null or length(body)>4000 or cardinality(media)>4 or (length(trim(body))=0 and cardinality(media)=0) then raise exception 'Invalid message';end if;
 select * into existing from public.direct_messages where id=message_id;
 if existing.id is not null then if existing.sender_id=actor and existing.conversation_id=target then return target;end if;raise exception 'Invalid message id' using errcode='42501';end if;
 foreach ref in array media loop if ref not like 'cloudinary:%' or c.media_assets->ref->>'owner' is distinct from actor::text then raise exception 'Invalid attachment' using errcode='42501';end if;end loop;
 insert into public.direct_messages(id,conversation_id,sender_id,content,attachments) values(message_id,target,actor,body,media);
 update public.direct_conversations set updated_at=clock_timestamp(),group_members=jsonb_set(group_members,array[actor::text,'readAt'],to_jsonb(clock_timestamp())) where id=target;return target;
end$$;
create or replace function public.get_direct_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by entry->>'updatedAt' desc),'[]') from (
 select value as entry from jsonb_array_elements(public.get_pair_direct_inbox()) union all
 select public.dm_group_summary(c)||jsonb_build_object('preview',case when c.group_members->auth.uid()::text->>'status'='pending' then 'グループへの招待' else coalesce(m.content,'') end,'hasMedia',cardinality(m.attachments)>0,'unreadCount',case when c.group_members->auth.uid()::text->>'status'='pending' then 1 else (select count(*) from public.direct_messages d where d.conversation_id=c.id and d.sender_id<>auth.uid() and d.system_event is null and public.dm_can_view_message(c.id,d.created_at) and d.created_at>coalesce((c.group_members->auth.uid()::text->>'readAt')::timestamptz,'-infinity')) end)
 from public.direct_conversations c left join lateral(select content,attachments from public.direct_messages where conversation_id=c.id and public.dm_can_view_message(c.id,created_at) order by created_at desc,id desc limit 1)m on true
 where c.is_group and c.group_members?auth.uid()::text and public.dm_group_member(c,auth.uid(),false) and (c.group_members->auth.uid()::text->>'deletedAt' is null or m.content is not null)
 )q;
$$;
create or replace function public.save_group_friend_reply(target uuid,actor uuid,trigger_message uuid,friend text,body text) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;m public.direct_messages;f jsonb;begin
 select * into c from public.direct_conversations where id=target for update;f:=c.group_friends->friend;
 select * into m from public.direct_messages where id=trigger_message and conversation_id=target and sender_id=actor and friend_id is null and system_event is null;
 if not public.dm_group_member(c,actor) or m.id is null or f is null or not public.dm_can_actor_view_group_message(c,actor,m.created_at) then raise exception 'Not permitted' using errcode='42501';end if;
 if length(trim(body))=0 or length(body)>4000 then raise exception 'Invalid reply';end if;
 insert into public.direct_messages(conversation_id,sender_id,content,friend_id,friend_name,friend_avatar,reply_to) values(target,actor,body,friend,f->>'name',f->>'avatar',trigger_message) on conflict(reply_to,friend_id) where friend_id is not null do nothing;
 update public.direct_conversations set updated_at=clock_timestamp() where id=target;
end$$;
drop policy dm_messages_read on public.direct_messages;
create policy dm_messages_read on public.direct_messages for select to authenticated using(public.dm_can_view_message(conversation_id,created_at));
alter table public.direct_messages drop column expires_at;
alter table public.direct_conversations drop column disappearing_seconds;
commit;
