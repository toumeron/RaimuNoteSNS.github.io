-- Deliver changes from the existing table. No new table or broader RLS grants.
do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and to_regclass('public.lime_drops') is not null
    and not exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='lime_drops') then
  alter publication supabase_realtime add table public.lime_drops;
 end if;
end $$;
