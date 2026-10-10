-- Include invited AI friends in the public group member count.
create or replace function public.get_group_direct_invitation(token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',coalesce(nullif(group_name,''),'グループ'),'avatarUrl',group_avatar,'memberCount',((select count(*) from jsonb_each(group_members) where value->>'status'<>'removed')+(select count(*) from jsonb_each(group_friends)))) from public.direct_conversations where is_group and invite_token=token and length(token)=64;
$$;
