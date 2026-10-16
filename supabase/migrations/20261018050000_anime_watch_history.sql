begin;
set local lock_timeout='3s';
-- Public records belong to profiles; private deletion metadata stays in the existing settings row.
alter table public.profiles add column anime_history jsonb not null default '[]'::jsonb;
alter table public.profiles add constraint anime_history_entries check (jsonb_typeof(anime_history)='array' and jsonb_array_length(anime_history)<=1000 and octet_length(anime_history::text)<=2097152);
alter table public.profile_private_settings add column anime_history jsonb not null default '{"ignored":[],"autoAdd":true}'::jsonb;
alter table public.profile_private_settings add constraint anime_history_metadata check (jsonb_typeof(anime_history)='object' and jsonb_typeof(anime_history->'ignored')='array' and jsonb_array_length(anime_history->'ignored')<=1000 and jsonb_typeof(anime_history->'autoAdd')='boolean');
create function public.get_anime_history(target_user uuid default auth.uid(),target_username text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entries jsonb;metadata jsonb:='{"ignored":[],"autoAdd":false}'::jsonb;
begin
 if target_username is not null then select id into target_user from public.profiles where username=target_username;end if;
 select anime_history into entries from public.profiles where id=target_user;
 if entries is null then raise exception 'プロフィールが見つかりません';end if;
 if auth.uid()=target_user then select anime_history into metadata from public.profile_private_settings where user_id=target_user;metadata:=coalesce(metadata,'{"ignored":[],"autoAdd":true}'::jsonb);end if;
 return metadata||jsonb_build_object('entries',entries,'ownerId',target_user);
end;$$;
create function public.update_anime_history(operation text,records jsonb default '[]'::jsonb,record_id text default null,enabled boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();state jsonb;entries jsonb;ignored jsonb;item jsonb;previous jsonb;item_id text;stamp timestamptz;
begin
 if actor is null then raise exception 'ログインしてください' using errcode='42501';end if;
 if public.is_account_suspended(actor) then raise exception 'ACCOUNT_SUSPENDED: 凍結中は視聴履歴を変更できません' using errcode='42501';end if;
 if operation is null or operation not in('save','delete','auto') then raise exception '操作が無効です';end if;
 insert into public.profile_private_settings(user_id) values(actor) on conflict(user_id) do nothing;
 select anime_history into entries from public.profiles where id=actor for update;
 select anime_history into state from public.profile_private_settings where user_id=actor for update;
 ignored:=state->'ignored';
 if operation='auto' then
  if enabled is null then raise exception '設定が無効です';end if;
  state:=jsonb_set(state,'{autoAdd}',to_jsonb(enabled));
 elsif operation='delete' then
  if record_id is null or length(record_id)>300 then raise exception '記録が無効です';end if;
  entries:=(select coalesce(jsonb_agg(e),'[]') from jsonb_array_elements(entries) e where e->>'id'<>record_id);
  ignored:=(select coalesce(jsonb_agg(v),'[]') from (select v from (select record_id v union select jsonb_array_elements_text(ignored)) d order by v limit 1000) x);
 else
  if records is null or jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>50 or octet_length(records::text)>262144 then raise exception '一度に保存できるのは50件までです';end if;
  for item in select value from jsonb_array_elements(records) loop
   item_id:=item->>'id';
   if jsonb_typeof(item) is distinct from 'object' or item_id is null or length(item_id)>300
    or item_id not like 'annict:%' or jsonb_typeof(item->'work') is distinct from 'object'
    or coalesce(item->'work'->>'id','') !~ '^[1-9][0-9]{0,9}$'
    or item_id not like 'annict:'||(item->'work'->>'id')||':%'
    or jsonb_typeof(item->'work'->'title') is distinct from 'string' or length(item->'work'->>'title') not between 1 and 300
    or coalesce(item->>'source','') not in('manual','post','primevideo','danime','niconico','abema')
    or coalesce(length(item->>'episodeText'),0)>300 or octet_length(item::text)>8192
    or (coalesce(item->'work'->>'image','')<>'' and item->'work'->>'image' !~ '^https://[^[:space:]]+$')
    or (coalesce(item->>'sourceUrl','')<>'' and item->>'sourceUrl' !~ '^https://[^[:space:]]+$')
   then raise exception '視聴履歴の内容が無効です';end if;
   if item->>'source'='post' then
    if not (state->>'autoAdd')::boolean or ignored ? item_id then continue;end if;
    if not exists(select 1 from public.posts where id::text=item->>'postId' and user_id=actor) then raise exception 'ポストの所有者が一致しません' using errcode='42501';end if;
   end if;
   if item->>'watchedAt' is not null then
    stamp:=(item->>'watchedAt')::timestamptz;
    if stamp>clock_timestamp()+interval '1 day' or stamp<'1900-01-01'::timestamptz then raise exception '視聴日時が無効です';end if;
   end if;
   select e into previous from jsonb_array_elements(entries) e where e->>'id'=item_id limit 1;
   -- A mention cannot overwrite a confirmed viewing or an explicit choice.
   if previous is not null and item->>'source'='post' then continue;end if;
   if previous is not null and item->>'source' not in('manual','post') and previous->>'source'<>'post'
      and coalesce(previous->>'watchedAt','')>coalesce(item->>'watchedAt','') then continue;end if;
   item:=item||jsonb_build_object('addedAt',coalesce(previous->>'addedAt',clock_timestamp()::text));
   entries:=(select coalesce(jsonb_agg(e),'[]') from jsonb_array_elements(entries) e where e->>'id'<>item_id)||jsonb_build_array(item);
   if item->>'source'<>'post' then ignored:=(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements_text(ignored) v where v<>item_id);end if;
  end loop;
 end if;
 if jsonb_array_length(entries)>1000 then raise exception '視聴履歴は1,000件までです。不要な履歴を整理してください';end if;
 entries:=(select coalesce(jsonb_agg(e order by coalesce(e->>'watchedAt',e->>'addedAt') desc,e->>'id'),'[]') from jsonb_array_elements(entries) e);
 state:=state||jsonb_build_object('entries',entries,'ignored',ignored);
 update public.profiles set anime_history=entries where id=actor;
 update public.profile_private_settings set anime_history=state-'entries' where user_id=actor;
 return state;
end;$$;
revoke all on function public.get_anime_history(uuid,text),public.update_anime_history(text,jsonb,text,boolean) from public,anon;
grant execute on function public.get_anime_history(uuid,text) to anon,authenticated;
grant execute on function public.update_anime_history(text,jsonb,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
