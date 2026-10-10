begin;
drop function public.save_group_friend_reply(uuid,uuid,uuid,text,text);
create or replace function public.save_group_friend_reply(target uuid,actor uuid,trigger_message uuid,friend text,body text,reaction text default null) returns void language plpgsql security definer set search_path='' as $$
declare c public.direct_conversations;m public.direct_messages;f jsonb;begin
 select * into c from public.direct_conversations where id=target for update;f:=c.group_friends->friend;
 select * into m from public.direct_messages where id=trigger_message and conversation_id=target and sender_id=actor and friend_id is null and system_event is null and deleted_at is null and not(actor=any(hidden_by));
 if not public.dm_group_member(c,actor) or m.id is null or f is null or not public.dm_can_actor_view_group_message(c,actor,m.created_at) then raise exception 'Not permitted' using errcode='42501';end if;
 if reaction is not null and reaction<>all(array['👍','😢','👩‍💻','🆗','🙏','😮','😋','😭','🎉','👎','❤️','🔥','🤠','😂','🤩','🙃','💯','🧠','⭕']) then raise exception 'Invalid reaction';end if;
 if length(trim(body))=0 or length(body)>4000 then raise exception 'Invalid reply';end if;
 insert into public.direct_messages(conversation_id,sender_id,content,friend_id,friend_name,friend_avatar,reply_to) values(target,actor,body,friend,f->>'name',f->>'avatar',trigger_message) on conflict(reply_to,friend_id) where friend_id is not null do nothing;
 if found and reaction is not null then
  update public.direct_messages set reactions=jsonb_set(reactions,array[reaction],coalesce(reactions->reaction,'{}'::jsonb)||jsonb_build_object('friend:'||friend,true)) where id=trigger_message;
 end if;
 update public.direct_conversations set updated_at=clock_timestamp() where id=target;
end$$;
revoke all on function public.save_group_friend_reply(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_group_friend_reply(uuid,uuid,uuid,text,text,text) to service_role;
create function public.send_direct_reply(reply_message uuid,body text,media text[],message_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare parent public.direct_messages;existing public.direct_messages;c public.direct_conversations;actor uuid:=auth.uid();result uuid;begin
 select * into parent from public.direct_messages where id=reply_message;
 if actor is null or parent.id is null or parent.deleted_at is not null or actor=any(parent.hidden_by) or parent.system_event is not null or not public.dm_can_view_message(parent.conversation_id,parent.created_at) then raise exception 'Not permitted' using errcode='42501';end if;
 select * into c from public.direct_conversations where id=parent.conversation_id;
 if c.status<>'accepted' then raise exception '承認後に返信できます' using errcode='42501';end if;
 select * into existing from public.direct_messages where id=message_id;
 if existing.id is not null then
  if existing.sender_id=actor and existing.conversation_id=c.id and existing.reply_to=reply_message then return c.id;end if;
  raise exception 'Invalid message id' using errcode='42501';
 end if;
 if c.is_group then result:=public.send_group_direct_message(c.id,body,media,message_id);
 else result:=public.send_direct_message(case when c.user_low=actor then c.user_high else c.user_low end,body,media,message_id);end if;
 update public.direct_messages set reply_to=reply_message where id=message_id;return result;
end$$;
revoke all on function public.send_direct_reply(uuid,text,text[],uuid) from public,anon;
grant execute on function public.send_direct_reply(uuid,text,text[],uuid) to authenticated;
commit;
