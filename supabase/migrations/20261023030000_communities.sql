begin;
create table public.communities(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 80),
 description text not null default '' check(char_length(description)<=2000),
 category text not null default 'その他' check(char_length(category) between 1 and 40),
 cover_url text not null default '' check(cover_url='' or cover_url ~ '^https://res[.]cloudinary[.]com/[^/]+/image/upload/'),
 rules text[] not null default '{}' check(cardinality(rules)<=10 and char_length(array_to_string(rules,''))<=5000),
 join_mode text not null default 'open' check(join_mode in('open','approval')),
 member_count integer not null default 0 check(member_count>=0),
 created_at timestamptz not null default now()
);
create table public.community_members(
 community_id uuid not null references public.communities(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null default 'member' check(role in('owner','moderator','member')),
 status text not null default 'active' check(status in('active','pending','invited','banned')),
 pinned boolean not null default false,
 spotlight boolean not null default false,
 notifications boolean not null default false,
 created_at timestamptz not null default now(),
 primary key(community_id,user_id)
);
create index community_members_user on public.community_members(user_id,status);
create unique index community_spotlight_unique on public.community_members(user_id) where spotlight;
create index communities_category on public.communities(category,created_at desc);
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
revoke all on public.communities,public.community_members from anon,authenticated;
grant select on public.communities to anon,authenticated;
grant insert,delete on public.communities to authenticated;
grant update(name,description,category,cover_url,rules,join_mode) on public.communities to authenticated;
grant select(community_id,user_id,role,status,created_at) on public.community_members to anon,authenticated;
create function public.community_manager(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.community_members where community_id=cid and user_id=auth.uid() and status='active' and role in('owner','moderator'))
$$;
revoke all on function public.community_manager(uuid) from public;
grant execute on function public.community_manager(uuid) to authenticated;
create policy community_read on public.communities for select using(true);
create policy community_create on public.communities for insert to authenticated with check(owner_id=auth.uid() and member_count=0);
create policy community_edit on public.communities for update to authenticated using(public.community_manager(id)) with check(public.community_manager(id));
create policy community_delete on public.communities for delete to authenticated using(owner_id=auth.uid());
create policy community_members_read on public.community_members for select using(status='active' or user_id=auth.uid() or public.community_manager(community_id));
-- RLS helper is also called while anonymous users read public member lists.
grant execute on function public.community_manager(uuid) to anon;
create function public.community_member_count() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op<>'INSERT' and old.status='active' then update public.communities set member_count=member_count-1 where id=old.community_id;end if;
 if tg_op<>'DELETE' and new.status='active' then update public.communities set member_count=member_count+1 where id=new.community_id;end if;
 return null;
end$$;
create trigger community_member_count after insert or update or delete on public.community_members for each row execute function public.community_member_count();
create function public.community_owner_join() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.community_members(community_id,user_id,role) values(new.id,new.owner_id,'owner');return new;
end$$;
create trigger community_owner_join after insert on public.communities for each row execute function public.community_owner_join();
create function public.my_community_memberships() returns setof public.community_members language sql stable security definer set search_path='' as $$select * from public.community_members where user_id=auth.uid()$$;
revoke all on function public.my_community_memberships() from public;
grant execute on function public.my_community_memberships() to authenticated;
create function public.community_action(cid uuid,operation text,target uuid default null,enabled boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.communities;own public.community_members;other public.community_members;begin
 if actor is null then raise exception 'ログインしてください';end if;
 select * into c from public.communities where id=cid for update;
 if not found then raise exception 'コミュニティが見つかりません';end if;
 select * into own from public.community_members where community_id=cid and user_id=actor;
 if operation='join' then
  if own.status='banned' then raise exception 'このコミュニティには参加できません';end if;
  if own.status='active' then return;end if;
  insert into public.community_members(community_id,user_id,status) values(cid,actor,case when c.join_mode='open' or own.status='invited' then 'active' else 'pending' end)
  on conflict(community_id,user_id) do update set status=excluded.status;return;
 elsif operation='leave' then
  if own.role='owner' then raise exception '管理者は退会できません。コミュニティの管理から削除できます';end if;
  if own.status='banned' then return;end if;
  delete from public.community_members where community_id=cid and user_id=actor;return;
 elsif operation in('pin','spotlight','notifications') then
  if own.status is distinct from 'active' then raise exception '参加してから設定してください';end if;
  -- Lock the profile so two concurrent spotlight requests cannot select two communities.
  if operation='spotlight' then perform 1 from public.profiles where id=actor for update;
   if enabled then update public.community_members set spotlight=false where user_id=actor and spotlight;end if;
   update public.community_members set spotlight=enabled where community_id=cid and user_id=actor;
  elsif operation='pin' then update public.community_members set pinned=enabled where community_id=cid and user_id=actor;
  else update public.community_members set notifications=enabled where community_id=cid and user_id=actor;end if;return;
 end if;
 if not public.community_manager(cid) then raise exception '管理権限がありません';end if;
 if target is null or target=c.owner_id then raise exception 'このメンバーは変更できません';end if;
 select * into other from public.community_members where community_id=cid and user_id=target;
 if other.role='moderator' and own.role<>'owner' then raise exception '管理者のみ変更できます';end if;
 if operation='invite' then
  if other.status is not null then raise exception 'すでに招待または参加しています';end if;
  insert into public.community_members(community_id,user_id,status) values(cid,target,'invited');
 elsif operation='approve' and other.status in('pending','invited') then update public.community_members set status='active' where community_id=cid and user_id=target;
 elsif operation='remove' then update public.community_members set status='banned',pinned=false,spotlight=false,notifications=false where community_id=cid and user_id=target;
 elsif operation='reject' and other.status in('pending','invited') then delete from public.community_members where community_id=cid and user_id=target;
 elsif operation in('promote','demote') and own.role='owner' and other.status='active' then update public.community_members set role=case when operation='promote' then 'moderator' else 'member' end where community_id=cid and user_id=target;
 else raise exception 'この操作は実行できません';end if;
end$$;
revoke all on function public.community_action(uuid,text,uuid,boolean) from public;
grant execute on function public.community_action(uuid,text,uuid,boolean) to authenticated;
-- Spotlight is deliberately public; notification/pin preferences are never exposed.
create function public.community_spotlight(profile_id uuid) returns setof public.communities language sql stable security definer set search_path='' as $$
 select c.* from public.communities c join public.community_members m on m.community_id=c.id where m.user_id=profile_id and m.status='active' and m.spotlight
$$;
revoke all on function public.community_spotlight(uuid) from public;
grant execute on function public.community_spotlight(uuid) to anon,authenticated;
alter table public.posts add column community_id uuid references public.communities(id) on delete cascade;
create index posts_community_latest on public.posts(community_id,created_at desc,id desc) where community_id is not null;
create function public.validate_community_post() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and new.community_id is distinct from old.community_id then raise exception '投稿先は変更できません';end if;
 if new.community_id is null then return new;end if;
 if not exists(select 1 from public.community_members where community_id=new.community_id and user_id=new.user_id and status='active') then raise exception '参加中のメンバーだけが投稿できます';end if;
 if coalesce(new.visibility,'public')<>'public' then raise exception 'コミュニティの投稿は公開ポストです';end if;
 if exists(select 1 from unnest(new.image_urls) u where u !~ '^https://res[.]cloudinary[.]com/[^/]+/image/upload/') then raise exception 'コミュニティの画像はCloudinaryに保存してください';end if;
 return new;
end$$;
create trigger validate_community_post before insert or update of community_id,image_urls,visibility on public.posts for each row execute function public.validate_community_post();
create function public.validate_community_comment() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.posts where id=new.post_id and community_id is not null) then return new;end if;
 if not exists(select 1 from public.posts p join public.community_members m on m.community_id=p.community_id where p.id=new.post_id and m.user_id=new.user_id and m.status='active') then raise exception '参加中のメンバーだけが返信できます';end if;
 if exists(select 1 from unnest(new.image_urls) u where u !~ '^https://res[.]cloudinary[.]com/[^/]+/image/upload/') then raise exception 'コミュニティの画像はCloudinaryに保存してください';end if;return new;
end$$;
create trigger validate_community_comment before insert or update of post_id,image_urls on public.comments for each row execute function public.validate_community_comment();
revoke all on function public.validate_community_comment() from public;
create function public.notify_community_post() returns trigger language plpgsql security definer set search_path='' as $$declare member record;begin
 if new.community_id is null then return new;end if;
 for member in select user_id from public.community_members where community_id=new.community_id and status='active' and notifications loop
  perform public.create_activity_notification(member.user_id,new.user_id,'new_post',new.id,null,null,'new_post:'||new.id);end loop;return new;
end$$;
create trigger notify_community_post after insert on public.posts for each row execute function public.notify_community_post();
revoke all on function public.community_member_count(),public.community_owner_join(),public.validate_community_post(),public.notify_community_post() from public;
commit;
