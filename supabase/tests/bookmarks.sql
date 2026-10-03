begin;
select set_config('test.bookmark_author', (select id::text from public.profiles order by id limit 1), true);
select set_config('test.bookmark_viewer', (select id::text from public.profiles where id::text <> current_setting('test.bookmark_author') order by id limit 1), true);
select set_config('test.bookmark_post', gen_random_uuid()::text, true);
select set_config('test.bookmark_reply', gen_random_uuid()::text, true);
insert into public.posts(id,user_id,content,visibility) values(current_setting('test.bookmark_post')::uuid,current_setting('test.bookmark_author')::uuid,'Temporary bookmark privacy fixture','public');
insert into public.comments(id,post_id,user_id,content) values(current_setting('test.bookmark_reply')::uuid,current_setting('test.bookmark_post')::uuid,current_setting('test.bookmark_author')::uuid,'Temporary reply bookmark fixture');
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.bookmark_viewer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  insert into public.bookmarks(user_id,post_id) values(auth.uid(),current_setting('test.bookmark_post')::uuid);
  insert into public.bookmarks(user_id,comment_id) values(auth.uid(),current_setting('test.bookmark_reply')::uuid);
  insert into public.bookmarks(user_id,external_id,external_snapshot) values(auth.uid(),'bsky:at://test/bookmark','{"id":"bsky:at://test/bookmark","visibility":"public"}');
  if (select count(*) from public.bookmarks where user_id=auth.uid()) < 3 then raise exception 'Bookmark save failed'; end if;
  begin
    insert into public.bookmarks(user_id,post_id) values(current_setting('test.bookmark_author')::uuid,current_setting('test.bookmark_post')::uuid);
    raise exception 'Another account bookmark write allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.bookmarks(user_id,external_id,external_snapshot) values(auth.uid(),'bsky:at://test/private','{"id":"bsky:at://test/private","visibility":"following"}');
    raise exception 'Restricted external snapshot accepted';
  exception when check_violation then null; end;
  begin
    insert into public.bookmarks(user_id,external_id,external_snapshot) values(auth.uid(),'bsky:at://test/missing',null);
    raise exception 'Missing external snapshot accepted';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.bookmark_author'),'role','authenticated')::text,true);
do $$ begin
  if exists(select 1 from public.bookmarks where user_id::text=current_setting('test.bookmark_viewer')) then raise exception 'Other account bookmarks visible'; end if;
  delete from public.bookmarks where user_id::text=current_setting('test.bookmark_viewer');
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.bookmarks where user_id::text=current_setting('test.bookmark_viewer') and post_id::text=current_setting('test.bookmark_post')) then raise exception 'Other account deleted a bookmark'; end if;
end $$;
update public.posts set visibility='following' where id::text=current_setting('test.bookmark_post');
delete from public.follows where follower_id::text=current_setting('test.bookmark_author') and followee_id::text=current_setting('test.bookmark_viewer');
insert into public.follows(follower_id,followee_id) values(current_setting('test.bookmark_viewer')::uuid,current_setting('test.bookmark_author')::uuid) on conflict do nothing;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.bookmark_viewer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.posts where id::text=current_setting('test.bookmark_post')) then raise exception 'Bookmark revealed a restricted post after access revocation'; end if;
  if exists(select 1 from public.comments where id::text=current_setting('test.bookmark_reply')) then raise exception 'Bookmark revealed a restricted reply after access revocation'; end if;
  delete from public.bookmarks where post_id::text=current_setting('test.bookmark_post');
  begin
    insert into public.bookmarks(user_id,post_id) values(auth.uid(),current_setting('test.bookmark_post')::uuid);
    raise exception 'Bookmarking an inaccessible post allowed';
  exception when insufficient_privilege then null; end;
  delete from public.bookmarks where comment_id::text=current_setting('test.bookmark_reply');
  begin
    insert into public.bookmarks(user_id,comment_id) values(auth.uid(),current_setting('test.bookmark_reply')::uuid);
    raise exception 'Bookmarking an inaccessible reply allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.follows(follower_id,followee_id) values(current_setting('test.bookmark_author')::uuid,current_setting('test.bookmark_viewer')::uuid) on conflict do nothing;
set local role authenticated;
insert into public.bookmarks(user_id,post_id) values(auth.uid(),current_setting('test.bookmark_post')::uuid);
reset role;
delete from public.posts where id::text=current_setting('test.bookmark_post');
do $$ begin
  if exists(select 1 from public.bookmarks where post_id::text=current_setting('test.bookmark_post') or comment_id::text=current_setting('test.bookmark_reply')) then raise exception 'Deleted source bookmarks were not cleaned up'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.bookmarks;
    raise exception 'Anonymous access to private bookmarks allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
