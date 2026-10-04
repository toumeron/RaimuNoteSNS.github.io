begin;
do $$
begin
  if public.news_sources_are_public('limenote',array['missing-or-private']) then raise exception 'Missing sources were published'; end if;
  if public.news_sources_are_public('limenote','{}') then raise exception 'Empty sources were published'; end if;
  if public.news_sources_are_public('bluesky',array['private-lime-id']) then raise exception 'Wrong source accepted'; end if;
  if not public.news_sources_are_public('bluesky',array['bsky:at://did:plc:test/app.bsky.feed.post/test']) then raise exception 'Bluesky source rejected'; end if;
end $$;
insert into public.news_summaries(id,title,content,category,source,public_sources_verified,source_post_ids)
values('fdfe0100-0000-0000-0000-000000000001','privacy test','hidden','test','limenote',false,'{}'),
('fdfe0100-0000-0000-0000-000000000002','privacy test','hidden','test','limenote',true,array['missing-or-private']);
set local role anon;
do $$
begin
 if exists(select 1 from public.news_summaries where id in ('fdfe0100-0000-0000-0000-000000000001','fdfe0100-0000-0000-0000-000000000002')) then raise exception 'Unsafe news visible to anonymous reader'; end if;
end $$;
rollback;
