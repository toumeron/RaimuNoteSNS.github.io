begin;
alter table public.spaces add column waiting_ended_at timestamptz;
-- Older rooms have no reliable first-microphone history. Do not restart music in them.
update public.spaces set waiting_ended_at=now();

create or replace function public.get_space_state(p_space_id text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room jsonb; members jsonb; reactions jsonb; hidden integer; own jsonb;
begin
 select value into room from jsonb_array_elements(list_live_spaces()) value where value->>'id'=p_space_id;
 if room is null then return jsonb_build_object('waiting',false,'space',null,'members','[]'::jsonb,'anonymous_count',0,'reactions','[]'::jsonb,'me',null); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'display_name',p.display_name,'username',p.username,'avatar_url',p.avatar_url,'role',m.role,'muted',m.muted,'rtc_uid',m.rtc_uid,
 'requested',case when (room->>'host_id')::uuid=auth.uid() then m.requested else false end)
 order by case m.role when 'host' then 0 when 'speaker' then 1 else 2 end,m.id),'[]'::jsonb) into members
 from space_members m join profiles p on p.id=m.user_id where m.space_id=p_space_id and not m.anonymous and m.heartbeat_at>now()-interval '90 seconds';
 select jsonb_build_object('can_speak',can_publish_live_space(p_space_id,auth.uid()),'requested',requested,'role',role) into own
 from space_members where space_id=p_space_id and user_id=auth.uid() and heartbeat_at>now()-interval '90 seconds';
 select count(*) into hidden from space_members where space_id=p_space_id and anonymous and heartbeat_at>now()-interval '90 seconds';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'emoji',emoji,'created_at',created_at) order by created_at),'[]'::jsonb) into reactions
 from (select id,emoji,created_at from space_reactions where space_id=p_space_id and created_at>now()-interval '8 seconds' order by created_at desc limit 30) r;
 return jsonb_build_object('waiting',(select waiting_ended_at is null from spaces where id=p_space_id),'space',room,'members',members,'anonymous_count',hidden,'reactions',reactions,'me',own);
end; $$;

create or replace function public.set_space_microphone(p_space_id text,p_muted boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 update space_members set muted=p_muted where space_id=p_space_id and user_id=auth.uid() and role in ('host','speaker') and not anonymous
 and can_publish_live_space(p_space_id,auth.uid());
 if not found then raise exception 'マイクを変更できません'; end if;
 if not p_muted then
   update spaces set waiting_ended_at=coalesce(waiting_ended_at,now()) where id=p_space_id;
 end if;
end; $$;
notify pgrst,'reload schema';
commit;
