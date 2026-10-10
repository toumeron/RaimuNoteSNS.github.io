begin;
-- AI chat_sessions belongs to one owner; private two-party conversations need their own ACL.
alter table public.profile_private_settings add column dm_requests text not null default 'everyone' check(dm_requests in ('everyone','none'));
create table public.direct_conversations(
 id uuid primary key default gen_random_uuid(), user_low uuid not null references public.profiles(id) on delete cascade,
 user_high uuid not null references public.profiles(id) on delete cascade, initiated_by uuid not null references public.profiles(id),
 status text not null check(status in ('pending','accepted','declined')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 read_low timestamptz,read_high timestamptz,unique(user_low,user_high),check(user_low<user_high),check(initiated_by in(user_low,user_high))
);
create table public.direct_messages(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),content text not null default '',attachments text[] not null default '{}',
 created_at timestamptz not null default now(),check(length(content)<=4000),check(cardinality(attachments)<=4),check(length(trim(content))>0 or cardinality(attachments)>0)
);
create index direct_messages_conversation_date on public.direct_messages(conversation_id,created_at desc,id desc);
create index direct_conversations_low on public.direct_conversations(user_low,updated_at desc);
create index direct_conversations_high on public.direct_conversations(user_high,updated_at desc);
alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;
revoke all on public.direct_conversations,public.direct_messages from anon,authenticated;
grant select on public.direct_conversations,public.direct_messages to authenticated;
grant all on public.direct_conversations,public.direct_messages to service_role;
create function public.dm_is_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.direct_conversations where id=target and auth.uid() in(user_low,user_high) and status<>'declined');
$$;
create policy dm_conversations_read on public.direct_conversations for select to authenticated using(auth.uid() in(user_low,user_high));
create policy dm_messages_read on public.direct_messages for select to authenticated using(public.dm_is_member(conversation_id));
create function public.get_dm_preferences() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select dm_requests from public.profile_private_settings where user_id=auth.uid()),'everyone');
$$;
create function public.set_dm_preferences(value text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if value not in('everyone','none') or value is null then raise exception 'Invalid preference';end if;
 insert into public.profile_private_settings(user_id,dm_requests) values(auth.uid(),value) on conflict(user_id) do update set dm_requests=excluded.dm_requests;
end$$;
create function public.send_direct_message(target_user uuid,body text,media text[] default '{}',message_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c public.direct_conversations;mutual boolean; p text; path text; existing public.direct_messages;
begin
 if actor is null or actor=target_user or target_user is null then raise exception 'Invalid recipient' using errcode='42501';end if;
 if body is null or media is null or message_id is null or length(body)>4000 or cardinality(media)>4 or (length(trim(body))=0 and cardinality(media)=0) then raise exception 'Invalid message';end if;
 -- Serialize pair creation, request limits, approval and retries on the same pair.
 perform pg_advisory_xact_lock(hashtextextended(least(actor,target_user)::text||greatest(actor,target_user)::text,0));
 select * into c from public.direct_conversations where user_low=least(actor,target_user) and user_high=greatest(actor,target_user) for update;
 select exists(select 1 from public.follows where follower_id=actor and followee_id=target_user and approved) and exists(select 1 from public.follows where follower_id=target_user and followee_id=actor and approved) into mutual;
 if c.id is null then
  select coalesce((select dm_requests from public.profile_private_settings where user_id=target_user),'everyone') into p;
  if not mutual and p='none' then raise exception 'このユーザーはメッセージリクエストを受け付けていません' using errcode='42501';end if;
  insert into public.direct_conversations(user_low,user_high,initiated_by,status) values(least(actor,target_user),greatest(actor,target_user),actor,case when mutual then 'accepted' else 'pending' end) returning * into c;
 end if;
 select * into existing from public.direct_messages where id=message_id;
 if existing.id is not null then
  if existing.sender_id=actor and existing.conversation_id=c.id then return c.id;end if;
  raise exception 'Invalid message id' using errcode='42501';
 end if;
 if c.status='declined' then raise exception 'この会話には送信できません' using errcode='42501';end if;
 if c.status='pending' and mutual then update public.direct_conversations set status='accepted' where id=c.id;c.status:='accepted';end if;
 if c.status='pending' then
  if c.initiated_by<>actor or exists(select 1 from public.direct_messages where conversation_id=c.id) then raise exception 'リクエストの承認をお待ちください' using errcode='42501';end if;
  if coalesce((select dm_requests from public.profile_private_settings where user_id=target_user),'everyone')='none' then raise exception 'メッセージリクエストは許可されていません' using errcode='42501';end if;
 end if;
 foreach path in array media loop
  if path not like c.id::text||'/'||actor::text||'/%' or not exists(select 1 from storage.objects where bucket_id='direct-message-media' and name=path) then raise exception 'Invalid attachment' using errcode='42501';end if;
 end loop;
 insert into public.direct_messages(id,conversation_id,sender_id,content,attachments) values(message_id,c.id,actor,body,media);
 update public.direct_conversations set updated_at=now(),read_low=case when user_low=actor then now() else read_low end,read_high=case when user_high=actor then now() else read_high end where id=c.id;
 return c.id;
end$$;
-- Create a draft conversation for private uploads, without putting empty chats in the inbox.
create function public.open_direct_conversation(target_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.direct_conversations;mutual boolean;
begin
 if actor is null or actor=target_user or target_user is null then raise exception 'Invalid recipient' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(least(actor,target_user)::text||greatest(actor,target_user)::text,0));
 select * into c from public.direct_conversations where user_low=least(actor,target_user) and user_high=greatest(actor,target_user);
 if c.id is not null then if c.status='declined' then raise exception 'この会話には送信できません' using errcode='42501';end if;return c.id;end if;
 select exists(select 1 from public.follows where follower_id=actor and followee_id=target_user and approved) and exists(select 1 from public.follows where follower_id=target_user and followee_id=actor and approved) into mutual;
 if not mutual and coalesce((select dm_requests from public.profile_private_settings where user_id=target_user),'everyone')='none' then raise exception 'このユーザーはメッセージリクエストを受け付けていません' using errcode='42501';end if;
 insert into public.direct_conversations(user_low,user_high,initiated_by,status) values(least(actor,target_user),greatest(actor,target_user),actor,case when mutual then 'accepted' else 'pending' end) returning * into c;return c.id;
end$$;
create function public.respond_direct_request(target uuid,accept_request boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if accept_request is null then raise exception 'Invalid response';end if;
 update public.direct_conversations set status=case when accept_request then 'accepted' else 'declined' end,updated_at=now() where id=target and status='pending' and auth.uid() in(user_low,user_high) and initiated_by<>auth.uid();
 if not found then raise exception 'Not a received request' using errcode='42501';end if;
end$$;
create function public.read_direct_conversation(target uuid,through_time timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Bound the read watermark to rendered messages: concurrent arrivals remain unread.
 if through_time is null then return;end if;
 update public.direct_conversations set read_low=case when user_low=auth.uid() then greatest(read_low,least(through_time,now())) else read_low end,read_high=case when user_high=auth.uid() then greatest(read_high,least(through_time,now())) else read_high end where id=target and status<>'declined' and auth.uid() in(user_low,user_high);
 if not found then raise exception 'Not a participant' using errcode='42501';end if;
end$$;
create function public.get_direct_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry order by updated_at desc),'[]'::jsonb) from (
 select c.updated_at,jsonb_build_object('id',c.id,'status',c.status,'initiatedBy',c.initiated_by,'updatedAt',c.updated_at,
 'peer',jsonb_build_object('id',p.id,'username',p.username,'displayName',coalesce(p.display_name,p.username),'avatarUrl',p.avatar_url,'isPrivate',p.is_private,'isOfficial',p.is_official,'createdAt',p.created_at),
 'preview',last_message.content,'hasMedia',cardinality(last_message.attachments)>0,
 'unreadCount',(select count(*) from public.direct_messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and m.created_at>coalesce(case when c.user_low=auth.uid() then c.read_low else c.read_high end,'-infinity'::timestamptz))) as entry
 from public.direct_conversations c join public.profiles p on p.id=case when c.user_low=auth.uid() then c.user_high else c.user_low end
 join lateral(select content,attachments from public.direct_messages where conversation_id=c.id order by created_at desc,id desc limit 1) last_message on true
 where auth.uid() in(c.user_low,c.user_high) and c.status<>'declined') q;
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('direct-message-media','direct-message-media',false,10485760,array['image/jpeg','image/png','image/webp']);
create function public.dm_can_read_media(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.direct_conversations c where c.id::text=(storage.foldername(path))[1] and auth.uid() in(c.user_low,c.user_high) and c.status<>'declined');
$$;
revoke all on function public.dm_can_read_media(text) from public;
grant execute on function public.dm_can_read_media(text) to anon,authenticated;
create policy dm_media_read on storage.objects for select to authenticated using(bucket_id='direct-message-media' and public.dm_can_read_media(name));
create policy dm_media_upload on storage.objects for insert to authenticated with check(bucket_id='direct-message-media' and (storage.foldername(name))[2]=auth.uid()::text and exists(select 1 from public.direct_conversations c where c.id::text=(storage.foldername(name))[1] and auth.uid() in(c.user_low,c.user_high) and (c.status='accepted' or (c.status='pending' and c.initiated_by=auth.uid() and not exists(select 1 from public.direct_messages m where m.conversation_id=c.id)))));
create policy dm_media_delete on storage.objects for delete to authenticated using(bucket_id='direct-message-media' and (storage.foldername(name))[2]=auth.uid()::text and not exists(select 1 from public.direct_messages m where name=any(m.attachments)));
-- Restrictive policies prevent legacy broad storage grants from exposing private DM files.
create policy dm_media_read_guard on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'direct-message-media' or public.dm_can_read_media(name));
create policy dm_media_write_guard on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'direct-message-media' or ((storage.foldername(name))[2]=auth.uid()::text and exists(select 1 from public.direct_conversations c where c.id::text=(storage.foldername(name))[1] and auth.uid() in(c.user_low,c.user_high) and (c.status='accepted' or (c.status='pending' and c.initiated_by=auth.uid() and not exists(select 1 from public.direct_messages m where m.conversation_id=c.id))))));
create policy dm_media_update_guard on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'direct-message-media') with check(bucket_id<>'direct-message-media');
create policy dm_media_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'direct-message-media' or ((storage.foldername(name))[2]=auth.uid()::text and not exists(select 1 from public.direct_messages m where name=any(m.attachments))));
do $$declare signature text;begin
 foreach signature in array array['dm_is_member(uuid)','get_dm_preferences()','set_dm_preferences(text)','send_direct_message(uuid,text,text[],uuid)','open_direct_conversation(uuid)','respond_direct_request(uuid,boolean)','read_direct_conversation(uuid,timestamp with time zone)','get_direct_inbox()'] loop
 execute 'revoke all on function public.'||signature||' from public,anon';execute 'grant execute on function public.'||signature||' to authenticated';end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.direct_conversations,public.direct_messages;end if;
end$$;
commit;
