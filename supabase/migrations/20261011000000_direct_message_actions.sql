begin;
alter table public.direct_messages add column reactions jsonb not null default '{}', add column hidden_by uuid[] not null default '{}', add column deleted_at timestamptz;
alter table public.direct_messages drop constraint direct_messages_check;
alter table public.direct_messages add constraint direct_messages_check check(deleted_at is not null or length(trim(content))>0 or cardinality(attachments)>0);
drop policy dm_messages_read on public.direct_messages;
create policy dm_messages_read on public.direct_messages for select to authenticated using(deleted_at is null and not(auth.uid()=any(hidden_by)) and public.dm_can_view_message(conversation_id,created_at));
create function public.toggle_direct_reaction(target uuid,emoji text) returns void language plpgsql security definer set search_path='' as $$
declare m public.direct_messages;c public.direct_conversations;actor uuid:=auth.uid();users jsonb;begin
 select * into m from public.direct_messages where id=target for update;
 select * into c from public.direct_conversations where id=m.conversation_id;
 if actor is null or m.id is null or m.deleted_at is not null or actor=any(m.hidden_by) or m.system_event is not null or not public.dm_can_view_message(m.conversation_id,m.created_at) or c.status<>'accepted' then raise exception 'Not permitted' using errcode='42501';end if;
 if emoji is null or emoji<>all(array['👍','😢','👩‍💻','🆗','🙏','😮','😋','😭','🎉','👎','❤️','🔥','🤠','😂','🤩','🙃','💯','🧠','⭕']) then raise exception 'Invalid reaction';end if;
 users:=coalesce(m.reactions->emoji,'{}'::jsonb);
 if users?actor::text then users:=users-actor::text;else users:=users||jsonb_build_object(actor::text,true);end if;
 update public.direct_messages set reactions=case when users='{}'::jsonb then reactions-emoji else jsonb_set(reactions,array[emoji],users) end where id=target;
end$$;
create function public.delete_direct_message(target uuid,for_everyone boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare m public.direct_messages;actor uuid:=auth.uid();begin
 select * into m from public.direct_messages where id=target for update;
 if actor is null or m.id is null or m.system_event is not null or not public.dm_can_view_message(m.conversation_id,m.created_at) then raise exception 'Not permitted' using errcode='42501';end if;
 if for_everyone then
  if m.sender_id<>actor then raise exception '送信したメッセージのみ全員から削除できます' using errcode='42501';end if;
  update public.direct_messages set deleted_at=coalesce(deleted_at,clock_timestamp()),content='',attachments='{}',reactions='{}' where id=target;
 update public.direct_conversations set updated_at=clock_timestamp() where id=m.conversation_id;
 else update public.direct_messages set hidden_by=case when actor=any(hidden_by) then hidden_by else array_append(hidden_by,actor) end where id=target;end if;
 update public.notifications set is_read=true where direct_message_id=target and (for_everyone or user_id=actor);
end$$;
revoke all on function public.toggle_direct_reaction(uuid,text),public.delete_direct_message(uuid,boolean) from public,anon;
grant execute on function public.toggle_direct_reaction(uuid,text),public.delete_direct_message(uuid,boolean) to authenticated;
create or replace function public.get_pair_direct_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by updated_at desc),'[]'::jsonb) from (
 select c.updated_at,jsonb_build_object('id',c.id,'status',c.status,'initiatedBy',c.initiated_by,'updatedAt',c.updated_at,
 'peer',jsonb_build_object('id',p.id,'username',p.username,'displayName',coalesce(p.display_name,p.username),'avatarUrl',p.avatar_url,'isPrivate',p.is_private,'isOfficial',p.is_official,'createdAt',p.created_at),
 'pinned',coalesce((select (chat_inbox->'pins'->>c.id::text)::boolean from public.profile_private_settings where user_id=auth.uid()),false),
 'preview',last_message.content,'hasMedia',cardinality(last_message.attachments)>0,
 'unreadCount',(select count(*) from public.direct_messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and m.deleted_at is null and not(auth.uid()=any(m.hidden_by)) and m.created_at>greatest(coalesce(case when c.user_low=auth.uid() then c.read_low else c.read_high end,'-infinity'::timestamptz),coalesce(case when c.user_low=auth.uid() then c.deleted_low else c.deleted_high end,'-infinity'::timestamptz)))) as entry
 from public.direct_conversations c join public.profiles p on p.id=case when c.user_low=auth.uid() then c.user_high else c.user_low end
 join lateral(select content,attachments from public.direct_messages where conversation_id=c.id and deleted_at is null and not(auth.uid()=any(hidden_by)) and created_at>coalesce(case when c.user_low=auth.uid() then c.deleted_low else c.deleted_high end,'-infinity'::timestamptz) order by created_at desc,id desc limit 1) last_message on true
 where auth.uid() in(c.user_low,c.user_high) and c.status<>'declined') q;
$$;
create or replace function public.get_direct_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by entry->>'updatedAt' desc),'[]') from (
 select value as entry from jsonb_array_elements(public.get_pair_direct_inbox()) union all
 select public.dm_group_summary(c)||jsonb_build_object('preview',case when c.group_members->auth.uid()::text->>'status'='pending' then 'グループへの招待' else coalesce(m.content,'') end,'hasMedia',cardinality(m.attachments)>0,'unreadCount',case when c.group_members->auth.uid()::text->>'status'='pending' then 1 else (select count(*) from public.direct_messages d where d.conversation_id=c.id and d.sender_id<>auth.uid() and d.system_event is null and d.deleted_at is null and not(auth.uid()=any(d.hidden_by)) and public.dm_can_view_message(c.id,d.created_at) and d.created_at>coalesce((c.group_members->auth.uid()::text->>'readAt')::timestamptz,'-infinity')) end)
 from public.direct_conversations c left join lateral(select content,attachments from public.direct_messages where conversation_id=c.id and deleted_at is null and not(auth.uid()=any(hidden_by)) and public.dm_can_view_message(c.id,created_at) order by created_at desc,id desc limit 1)m on true
 where c.is_group and c.group_members?auth.uid()::text and public.dm_group_member(c,auth.uid(),false) and (c.group_members->auth.uid()::text->>'deletedAt' is null or m.content is not null)
 )q;
$$;
create or replace function public.save_group_friend_reply(target uuid,actor uuid,trigger_message uuid,friend text,body text) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;m public.direct_messages;f jsonb;begin
 select * into c from public.direct_conversations where id=target for update;f:=c.group_friends->friend;
 select * into m from public.direct_messages where id=trigger_message and conversation_id=target and sender_id=actor and friend_id is null and system_event is null and deleted_at is null and not(actor=any(hidden_by));
 if not public.dm_group_member(c,actor) or m.id is null or f is null or not public.dm_can_actor_view_group_message(c,actor,m.created_at) then raise exception 'Not permitted' using errcode='42501';end if;
 if length(trim(body))=0 or length(body)>4000 then raise exception 'Invalid reply';end if;
 insert into public.direct_messages(conversation_id,sender_id,content,friend_id,friend_name,friend_avatar,reply_to) values(target,actor,body,friend,f->>'name',f->>'avatar',trigger_message) on conflict(reply_to,friend_id) where friend_id is not null do nothing;
 update public.direct_conversations set updated_at=clock_timestamp() where id=target;
end$$;
commit;
