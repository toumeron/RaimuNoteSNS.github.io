begin;
do $$
declare
  author uuid := (select id from public.profiles order by created_at limit 1);
  root uuid := gen_random_uuid(); quote uuid := gen_random_uuid(); nested uuid := gen_random_uuid();
begin
  insert into public.posts(id,user_id,content,visibility,is_quote) values(root,author,'Repost count fixture','public',false);
  insert into public.posts(id,user_id,content,visibility,parent_id,is_quote) values(quote,author,'Quote fixture','public',root,true);
  if (select reposts_count from public.posts where id=root) <> 1 then raise exception 'Direct quote not counted'; end if;
  if (select coalesce(reposts_count,0) from public.posts where id=quote) <> 0 then raise exception 'Quote inherited source count'; end if;
  insert into public.reposts(post_id,user_id) values(quote,author);
  if (select reposts_count from public.posts where id=quote) <> 1 then raise exception 'Quote repost not counted on quote'; end if;
  if (select reposts_count from public.posts where id=root) <> 1 then raise exception 'Quote repost propagated to root'; end if;
  insert into public.posts(id,user_id,content,visibility,parent_id,is_quote) values(nested,author,'Nested fixture','public',quote,true);
  if (select reposts_count from public.posts where id=quote) <> 2 then raise exception 'Nested quote not counted on quote'; end if;
  if (select reposts_count from public.posts where id=root) <> 1 then raise exception 'Nested quote propagated to root'; end if;
  delete from public.reposts where post_id=quote and user_id=author;
  delete from public.posts where id=nested;
  if (select coalesce(reposts_count,0) from public.posts where id=quote) <> 0 then raise exception 'Quote undo count incorrect'; end if;
  if (select reposts_count from public.posts where id=root) <> 1 then raise exception 'Undo affected source count'; end if;
end $$;
rollback;
