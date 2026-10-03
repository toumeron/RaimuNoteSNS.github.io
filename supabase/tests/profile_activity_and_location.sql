begin;
select set_config('test.activity_post', (select id::text from public.posts where visibility='public' and parent_id is null limit 1), true);
select set_config('test.activity_author', (select user_id::text from public.posts where id::text=current_setting('test.activity_post')), true);
select set_config('test.activity_total', public.get_profile_activity_count(current_setting('test.activity_author')::uuid)::text, true);
update public.posts set visibility='following' where id::text=current_setting('test.activity_post');
update public.profiles set location='ホットプレート <script>test</script>' where id::text=current_setting('test.activity_author');
do $$ begin
  if not exists(select 1 from public.profiles where id::text=current_setting('test.activity_author') and location='ホットプレート <script>test</script>') then
    raise exception 'Freeform location was not saved';
  end if;
  begin
    update public.profiles set location=repeat('x',101) where id::text=current_setting('test.activity_author');
    raise exception 'Overlong location was accepted';
  exception when check_violation then null;
  end;
end $$;
set local role anon;
select set_config('request.jwt.claims', '{}', true);
do $$ begin
  if current_setting('test.activity_author')='' or current_setting('test.activity_total')::bigint<1 then
    raise exception 'Missing test author/post fixture';
  end if;
  if public.get_profile_activity_count(current_setting('test.activity_author')::uuid) <> current_setting('test.activity_total')::bigint then
    raise exception 'Audience restrictions changed the published activity total';
  end if;
  if exists(select 1 from public.posts where id::text=current_setting('test.activity_post')) then
    raise exception 'The aggregate function exposed a restricted post';
  end if;
  if exists(select 1 from public.comments where post_id::text=current_setting('test.activity_post')) then
    raise exception 'The aggregate function exposed restricted replies';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('test.activity_author'),'role','authenticated')::text,true);
do $$ begin
  if public.get_profile_activity_count(current_setting('test.activity_author')::uuid) <> current_setting('test.activity_total')::bigint then
    raise exception 'The author sees a different activity total';
  end if;
end $$;
rollback;
