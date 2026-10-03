begin;
alter table public.spaces add column if not exists speaker_policy text not null default 'everyone' check (speaker_policy in ('everyone','host'));
alter table public.spaces add column if not exists heartbeat_at timestamptz not null default now();
create table public.space_members (
  id uuid primary key default gen_random_uuid(), space_id text not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rtc_uid integer not null default (1 + floor(random()*2147483646))::integer,
  anonymous boolean not null default false, role text not null default 'listener' check (role in ('host','speaker','listener')),
  heartbeat_at timestamptz not null default now(), unique(space_id,user_id), unique(space_id,rtc_uid)
);
create table public.space_reactions (
  id uuid primary key default gen_random_uuid(), space_id text not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('❤️','👏','😂','🎉','👍','🔥')), created_at timestamptz not null default now()
);
create index on public.space_reactions(space_id,created_at);
alter table public.space_members enable row level security;
alter table public.space_reactions enable row level security;
revoke all on public.space_members, public.space_reactions from public, anon, authenticated;
grant all on public.space_members, public.space_reactions to service_role;
-- Participant identities are never exposed directly, including anonymous identities.
create function public.list_live_spaces() returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'host_id',s.host_id,'speaker_policy',s.speaker_policy,
    'profiles',jsonb_build_object('display_name',p.display_name,'username',p.username,'avatar_url',p.avatar_url)) order by s.created_at desc),'[]'::jsonb)
  from spaces s join profiles p on p.id=s.host_id where s.is_active and s.heartbeat_at > now()-interval '90 seconds';
$$;
create function public.get_space_state(p_space_id text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare room jsonb; members jsonb; reactions jsonb; hidden integer;
begin
  select value into room from jsonb_array_elements(list_live_spaces()) value where value->>'id'=p_space_id;
  if room is null then return jsonb_build_object('space',null,'members','[]'::jsonb,'anonymous_count',0,'reactions','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'display_name',p.display_name,'avatar_url',p.avatar_url,'role',m.role)
    order by case m.role when 'host' then 0 when 'speaker' then 1 else 2 end),'[]'::jsonb) into members
    from space_members m join profiles p on p.id=m.user_id where m.space_id=p_space_id and not m.anonymous and m.heartbeat_at>now()-interval '90 seconds';
  select count(*) into hidden from space_members where space_id=p_space_id and anonymous and heartbeat_at>now()-interval '90 seconds';
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'emoji',emoji,'created_at',created_at) order by created_at),'[]'::jsonb) into reactions
    from (select id,emoji,created_at from space_reactions where space_id=p_space_id and created_at>now()-interval '8 seconds' order by created_at desc limit 30) r;
  return jsonb_build_object('space',room,'members',members,'anonymous_count',hidden,'reactions',reactions);
end; $$;
create function public.create_live_space(p_title text,p_policy text default 'everyone') returns text language plpgsql security definer set search_path=public as $$
declare room_id text;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  if p_policy not in ('everyone','host') or length(trim(p_title)) not between 1 and 100 then raise exception 'スペース名を1〜100文字で入力してください'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if exists(select 1 from spaces where host_id=auth.uid() and is_active and heartbeat_at>now()-interval '90 seconds') then raise exception '開催中のスペースを終了してください'; end if;
  update spaces set is_active=false where host_id=auth.uid() and is_active;
  room_id:=gen_random_uuid()::text;
  insert into spaces(id,host_id,title,speaker_policy) values(room_id,auth.uid(),trim(p_title),p_policy);
  return room_id;
end; $$;
create function public.join_live_space(p_space_id text,p_anonymous boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare room spaces; member space_members;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  select * into room from spaces where id=p_space_id and is_active and heartbeat_at>now()-interval '90 seconds';
  if not found then raise exception 'このスペースは終了しました'; end if;
  insert into space_members(space_id,user_id,anonymous,role) values(p_space_id,auth.uid(),p_anonymous and room.host_id<>auth.uid(),case when room.host_id=auth.uid() then 'host' else 'listener' end)
    on conflict(space_id,user_id) do update set anonymous=excluded.anonymous,role=excluded.role,heartbeat_at=now() returning * into member;
  return jsonb_build_object('rtc_uid',member.rtc_uid,'role',member.role,'anonymous',member.anonymous);
end; $$;
create function public.heartbeat_live_space(p_space_id text) returns void language plpgsql security definer set search_path=public as $$
begin
  update space_members set heartbeat_at=now() where space_id=p_space_id and user_id=auth.uid();
  if found then update spaces set heartbeat_at=now() where id=p_space_id and host_id=auth.uid() and is_active; end if;
end; $$;
create function public.leave_live_space(p_space_id text) returns void language plpgsql security definer set search_path=public as $$
begin
  update spaces set is_active=false where id=p_space_id and host_id=auth.uid();
  delete from space_members where space_id=p_space_id and (user_id=auth.uid() or exists(select 1 from spaces where id=p_space_id and host_id=auth.uid()));
end; $$;
create function public.react_live_space(p_space_id text,p_emoji text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from space_members m join spaces s on s.id=m.space_id where m.space_id=p_space_id and m.user_id=auth.uid() and m.heartbeat_at>now()-interval '90 seconds' and s.is_active and s.heartbeat_at>now()-interval '90 seconds') then raise exception 'スペースに参加してください'; end if;
  if exists(select 1 from space_reactions where space_id=p_space_id and user_id=auth.uid() and created_at>now()-interval '1 second') then return; end if;
  insert into space_reactions(space_id,user_id,emoji) values(p_space_id,auth.uid(),p_emoji);
  delete from space_reactions where created_at<now()-interval '1 day';
end; $$;
revoke all on function public.list_live_spaces(),public.get_space_state(text),public.create_live_space(text,text),public.join_live_space(text,boolean),public.heartbeat_live_space(text),public.leave_live_space(text),public.react_live_space(text,text) from public;
grant execute on function public.list_live_spaces(),public.get_space_state(text) to anon,authenticated;
grant execute on function public.create_live_space(text,text),public.join_live_space(text,boolean),public.heartbeat_live_space(text),public.leave_live_space(text),public.react_live_space(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
