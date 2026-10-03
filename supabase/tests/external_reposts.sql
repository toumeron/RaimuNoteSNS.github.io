begin;
select set_config('test.external_viewer', (select id::text from public.profiles order by created_at limit 1), true);
select set_config('test.external_other', (select id::text from public.profiles where id::text <> current_setting('test.external_viewer') limit 1), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.external_viewer'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  viewer uuid := current_setting('test.external_viewer')::uuid;
  other_user uuid := current_setting('test.external_other')::uuid;
  source_id text := 'bsky:at://did:plc:fixture/app.bsky.feed.post/test';
  snapshot jsonb := jsonb_build_object('id',source_id,'visibility','public');
begin
  insert into public.external_reposts(post_id,user_id,post_snapshot) values(source_id,viewer,snapshot);
  if not exists(select 1 from public.external_reposts where post_id=source_id and user_id=viewer) then raise exception 'Own share not visible'; end if;
  begin
    insert into public.external_reposts(post_id,user_id,post_snapshot) values(source_id,other_user,snapshot);
    raise exception 'Another viewer share allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.external_reposts(post_id,user_id,post_snapshot) values(source_id||'private',viewer,jsonb_build_object('id',source_id||'private','visibility','following'));
    raise exception 'Nonpublic snapshot allowed';
  exception when check_violation then null; end;
  delete from public.external_reposts where post_id=source_id and user_id=viewer;
  if exists(select 1 from public.external_reposts where post_id=source_id and user_id=viewer) then raise exception 'Undo failed'; end if;
end $$;
rollback;
