-- Store a post's hashtag references with that post. The dictionary remains a
-- single source of tag identities; legacy read endpoints remain compatible.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.posts,public.post_hashtags,public.hashtags in share row exclusive mode;
alter table public.posts add column hashtag_links jsonb not null default '{}'::jsonb
 check(jsonb_typeof(hashtag_links)='object');
update public.posts p set hashtag_links=s.links from (
 select post_id,jsonb_object_agg(hashtag_id::text,to_jsonb(created_at)) links
 from public.post_hashtags group by post_id
) s where p.id=s.post_id;
do $$ begin
 if exists(select 1 from public.post_hashtags h left join public.posts p on p.id=h.post_id
  where p.id is null or not(p.hashtag_links?h.hashtag_id::text)
   or (p.hashtag_links->>h.hashtag_id::text)::timestamptz is distinct from h.created_at) or
 (select count(*) from public.post_hashtags)<>(select coalesce(sum(jsonb_object_length_compat.n),0) from public.posts p
  cross join lateral(select count(*) n from jsonb_each(p.hashtag_links)) jsonb_object_length_compat) then
  raise exception 'Post hashtag preservation mismatch';
 end if;
end $$;

-- Detach/rebind this known dependent view in the same transaction. No CASCADE.
create or replace view public.trending_hashtags with(security_invoker=true) as
 select h.tag,count(*)::integer as posts_24h from public.posts p
 cross join lateral jsonb_each_text(p.hashtag_links) link
 join public.hashtags h on h.id=link.key::uuid
 where link.value::timestamptz>now()-interval '24 hours' and p.community_id is null and p.visibility='public'
 group by h.tag order by count(*)::integer desc limit 20;
drop table public.post_hashtags;
create view public.post_hashtags with(security_invoker=true) as
 select p.id as post_id,link.key::uuid as hashtag_id,link.value::timestamptz as created_at
 from public.posts p cross join lateral jsonb_each_text(p.hashtag_links) link;
revoke all on public.post_hashtags from public,anon,authenticated,service_role;
grant select on public.post_hashtags to anon,authenticated,service_role;
grant insert,delete on public.post_hashtags to authenticated,service_role;

create or replace function public.sync_post_hashtags() returns trigger
language plpgsql set search_path='' as $$
declare m text;hid uuid;links jsonb:='{}'::jsonb;
begin
 -- Preserve the existing content parser; this migration only changes storage.
 for m in select distinct lower(substring(t.x[1] from 2))
  from regexp_matches(new.content,'#([a-zA-Z0-9_]{1,50})','g') as t(x)
 loop
  insert into public.hashtags(tag) values(m) on conflict(tag) do update set tag=excluded.tag returning id into hid;
  links:=links||jsonb_build_object(hid::text,now());
 end loop;
 new.hashtag_links:=links;
 return new;
end $$;
drop trigger sync_post_hashtags_ins on public.posts;
create trigger sync_post_hashtags_ins before insert or update of content on public.posts
 for each row execute function public.sync_post_hashtags();

-- Retain foreign-key-equivalent checks for direct writes and tag deletion.
create function public.validate_post_hashtag_links() returns trigger
language plpgsql set search_path='' as $$
declare link record;
begin
 for link in select * from jsonb_each_text(new.hashtag_links) loop
  if not exists(select 1 from public.hashtags h where h.id=link.key::uuid) then
   raise exception 'Unknown hashtag' using errcode='23503';
  end if;
  if link.value is null then raise exception 'Missing hashtag timestamp' using errcode='23502';end if;
  perform link.value::timestamptz;
 end loop;
 return new;
end $$;
create trigger zz_validate_post_hashtag_links before insert or update of hashtag_links,content on public.posts
 for each row execute function public.validate_post_hashtag_links();
create function public.remove_deleted_hashtag_links() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.posts set hashtag_links=hashtag_links-old.id::text where hashtag_links?old.id::text;
 return old;
end $$;
create trigger remove_deleted_hashtag_links after delete on public.hashtags
 for each row execute function public.remove_deleted_hashtag_links();

-- Existing ownership and suspension rules still govern legacy writes.
create function public.write_post_hashtag_link() returns trigger
language plpgsql set search_path='' as $$
declare owner_id uuid;target uuid:=case when tg_op='DELETE' then old.post_id else new.post_id end;
begin
 if public.is_account_suspended(auth.uid()) then raise exception 'ACCOUNT_SUSPENDED' using errcode='42501';end if;
 select user_id into owner_id from public.posts where id=target for update;
 if not found then raise exception 'Post not found' using errcode='23503';end if;
 if current_user in ('anon','authenticated') and (auth.uid() is null or owner_id is distinct from auth.uid()) then
  raise exception 'Cannot change another post' using errcode='42501';
 end if;
 if tg_op='DELETE' then
  update public.posts set hashtag_links=hashtag_links-old.hashtag_id::text where id=old.post_id;
  return old;
 end if;
 new.created_at:=coalesce(new.created_at,now());
 update public.posts set hashtag_links=hashtag_links||jsonb_build_object(new.hashtag_id::text,new.created_at)
 where id=new.post_id and not(hashtag_links?new.hashtag_id::text);
 if not found then raise exception 'Duplicate hashtag link' using errcode='23505';end if;
 return new;
end $$;
create trigger write_post_hashtag_link instead of insert or delete on public.post_hashtags
 for each row execute function public.write_post_hashtag_link();

-- This RPC previously inserted into the join table with ON CONFLICT. Views do
-- not provide that operation, so write the same additional references directly.
create or replace function public.create_post_with_hashtags(p_user_id uuid,p_content text,p_image_urls text[] default '{}'::text[])
returns uuid language plpgsql set search_path='' as $$
declare v_post_id uuid;v_tag text;v_tag_id uuid;links jsonb:='{}'::jsonb;
begin
 insert into public.posts(user_id,content,image_urls) values(p_user_id,p_content,p_image_urls) returning id into v_post_id;
 for v_tag in select distinct lower(substring(t from 2)) from regexp_split_to_table(p_content,'\s+') t where t~'^#[[:alnum:]_]+$'
 loop
  insert into public.hashtags(tag) values(v_tag) on conflict(tag) do update set tag=excluded.tag returning id into v_tag_id;
  links:=links||jsonb_build_object(v_tag_id::text,now());
 end loop;
 update public.posts p set hashtag_links=links||p.hashtag_links where p.id=v_post_id;
 return v_post_id;
end $$;
revoke all on function public.validate_post_hashtag_links(),public.remove_deleted_hashtag_links() from public,anon,authenticated;
grant execute on function public.write_post_hashtag_link() to authenticated,service_role;
revoke all on function public.write_post_hashtag_link() from public,anon;
notify pgrst,'reload schema';
commit;
