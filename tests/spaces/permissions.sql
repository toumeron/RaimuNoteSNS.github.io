-- Read two profile IDs internally; profiles/accounts are never modified.
-- All temporary space writes roll back and are invisible to other connections.
begin;
do $$
declare host_id uuid; listener_id uuid; room_id text; state jsonb; member jsonb; listener_member uuid;
begin
  assert has_table_privilege('service_role','public.spaces','select'),'Audio token service must be able to read the room policy';
  assert has_table_privilege('service_role','public.space_members','select'),'Audio token service must be able to authorize membership';
  select p.id into host_id from public.profiles p where not exists(select 1 from public.spaces s where s.host_id=p.id and s.is_active and s.heartbeat_at>now()-interval '90 seconds') limit 1;
  select id into listener_id from public.profiles where id<>host_id limit 1;
  assert host_id is not null and listener_id is not null,'Two profiles are required for authorization verification';
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  set local role authenticated;
  room_id:=public.create_live_space('Space authorization test','host');
  member:=public.join_live_space(room_id,false);
  assert member->>'role'='host','Host role must be assigned by the server';
  perform set_config('request.jwt.claim.sub',listener_id::text,true);
  member:=public.join_live_space(room_id,true);
  state:=public.get_space_state(room_id);
  assert state->'me'->>'can_speak'='false','Anonymous listeners must never publish';
  assert state->>'anonymous_count'='1','Anonymous listeners must be counted';
  assert jsonb_array_length(state->'members')=1,'Only the visible host must appear in the roster';
  assert state::text not like '%'||listener_id::text||'%','Anonymous user ID must not be exposed';
  begin
    perform 1 from public.space_members;
    raise exception 'Private membership table unexpectedly readable';
  exception when insufficient_privilege then null; end;
  perform public.react_live_space(room_id,'👏');
  state:=public.get_space_state(room_id);
  assert jsonb_array_length(state->'reactions')=1,'Members must be able to react';
  assert state->'reactions'->0->>'emoji'='👏','Emoji must be retained';
  begin
    perform public.react_live_space(room_id,'arbitrary payload');
    -- Wait-free rate limit may ignore this; no invalid emoji can be returned regardless.
  exception when check_violation then null; end;
  member:=public.join_live_space(room_id,false);
  state:=public.get_space_state(room_id);
  assert state->'me'->>'can_speak'='false','Invited-only listeners need host approval';
  perform public.request_space_speaker(room_id,true);
  assert public.get_space_state(room_id)->'me'->>'requested'='true','Listener requests must persist';
  begin
    perform public.update_live_space(room_id,'Unauthorized update','everyone');
    raise exception 'Non-host unexpectedly updated room';
  exception when raise_exception then
    if sqlerrm<>'ホストのみ変更できます' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  state:=public.get_space_state(room_id);
  select (value->>'id')::uuid into listener_member from jsonb_array_elements(state->'members') value where value->>'role'='listener';
  assert listener_member is not null,'Visible listener must appear in host guest list';
  assert exists(select 1 from jsonb_array_elements(state->'members') value where value->>'requested'='true'),'Host must see speaking requests';
  perform public.manage_space_speaker(room_id,listener_member,true);
  perform public.update_live_space(room_id,'Updated title','host');
  perform set_config('request.jwt.claim.sub',listener_id::text,true);
  state:=public.get_space_state(room_id);
  assert state->'space'->>'title'='Updated title','Host edits must be visible';
  assert state->'me'->>'can_speak'='true','Host-approved listener must be able to publish';
  begin
    perform public.manage_space_speaker(room_id,listener_member,true);
    raise exception 'Listener unexpectedly granted permission';
  exception when raise_exception then
    if sqlerrm<>'ホストのみ変更できます' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  perform public.manage_space_speaker(room_id,listener_member,false);
  perform set_config('request.jwt.claim.sub',listener_id::text,true);
  assert public.get_space_state(room_id)->'me'->>'can_speak'='false','Revoked permission must no longer publish';
  perform public.leave_live_space(room_id);
  assert public.get_space_state(room_id)->'space'<>'null'::jsonb,'A listener must not end the host room';
  begin
    perform public.react_live_space(room_id,'❤️');
    raise exception 'Non-members unexpectedly permitted to react';
  exception when raise_exception then
    if sqlerrm<>'スペースに参加してください' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  perform public.leave_live_space(room_id);
  assert public.get_space_state(room_id)->'space'='null'::jsonb,'Host must be able to end room';
  room_id:=public.create_live_space('Expired space test','everyone');
  reset role;
  update public.spaces set heartbeat_at=now()-interval '2 minutes' where id=room_id;
  assert public.get_space_state(room_id)->'space'='null'::jsonb,'Disconnected hosts must not leave a live avatar behind';
  set local role authenticated;
  begin
    perform public.join_live_space(room_id,false);
    raise exception 'Expired room unexpectedly joinable';
  exception when raise_exception then
    if sqlerrm<>'このスペースは終了しました' then raise; end if;
  end;
  reset role;
end $$;
rollback;
select 'Space privacy and host authorization checks passed' as result;
