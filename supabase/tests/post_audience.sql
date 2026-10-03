begin;
select set_config('test.audience_post', (select id::text from public.posts where visibility = 'public' and parent_id is null limit 1), true);
select set_config('test.audience_author', (select user_id::text from public.posts where id::text = current_setting('test.audience_post')), true);
select set_config('test.audience_allowed', (select id::text from public.profiles where id::text <> current_setting('test.audience_author') order by created_at limit 1), true);
select set_config('test.audience_follower', (select id::text from public.profiles where id::text not in (current_setting('test.audience_author'), current_setting('test.audience_allowed')) order by created_at limit 1), true);
-- Temporary audience relationships, restored by ROLLBACK.
delete from public.follows where
  (follower_id::text = current_setting('test.audience_author') and followee_id::text in (current_setting('test.audience_allowed'), current_setting('test.audience_follower')))
  or (followee_id::text = current_setting('test.audience_author') and follower_id::text in (current_setting('test.audience_allowed'), current_setting('test.audience_follower')));
insert into public.follows (follower_id, followee_id) values
  (current_setting('test.audience_author')::uuid, current_setting('test.audience_allowed')::uuid),
  (current_setting('test.audience_follower')::uuid, current_setting('test.audience_author')::uuid);
update public.posts set visibility = 'following' where id::text = current_setting('test.audience_post');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.audience_allowed'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.posts where id::text = current_setting('test.audience_post')) then
    raise exception 'The user followed by the author cannot read the restricted post';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.audience_follower'), 'role', 'authenticated')::text, true);
do $$ begin
  if exists (select 1 from public.posts where id::text = current_setting('test.audience_post')) then
    raise exception 'A follower of the author can read the restricted post';
  end if;
  if exists (select 1 from public.reposts where post_id::text = current_setting('test.audience_post')) then
    raise exception 'A restricted post leaks through the profile repost table';
  end if;
  if exists (select 1 from public.comments where post_id::text = current_setting('test.audience_post')) then
    raise exception 'A restricted post leaks through its replies';
  end if;
  if exists (
    select 1 from public.posts quote join public.posts original on original.id = quote.parent_id
    where original.id::text = current_setting('test.audience_post')
  ) then
    raise exception 'A restricted original leaks through a quote join';
  end if;
  begin
    insert into public.reposts (post_id, user_id) values (
      current_setting('test.audience_post')::uuid, current_setting('test.audience_follower')::uuid
    );
    raise exception 'An unauthorized viewer can repost a restricted post';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.audience_author'), 'role', 'authenticated')::text, true);
do $$ begin
  if not exists (select 1 from public.posts where id::text = current_setting('test.audience_post')) then
    raise exception 'The author cannot read their own restricted post';
  end if;
end $$;
set local role anon;
select set_config('request.jwt.claims', '{}', true);
do $$ begin
  if exists (select 1 from public.posts where id::text = current_setting('test.audience_post')) then
    raise exception 'An anonymous viewer can read the restricted post';
  end if;
end $$;
rollback;
