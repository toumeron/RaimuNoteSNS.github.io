begin;
set local lock_timeout='3s';
-- Legacy owner-rights views bypassed otherwise-correct post policies.
do $$declare view_name text;begin
 for view_name in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'
 loop execute format('alter view public.%I set (security_invoker=true)',view_name);end loop;
end$$;
alter table public.hashtags enable row level security;
alter table public.post_hashtags enable row level security;
revoke insert,update,delete on public.hashtags,public.post_hashtags from public,anon,authenticated;
grant select on public.hashtags,public.post_hashtags to anon,authenticated;
grant insert on public.hashtags,public.post_hashtags to authenticated;
-- Older posting RPCs perform a no-op ON CONFLICT UPDATE to retrieve the tag ID.
grant update(tag) on public.hashtags to authenticated;
grant delete on public.post_hashtags to authenticated;
create policy security_hashtag_insert on public.hashtags as restrictive for insert to anon,authenticated
 with check(auth.uid() is not null and char_length(tag::text) between 1 and 100);
create policy security_hashtag_update on public.hashtags as restrictive for update to anon,authenticated
 using(auth.uid() is not null) with check(auth.uid() is not null);
create policy security_post_hashtag_read on public.post_hashtags as restrictive for select to anon,authenticated
 using(exists(select 1 from public.posts p where p.id=post_hashtags.post_id));
create policy security_post_hashtag_insert on public.post_hashtags as restrictive for insert to anon,authenticated
 with check(exists(select 1 from public.posts p where p.id=post_hashtags.post_id and p.user_id=auth.uid()));
create policy post_hashtag_owner_delete on public.post_hashtags for delete to authenticated
 using(exists(select 1 from public.posts p where p.id=post_hashtags.post_id and p.user_id=auth.uid()));
create policy security_post_hashtag_delete on public.post_hashtags as restrictive for delete to anon,authenticated
 using(exists(select 1 from public.posts p where p.id=post_hashtags.post_id and p.user_id=auth.uid()));
create function limenote_security.guard_shared_hashtag() returns trigger language plpgsql set search_path='' as $$begin
 if current_user in('anon','authenticated') and row(new.id,new.tag,new.created_at) is distinct from row(old.id,old.tag,old.created_at) then
  raise exception 'Shared hashtags cannot be renamed' using errcode='42501';end if;
 return new;
end$$;
revoke all on function limenote_security.guard_shared_hashtag() from public,anon,authenticated;
create trigger security_shared_hashtag before update on public.hashtags for each row execute function limenote_security.guard_shared_hashtag();

-- This older RPC checked visibility='public' but ignored protected accounts.
alter function public.get_profile_reply_comments(uuid,integer) security invoker;
-- A recipient may accept/decline, never rewrite the sender or original post.
revoke update on public.lime_drops from public,anon,authenticated;
do $$declare col text;begin
 for col in select column_name from information_schema.columns where table_schema='public' and table_name='lime_drops'
 loop execute format('revoke update (%I) on public.lime_drops from public,anon,authenticated',col);end loop;
end$$;
grant update(status) on public.lime_drops to authenticated;
create policy security_drop_pending on public.lime_drops as restrictive for insert to anon,authenticated
 with check(sender_id=auth.uid() and status='pending');
create policy security_drop_update on public.lime_drops as restrictive for update to anon,authenticated
 using(recipient_id=auth.uid() and status='pending') with check(recipient_id=auth.uid() and status in('accepted','declined'));
create or replace function public.can_limedrop(sender uuid,recipient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select sender=auth.uid() and sender<>recipient and (
  exists(select 1 from public.profiles p where p.id=sender and p.is_official) or (
  exists(select 1 from public.follows f where f.follower_id=sender and f.followee_id=recipient and f.approved)
  and exists(select 1 from public.follows f where f.follower_id=recipient and f.followee_id=sender and f.approved)));
$$;
revoke all on function public.can_limedrop(uuid,uuid) from public,anon;
grant execute on function public.can_limedrop(uuid,uuid) to authenticated;

-- Trigger functions cannot legitimately be invoked as a public RPC.
do $$declare routine record;begin
 for routine in select p.oid::regprocedure signature,p.prorettype from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 loop
  if routine.prorettype in('trigger'::regtype,'event_trigger'::regtype) then
   execute format('revoke execute on function %s from public,anon,authenticated',routine.signature);
  end if;
 end loop;
 for routine in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and pg_has_role(current_user,p.proowner,'USAGE')
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 and not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%')
 loop execute format('alter function %s set search_path=pg_catalog,public,extensions,net,pg_temp',routine.signature);end loop;
end$$;
revoke all on function public.delete_old_news() from public,anon,authenticated;
grant execute on function public.delete_old_news() to service_role;
update storage.buckets set file_size_limit=10485760,allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif','image/avif'] where id in('avatars','covers','posts');
notify pgrst,'reload schema';
commit;
