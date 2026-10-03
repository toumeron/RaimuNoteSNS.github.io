-- Exercise the linked database under the same authenticated role as the app.
-- All fixture rows and count changes are rolled back.
begin;
select set_config('test.repost_post_id', (select id::text from public.posts where visibility = 'public' and parent_id is null limit 1), true);
select set_config('test.repost_user_id', (select id::text from public.profiles order by created_at limit 1), true);
select set_config('test.repost_other_user_id', (select id::text from public.profiles where id::text <> current_setting('test.repost_user_id') limit 1), true);
select set_config('test.repost_initial_count', (select coalesce(reposts_count, 0)::text from public.posts where id::text = current_setting('test.repost_post_id')), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.repost_user_id'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare post_uuid uuid := current_setting('test.repost_post_id')::uuid;
        user_uuid uuid := current_setting('test.repost_user_id')::uuid;
        other_uuid uuid := current_setting('test.repost_other_user_id')::uuid;
        initial_count bigint := current_setting('test.repost_initial_count')::bigint;
begin
  if post_uuid is null or user_uuid is null or other_uuid is null then
    raise exception 'Required public post and profile fixtures not available';
  end if;
  insert into public.reposts (post_id, user_id) values (post_uuid, user_uuid);
  if not exists (select 1 from public.reposts where post_id = post_uuid and user_id = user_uuid) then
    raise exception 'Inserted repost is not visible';
  end if;
  if (select reposts_count from public.posts where id = post_uuid) <> initial_count + 1 then
    raise exception 'Repost count did not increase atomically';
  end if;
  begin
    insert into public.reposts (post_id, user_id) values (post_uuid, user_uuid);
    raise exception 'Duplicate repost was allowed';
  exception when unique_violation then null;
  end;
  begin
    insert into public.reposts (post_id, user_id) values (post_uuid, other_uuid);
    raise exception 'Another user repost was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', other_uuid, 'role', 'authenticated')::text, true);
  delete from public.reposts where post_id = post_uuid and user_id = user_uuid;
  if not exists (select 1 from public.reposts where post_id = post_uuid and user_id = user_uuid) then
    raise exception 'Another user could delete the repost';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', user_uuid, 'role', 'authenticated')::text, true);
  delete from public.reposts where post_id = post_uuid and user_id = user_uuid;
  if exists (select 1 from public.reposts where post_id = post_uuid and user_id = user_uuid) then
    raise exception 'Repost cancellation failed';
  end if;
  if (select reposts_count from public.posts where id = post_uuid) <> initial_count then
    raise exception 'Repost count did not return to its initial value';
  end if;
end $$;
rollback;
