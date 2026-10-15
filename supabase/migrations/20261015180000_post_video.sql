begin;
set local lock_timeout='3s';
-- Only metadata extends posts; all video/image poster bytes live in the private object bucket.
alter table public.posts add column if not exists video jsonb;
create or replace function public.validate_post_video(media jsonb,owner_id uuid,post_id uuid) returns void
language plpgsql immutable set search_path='' as $$
begin
 if media is null or media='null'::jsonb then return;end if;
 if jsonb_typeof(media)<>'object' or coalesce(media->>'mimeType','')<>'video/mp4'
  or coalesce(media->>'key','') !~ ('^'||owner_id::text||'/'||post_id::text||'/[0-9a-f-]{36}\.mp4$')
  or coalesce((media->>'duration')::numeric,0)<=0 or (media->>'duration')::numeric>90
  or least(coalesce((media->>'width')::int,0),coalesce((media->>'height')::int,0))<2
  or least((media->>'width')::int,(media->>'height')::int)>720 or greatest((media->>'width')::int,(media->>'height')::int)>1280
  or coalesce((media->>'size')::int,0) not between 1 and 37748736
  or (media ? 'posterKey' and media->>'posterKey'<>regexp_replace(media->>'key','\.mp4$','.jpg'))
 then raise exception '動画の情報が無効です';end if;
end;$$;
create or replace function public.guard_post_video() returns trigger language plpgsql set search_path='' as $$
begin
 perform public.validate_post_video(new.video,new.user_id,new.id);
 if new.video is not null and new.video<>'null'::jsonb and (cardinality(new.image_urls)>0 or new.poll is not null) then raise exception '動画は画像・投票と同時に添付できません';end if;
 return new;
end;$$;
do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='public.posts'::regclass and tgname='validate_post_video' and not tgisinternal) then
  create trigger validate_post_video before insert or update of video,user_id,id,image_urls,poll on public.posts for each row execute function public.guard_post_video();
 end if;
end;$$;
create or replace function public.save_scheduled_post(post_id uuid,send_at timestamptz,payload jsonb default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();queue jsonb;entry jsonb;
begin
 if actor is null then raise exception 'ログインしてください' using errcode='42501';end if;
 if public.is_account_suspended(actor) then raise exception 'ACCOUNT_SUSPENDED: 凍結中は予約投稿できません' using errcode='42501';end if;
 if send_at is null or send_at<clock_timestamp()+interval '1 minute' or send_at>clock_timestamp()+interval '366 days' then raise exception '予約日時は1分後から1年以内で指定してください';end if;
 insert into public.profile_private_settings(user_id) values(actor) on conflict(user_id) do nothing;
 select scheduled_posts into queue from public.profile_private_settings where user_id=actor for update;
 if payload is null then
  entry:=queue->post_id::text;if entry is null then raise exception '予約投稿が見つかりません';end if;
  payload:=entry->'payload';
 else
  if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'content') is distinct from 'string' or length(payload->>'content')>500
   or jsonb_typeof(payload->'image_urls') is distinct from 'array' or jsonb_array_length(payload->'image_urls')>4
   or (length(trim(payload->>'content'))=0 and jsonb_array_length(payload->'image_urls')=0 and (payload->'video' is null or payload->'video'='null'::jsonb))
   or coalesce(payload->>'visibility','public') not in('public','following','members') then raise exception '予約投稿の内容が無効です';end if;
  if exists(select 1 from jsonb_array_elements_text(payload->'image_urls') image where image not like 'storage://post-media/'||actor::text||'/'||post_id::text||'/%') then raise exception '予約画像の所有者が一致しません';end if;
  if payload->'video' is not null and payload->'video'<>'null'::jsonb then perform public.validate_post_video(payload->'video',actor,post_id);end if;
  if queue ? post_id::text then raise exception '予約投稿は日時変更またはキャンセルで管理してください';end if;
  if (select count(*) from jsonb_each(queue))>=50 then raise exception '予約投稿は50件までです';end if;
 end if;
 update public.profile_private_settings set scheduled_posts=jsonb_set(queue,array[post_id::text],jsonb_build_object('id',post_id,'scheduledAt',send_at,'status','pending','payload',payload)) where user_id=actor;
end;$$;
create or replace function public.publish_scheduled_posts() returns integer language plpgsql security definer set search_path='' as $$
declare settings record;queued record;body jsonb;queue jsonb;sent integer:=0;failure text;
begin
 for settings in select p.user_id,p.scheduled_posts from public.profile_private_settings p
 where exists(select 1 from jsonb_each(p.scheduled_posts) e where e.value->>'status'='pending' and (e.value->>'scheduledAt')::timestamptz<=clock_timestamp())
 order by p.user_id limit 100 for update skip locked
 loop
  queue:=settings.scheduled_posts;
  for queued in select key,value from jsonb_each(queue) where value->>'status'='pending' and (value->>'scheduledAt')::timestamptz<=clock_timestamp()
  loop
   body:=queued.value->'payload';
   begin
    if public.is_account_suspended(settings.user_id) then raise exception '凍結中のため送信できません。解除後に予約日時を設定し直してください';end if;
    insert into public.posts(id,user_id,content,image_urls,visibility,client_name,parent_id,quoted_reply_id,quoted_external_post,is_quote,is_bot,poll,map_latitude,map_longitude,video)
    values(queued.key::uuid,settings.user_id,body->>'content',array(select jsonb_array_elements_text(body->'image_urls')),coalesce(body->>'visibility','public'),body->>'client_name',nullif(body->>'parent_id','')::uuid,nullif(body->>'quoted_reply_id','')::uuid,body->'quoted_external_post',coalesce((body->>'is_quote')::boolean,false),false,body->'poll',(body->>'map_latitude')::double precision,(body->>'map_longitude')::double precision,body->'video');
    insert into public.mentions(post_id,mentioned_user_id)
    select queued.key::uuid,p.id from public.profiles p where p.username in(select m[1] from regexp_matches(body->>'content','@([a-zA-Z0-9_]+)','g') m) on conflict do nothing;
    queue:=queue-queued.key;sent:=sent+1;
   exception when others then
    get stacked diagnostics failure=message_text;
    queue:=jsonb_set(queue,array[queued.key],queued.value||jsonb_build_object('status','failed','error',left(failure,300)));
   end;
  end loop;
  update public.profile_private_settings set scheduled_posts=queue where user_id=settings.user_id;
 end loop;
 return sent;
end;$$;
revoke all on function public.validate_post_video(jsonb,uuid,uuid),public.guard_post_video() from public;
grant execute on function public.validate_post_video(jsonb,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
