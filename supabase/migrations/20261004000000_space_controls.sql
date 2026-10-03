begin;
alter table public.spaces drop constraint spaces_speaker_policy_check;
alter table public.spaces add constraint spaces_speaker_policy_check check(speaker_policy in ('everyone','host','following'));
alter table public.space_members add column approved boolean not null default false;
alter table public.space_members add column requested boolean not null default false;
alter table public.space_members add column muted boolean not null default true;
alter table public.space_reactions drop constraint space_reactions_emoji_check;
alter table public.space_reactions add constraint space_reactions_emoji_check check(emoji in ('❤️','👏','😂','🎉','👍','🔥','😲','😢','💜','💯','✊','👎','👋','✋'));

create function public.can_publish_live_space(p_space_id text,p_user_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from spaces s join space_members m on m.space_id=s.id
 where s.id=p_space_id and s.is_active and s.heartbeat_at>now()-interval '90 seconds'
 and m.user_id=p_user_id and not m.anonymous and m.heartbeat_at>now()-interval '90 seconds'
 and (s.host_id=p_user_id or m.approved or s.speaker_policy='everyone' or
 (s.speaker_policy='following' and exists(select 1 from follows f where f.follower_id=s.host_id and f.followee_id=p_user_id))));
$$;
revoke all on function public.can_publish_live_space(text,uuid) from public;
grant execute on function public.can_publish_live_space(text,uuid) to service_role;

create or replace function public.get_space_state(p_space_id text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room jsonb; members jsonb; reactions jsonb; hidden integer; own jsonb;
begin
 select value into room from jsonb_array_elements(list_live_spaces()) value where value->>'id'=p_space_id;
 if room is null then return jsonb_build_object('space',null,'members','[]'::jsonb,'anonymous_count',0,'reactions','[]'::jsonb,'me',null); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'display_name',p.display_name,'username',p.username,'avatar_url',p.avatar_url,'role',m.role,'muted',m.muted,'rtc_uid',m.rtc_uid,
 'requested',case when (room->>'host_id')::uuid=auth.uid() then m.requested else false end)
 order by case m.role when 'host' then 0 when 'speaker' then 1 else 2 end,m.id),'[]'::jsonb) into members
 from space_members m join profiles p on p.id=m.user_id where m.space_id=p_space_id and not m.anonymous and m.heartbeat_at>now()-interval '90 seconds';
 select jsonb_build_object('can_speak',can_publish_live_space(p_space_id,auth.uid()),'requested',requested,'role',role) into own
 from space_members where space_id=p_space_id and user_id=auth.uid() and heartbeat_at>now()-interval '90 seconds';
 select count(*) into hidden from space_members where space_id=p_space_id and anonymous and heartbeat_at>now()-interval '90 seconds';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'emoji',emoji,'created_at',created_at) order by created_at),'[]'::jsonb) into reactions
 from (select id,emoji,created_at from space_reactions where space_id=p_space_id and created_at>now()-interval '8 seconds' order by created_at desc limit 30) r;
 return jsonb_build_object('space',room,'members',members,'anonymous_count',hidden,'reactions',reactions,'me',own);
end; $$;

create or replace function public.create_live_space(p_title text,p_policy text default 'everyone') returns text language plpgsql security definer set search_path=public as $$
declare room_id text;
begin
 if auth.uid() is null then raise exception 'ログインしてください'; end if;
 if p_policy not in ('everyone','host','following') or length(trim(p_title)) not between 1 and 100 then raise exception 'スペース名を1〜100文字で入力してください'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if exists(select 1 from spaces where host_id=auth.uid() and is_active and heartbeat_at>now()-interval '90 seconds') then raise exception '開催中のスペースを終了してください'; end if;
 update spaces set is_active=false where host_id=auth.uid() and is_active;
 room_id:=gen_random_uuid()::text;
 insert into spaces(id,host_id,title,speaker_policy) values(room_id,auth.uid(),trim(p_title),p_policy);
 return room_id;
end; $$;

create function public.update_live_space(p_space_id text,p_title text,p_policy text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_policy not in ('everyone','host','following') or length(trim(p_title)) not between 1 and 100 then raise exception '入力内容を確認してください'; end if;
 update spaces set title=trim(p_title),speaker_policy=p_policy where id=p_space_id and host_id=auth.uid() and is_active and heartbeat_at>now()-interval '90 seconds';
 if not found then raise exception 'ホストのみ変更できます'; end if;
end; $$;
create function public.request_space_speaker(p_space_id text,p_requested boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 update space_members m set requested=p_requested where m.space_id=p_space_id and m.user_id=auth.uid() and not m.anonymous and m.role='listener'
 and m.heartbeat_at>now()-interval '90 seconds' and exists(select 1 from spaces s where s.id=p_space_id and s.is_active and s.heartbeat_at>now()-interval '90 seconds');
 if not found then raise exception '発言をリクエストできません'; end if;
end; $$;
create function public.manage_space_speaker(p_space_id text,p_member_id uuid,p_allow boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from spaces where id=p_space_id and host_id=auth.uid() and is_active and heartbeat_at>now()-interval '90 seconds') then raise exception 'ホストのみ変更できます'; end if;
 update space_members set approved=p_allow,requested=false,role=case when p_allow then role else 'listener' end,muted=case when p_allow then muted else true end
 where id=p_member_id and space_id=p_space_id and not anonymous and user_id<>auth.uid() and heartbeat_at>now()-interval '90 seconds';
 if not found then raise exception '参加者が見つかりません'; end if;
end; $$;
create function public.set_space_microphone(p_space_id text,p_muted boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 update space_members set muted=p_muted where space_id=p_space_id and user_id=auth.uid() and role in ('host','speaker') and not anonymous
 and can_publish_live_space(p_space_id,auth.uid());
 if not found then raise exception 'マイクを変更できません'; end if;
end; $$;
revoke all on function public.update_live_space(text,text,text),public.request_space_speaker(text,boolean),public.manage_space_speaker(text,uuid,boolean),public.set_space_microphone(text,boolean) from public;
grant execute on function public.update_live_space(text,text,text),public.request_space_speaker(text,boolean),public.manage_space_speaker(text,uuid,boolean),public.set_space_microphone(text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
