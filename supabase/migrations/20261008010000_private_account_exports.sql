begin;
create table public.account_exports (
 user_id uuid primary key references auth.users(id) on delete cascade,
 attempts integer not null default 0, attempt_window timestamptz not null default now()
);
alter table public.account_exports enable row level security;
revoke all on public.account_exports from public,anon,authenticated;
grant all on public.account_exports to service_role;
-- Only password-attempt metadata is retained on the server. The ZIP and
-- collected snapshot are never stored in a bucket or database table.
create function public.account_export_attempt(p_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
 insert into public.account_exports(user_id) values(p_user_id) on conflict do nothing;
 update public.account_exports set attempts=case when attempt_window<now()-interval '15 minutes' then 1 else attempts+1 end,
 attempt_window=case when attempt_window<now()-interval '15 minutes' then now() else attempt_window end
 where user_id=p_user_id returning attempts<=5 into allowed;
 return allowed;
end;$$;
-- Discover all account-owned tables, including future features. Never expose
-- auth/storage schemas, unrelated accounts, or internal export bookkeeping.
create function public.account_export_tables() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('table',table_name,'columns',columns) order by table_name),'[]'::jsonb)
 from (
  select c.table_name,array_agg(c.column_name order by c.ordinal_position) columns
  from information_schema.columns c join information_schema.tables t using(table_schema,table_name)
  where c.table_schema='public' and t.table_type='BASE TABLE' and c.table_name not in ('account_exports','news_generation_state')
   and (c.column_name in ('user_id','owner_id','uploaded_by','host_id','follower_id','followee_id','member_id','creator_id','actor_id','recipient_id','sender_id','mentioned_user_id','subscriber_id','author_id')
    or (c.table_name in ('profiles','active_bot_users') and c.column_name='id'))
   and (c.table_name<>'notifications' or c.column_name in ('user_id','recipient_id'))
   and c.data_type in ('uuid','text','character varying')
  group by c.table_name
 ) owned;
$$;
create function public.account_export_rows(p_user_id uuid,p_table text,p_offset integer,p_cutoff timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare spec jsonb; condition text; ordering text; cutoff text:=''; output jsonb;
begin
 select value into spec from jsonb_array_elements(public.account_export_tables()) value where value->>'table'=p_table;
 if spec is null or p_offset<0 then raise exception 'Unsupported account export source';end if;
 select string_agg(format('t.%I::text=$1',value),' or ') into condition from jsonb_array_elements_text(spec->'columns');
 select string_agg(format('t.%I',a.attname),',' order by k.ordinality) into ordering
 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
 join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
 where n.nspname='public' and c.relname=p_table and i.indisprimary;
 if ordering is null then ordering:='t.ctid';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='created_at' and data_type like 'timestamp%') then cutoff:=' and (t.created_at is null or t.created_at<=$3)';end if;
 execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select t.* from public.%I t where (%s)%s order by %s limit 500 offset $2) r',p_table,condition,cutoff,ordering)
 into output using p_user_id::text,p_offset,p_cutoff;
 return output;
end;$$;
create function public.account_export_uploads(p_user_id uuid,p_offset integer) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
  select bucket_id,name,created_at,metadata from storage.objects
  where bucket_id<>'account-exports' and (owner_id=p_user_id::text or owner=p_user_id or (storage.foldername(name))[1]=p_user_id::text)
  order by bucket_id,name limit 500 offset greatest(p_offset,0)
 ) r;
$$;
revoke all on function public.account_export_attempt(uuid),public.account_export_tables(),public.account_export_rows(uuid,text,integer,timestamptz),public.account_export_uploads(uuid,integer) from public,anon,authenticated;
grant execute on function public.account_export_attempt(uuid),public.account_export_tables(),public.account_export_rows(uuid,text,integer,timestamptz),public.account_export_uploads(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
