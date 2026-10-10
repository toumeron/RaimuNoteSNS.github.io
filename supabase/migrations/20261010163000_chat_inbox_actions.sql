begin;
-- Per-viewer state extends existing storage; shared messages are never deleted.
alter table public.direct_conversations add column deleted_low timestamptz, add column deleted_high timestamptz;
alter table public.direct_messages alter column created_at set default clock_timestamp();
alter table public.profile_private_settings add column chat_inbox jsonb not null default '{"pins":{},"hidden":{}}'::jsonb;
create function public.get_chat_inbox_preferences() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select chat_inbox from public.profile_private_settings where user_id=auth.uid()),'{"pins":{},"hidden":{}}'::jsonb);
$$;
create function public.set_chat_inbox_preference(chat text,kind text,value boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if chat is null or length(chat)>160 or kind not in ('pins','hidden') or value is null or (kind='hidden' and chat='limeai' and value) then raise exception 'Invalid preference';end if;
 insert into public.profile_private_settings(user_id) values(auth.uid()) on conflict(user_id) do nothing;
 update public.profile_private_settings set chat_inbox=jsonb_set(chat_inbox,array[kind],coalesce(chat_inbox->kind,'{}'::jsonb)||jsonb_build_object(chat,value)) where user_id=auth.uid();
end$$;
create function public.delete_direct_chat(target uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.direct_conversations set deleted_low=case when user_low=auth.uid() then clock_timestamp() else deleted_low end, deleted_high=case when user_high=auth.uid() then clock_timestamp() else deleted_high end where id=target and auth.uid() in(user_low,user_high);
 if not found then raise exception 'Not a participant' using errcode='42501';end if;
 perform public.set_chat_inbox_preference(target::text,'pins',false);
end$$;
create function public.dm_can_view_message(target uuid,message_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.direct_conversations c where c.id=target and auth.uid() in(c.user_low,c.user_high) and c.status<>'declined' and message_time>coalesce(case when c.user_low=auth.uid() then c.deleted_low else c.deleted_high end,'-infinity'::timestamptz));
$$;
drop policy dm_messages_read on public.direct_messages;
create policy dm_messages_read on public.direct_messages for select to authenticated using(public.dm_can_view_message(conversation_id,created_at));
create or replace function public.get_direct_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by updated_at desc),'[]'::jsonb) from (
 select c.updated_at,jsonb_build_object('id',c.id,'status',c.status,'initiatedBy',c.initiated_by,'updatedAt',c.updated_at,
 'peer',jsonb_build_object('id',p.id,'username',p.username,'displayName',coalesce(p.display_name,p.username),'avatarUrl',p.avatar_url,'isPrivate',p.is_private,'isOfficial',p.is_official,'createdAt',p.created_at),
 'pinned',coalesce((select (chat_inbox->'pins'->>c.id::text)::boolean from public.profile_private_settings where user_id=auth.uid()),false),
 'preview',last_message.content,'hasMedia',cardinality(last_message.attachments)>0,
 'unreadCount',(select count(*) from public.direct_messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and m.created_at>greatest(coalesce(case when c.user_low=auth.uid() then c.read_low else c.read_high end,'-infinity'::timestamptz),coalesce(case when c.user_low=auth.uid() then c.deleted_low else c.deleted_high end,'-infinity'::timestamptz)))) as entry
 from public.direct_conversations c join public.profiles p on p.id=case when c.user_low=auth.uid() then c.user_high else c.user_low end
 join lateral(select content,attachments from public.direct_messages where conversation_id=c.id and created_at>coalesce(case when c.user_low=auth.uid() then c.deleted_low else c.deleted_high end,'-infinity'::timestamptz) order by created_at desc,id desc limit 1) last_message on true
 where auth.uid() in(c.user_low,c.user_high) and c.status<>'declined') q;
$$;

do $$declare signature text;begin
 foreach signature in array array['get_chat_inbox_preferences()','set_chat_inbox_preference(text,text,boolean)','delete_direct_chat(uuid)','dm_can_view_message(uuid,timestamp with time zone)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon';execute 'grant execute on function public.'||signature||' to authenticated';end loop;
end$$;
commit;
