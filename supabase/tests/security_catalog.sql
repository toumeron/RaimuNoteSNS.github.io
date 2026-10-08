-- Read-only production inventory. Run with a trusted database owner session.
-- No row data, function bodies, tokens or private settings are returned.
select n.nspname schema_name,c.relname table_name,c.relrowsecurity rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity;
select n.nspname schema_name,c.relname view_name,c.reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v' and not coalesce(c.reloptions @> array['security_invoker=true'],false);
select p.oid::regprocedure function_name,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') anon_can_execute,
 has_function_privilege('authenticated',p.oid,'execute') authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
order by p.oid::regprocedure::text;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname;
select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id;
-- Count only; never expose the media URL inventory through a public RPC.
select count(*) restricted_posts_with_legacy_images from public.posts
 where coalesce(visibility,'public')<>'public' and exists(select 1 from unnest(image_urls) image where image not like 'storage://post-media/%');
-- Review newly discovered sensitive-looking columns against table/column grants.
select table_name,column_name,data_type from information_schema.columns
 where table_schema='public' and column_name ~* '(password|token|secret|api_key|email|phone|bot_prompt)'
 order by table_name,column_name;
