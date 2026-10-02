-- Run after the migration. Everything, including post-count trigger effects,
-- is rolled back; no test reply becomes visible to users.
begin;
do $$
declare
  root_post uuid;
  other_post uuid;
  author uuid;
  first_reply uuid := gen_random_uuid();
  second_reply uuid := gen_random_uuid();
  third_reply uuid := gen_random_uuid();
  rejected boolean;
begin
  select id, user_id into root_post, author from public.posts limit 1;
  select id into other_post from public.posts where id <> root_post limit 1;
  if root_post is null or other_post is null then raise exception 'Need two existing posts for the transactional test'; end if;

  insert into public.comments(id, post_id, user_id, content) values(first_reply, root_post, author, 'transactional thread test');
  insert into public.comments(id, post_id, user_id, content, parent_comment_id) values(second_reply, root_post, author, 'reply to reply', first_reply);
  insert into public.comments(id, post_id, user_id, content, parent_comment_id, image_urls) values(third_reply, root_post, author, '', second_reply, array['https://example.com/test.png']);

  rejected := false;
  begin
    insert into public.comments(post_id, user_id, content, parent_comment_id) values(other_post, author, 'invalid', first_reply);
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Cross-post parent accepted'; end if;

  rejected := false;
  begin
    update public.comments set parent_comment_id = third_reply where id = first_reply;
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Cyclic parent accepted'; end if;

  rejected := false;
  begin
    insert into public.comments(post_id, user_id, content, image_urls) values(root_post, author, '', array_fill('https://example.com/test.png'::text, array[5]));
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'Five images accepted'; end if;

  delete from public.comments where id = second_reply;
  if not exists(select 1 from public.comments where id = third_reply and parent_comment_id is null) then
    raise exception 'Deleting a parent must preserve its replies';
  end if;
end $$;
rollback;
select 'comment thread constraints passed; all test data rolled back' as result;
