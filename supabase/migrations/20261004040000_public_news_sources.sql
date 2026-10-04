alter table public.news_summaries add column source text not null default 'limenote' check (source in ('limenote', 'bluesky'));
alter table public.news_summaries add column public_sources_verified boolean not null default false;
alter table public.news_summaries add column source_post_ids text[] not null default '{}';
-- Old summaries used unrestricted input; retain them in storage but do not publish them.
create function public.news_sources_are_public(news_source text, ids text[]) returns boolean
language sql stable security definer set search_path = public
as $$
  select cardinality(ids) between 1 and 10 and case when news_source = 'bluesky'
    then not exists (select 1 from unnest(ids) as refs(post_id) where refs.post_id not like 'bsky:at://%')
    else not exists (select 1 from unnest(ids) as refs(post_id) where not exists (
      select 1 from public.posts p where p.id::text = refs.post_id and p.visibility = 'public'
    )) end;
$$;
revoke all on function public.news_sources_are_public(text,text[]) from public;
grant execute on function public.news_sources_are_public(text,text[]) to anon, authenticated, service_role;
drop policy "Allow select for everyone" on public.news_summaries;
create policy "Read verified public news" on public.news_summaries for select to anon, authenticated
using (public_sources_verified and public.news_sources_are_public(source, source_post_ids));
create index news_summaries_source_created on public.news_summaries(source, created_at desc);
