begin;
-- Preference/role edits do not change counts. Invited users accept their own invitations.
create or replace function public.community_member_count() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and old.community_id=new.community_id and old.status=new.status then return null;end if;
 if tg_op<>'INSERT' and old.status='active' then update public.communities set member_count=member_count-1 where id=old.community_id;end if;
 if tg_op<>'DELETE' and new.status='active' then update public.communities set member_count=member_count+1 where id=new.community_id;end if;
 return null;
end$$;
create or replace function public.community_action(cid uuid,operation text,target uuid default null,enabled boolean default false) returns void language plpgsql security definer set search_path='' as $$
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
 elsif operation='approve' and other.status='pending' then update public.community_members set status='active' where community_id=cid and user_id=target;
 elsif operation='remove' then update public.community_members set status='banned',pinned=false,spotlight=false,notifications=false where community_id=cid and user_id=target;
 elsif operation='reject' and other.status in('pending','invited') then delete from public.community_members where community_id=cid and user_id=target;
 elsif operation in('promote','demote') and own.role='owner' and other.status='active' then update public.community_members set role=case when operation='promote' then 'moderator' else 'member' end where community_id=cid and user_id=target;
 else raise exception 'この操作は実行できません';end if;
end$$;
create function public.remove_community_post(post_id uuid) returns void language plpgsql security definer set search_path='' as $$declare cid uuid;begin
 select community_id into cid from public.posts where id=post_id;
 if cid is null or not public.community_manager(cid) then raise exception 'このポストを管理する権限がありません';end if;
 delete from public.posts where id=post_id and community_id=cid;
end$$;
revoke all on function public.remove_community_post(uuid) from public;
grant execute on function public.remove_community_post(uuid) to authenticated;
commit;
