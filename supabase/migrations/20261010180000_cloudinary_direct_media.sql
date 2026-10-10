begin;
alter table public.direct_conversations add column media_assets jsonb not null default '{}'::jsonb;
-- The verified upload handler registers Cloudinary asset references, never client-supplied URLs.
create function public.register_direct_media(target uuid,actor uuid,ref text,format text) returns void language plpgsql security definer set search_path='' as $$
begin
 if actor is null or ref is null or ref !~ ('^cloudinary:direct_messages/'||target::text||'/'||actor::text||'/[0-9a-f-]{36}$') or format not in('jpg','jpeg','png','webp') then raise exception 'Invalid asset';end if;
 update public.direct_conversations c set media_assets=media_assets||jsonb_build_object(ref,jsonb_build_object('owner',actor,'format',format)) where c.id=target and actor in(c.user_low,c.user_high) and (c.status='accepted' or (c.status='pending' and c.initiated_by=actor and not exists(select 1 from public.direct_messages m where m.conversation_id=c.id)));
 if not found then raise exception 'Upload not allowed' using errcode='42501';end if;
end$$;
create function public.release_direct_media(target uuid,actor uuid,ref text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.direct_conversations c set media_assets=media_assets-ref where c.id=target and c.media_assets->ref->>'owner'=actor::text and not exists(select 1 from public.direct_messages m where m.conversation_id=c.id and ref=any(m.attachments));
 return found;
end$$;
revoke all on function public.register_direct_media(uuid,uuid,text,text),public.release_direct_media(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.register_direct_media(uuid,uuid,text,text),public.release_direct_media(uuid,uuid,text) to service_role;
create or replace function public.send_direct_message(target_user uuid,body text,media text[] default '{}',message_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
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
  if path like 'cloudinary:%' then
   if c.media_assets->path->>'owner' is distinct from actor::text then raise exception 'Invalid attachment' using errcode='42501';end if;
  elsif path not like c.id::text||'/'||actor::text||'/%' or not exists(select 1 from storage.objects where bucket_id='direct-message-media' and name=path) then raise exception 'Invalid attachment' using errcode='42501';end if;
 end loop;
 insert into public.direct_messages(id,conversation_id,sender_id,content,attachments) values(message_id,c.id,actor,body,media);
 update public.direct_conversations set updated_at=now(),read_low=case when user_low=actor then now() else read_low end,read_high=case when user_high=actor then now() else read_high end where id=c.id;
 return c.id;
end$$;

-- New DM uploads go to Cloudinary. Previously sent storage files stay readable.
drop policy dm_media_upload on storage.objects;
drop policy dm_media_write_guard on storage.objects;
create policy dm_media_write_guard on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'direct-message-media');
commit;
