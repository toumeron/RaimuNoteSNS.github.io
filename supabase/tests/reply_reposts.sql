begin;
do $$ begin
  if exists (
    select 1 from pg_constraint k
    where k.conrelid='public.reply_reposts'::regclass and k.contype='p' and cardinality(k.conkey)>1
  ) then raise exception 'Composite reply share primary key makes author embeds ambiguous'; end if;
  if not exists (
    select 1 from pg_constraint k
    where k.conrelid='public.reply_reposts'::regclass and k.contype='u' and k.conname='reply_reposts_comment_user_key'
  ) then raise exception 'Reply share uniqueness missing'; end if;
end $$;
select set_config('test.reply_root', (select id::text from public.posts where visibility='public' and parent_id is null limit 1), true);
select set_config('test.reply_author', (select user_id::text from public.posts where id::text=current_setting('test.reply_root')), true);
select set_config('test.reply_viewer', (select id::text from public.profiles where id::text<>current_setting('test.reply_author') limit 1), true);
select set_config('test.reply_id', gen_random_uuid()::text, true);
select set_config('test.reply_root_count', (select reposts_count::text from public.posts where id::text=current_setting('test.reply_root')), true);
insert into public.comments(id,post_id,user_id,content) values(current_setting('test.reply_id')::uuid,current_setting('test.reply_root')::uuid,current_setting('test.reply_author')::uuid,'Temporary reply repost regression fixture');
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.reply_viewer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  insert into public.reply_reposts(comment_id,user_id) values(current_setting('test.reply_id')::uuid,auth.uid());
  if not exists(select 1 from public.reply_reposts where comment_id::text=current_setting('test.reply_id')) then raise exception 'Reply share missing'; end if;
  begin
    insert into public.reply_reposts(comment_id,user_id) values(current_setting('test.reply_id')::uuid,current_setting('test.reply_author')::uuid);
    raise exception 'Another user reply share allowed';
  exception when insufficient_privilege then null; end;
  insert into public.posts(user_id,content,visibility,quoted_reply_id) values(auth.uid(),'Temporary reply quote fixture','public',current_setting('test.reply_id')::uuid);
  if (select reposts_count from public.posts where id::text=current_setting('test.reply_root')) <> current_setting('test.reply_root_count')::int then raise exception 'Reply shares incremented root count'; end if;
  delete from public.reply_reposts where comment_id::text=current_setting('test.reply_id') and user_id=auth.uid();
  if exists(select 1 from public.reply_reposts where comment_id::text=current_setting('test.reply_id')) then raise exception 'Undo failed'; end if;
  insert into public.reply_reposts(comment_id,user_id) values(current_setting('test.reply_id')::uuid,auth.uid());
end $$;
reset role;
delete from public.follows where follower_id::text=current_setting('test.reply_author') and followee_id::text=current_setting('test.reply_viewer');
update public.posts set visibility='following' where id::text=current_setting('test.reply_root');
set local role authenticated;
do $$ begin
  if exists(select 1 from public.comments where id::text=current_setting('test.reply_id')) then raise exception 'Private source reply visible'; end if;
  if exists(select 1 from public.reply_reposts where comment_id::text=current_setting('test.reply_id')) then raise exception 'Private source leaks through reply repost'; end if;
  begin
    insert into public.reply_reposts(comment_id,user_id) values(current_setting('test.reply_id')::uuid,auth.uid());
    raise exception 'Private reply share allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
