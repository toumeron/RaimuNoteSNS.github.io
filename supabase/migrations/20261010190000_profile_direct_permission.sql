begin;
-- Expose only whether the signed-in viewer can open a conversation, not private settings.
create function public.can_direct_message(target_user uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();c public.direct_conversations;
begin
 if actor is null or target_user is null or actor=target_user or not exists(select 1 from public.profiles where id=target_user) then return false;end if;
 select * into c from public.direct_conversations where user_low=least(actor,target_user) and user_high=greatest(actor,target_user);
 if c.id is not null then return c.status<>'declined';end if;
 return (exists(select 1 from public.follows where follower_id=actor and followee_id=target_user and approved) and exists(select 1 from public.follows where follower_id=target_user and followee_id=actor and approved)) or coalesce((select dm_requests from public.profile_private_settings where user_id=target_user),'everyone')='everyone';
end$$;
revoke all on function public.can_direct_message(uuid) from public,anon;
grant execute on function public.can_direct_message(uuid) to authenticated;
commit;
