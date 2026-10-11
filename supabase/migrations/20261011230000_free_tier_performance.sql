begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Preserve every policy's roles, command and boolean conditions. Evaluate the
-- request-constant auth.uid() once instead of once for each matching row.
-- Skip expressions with subqueries, including those already optimized.
do $$
declare p record; predicate text; checked text; clauses text;
begin
 for p in
  select n.nspname,c.relname,x.polname,pg_get_expr(x.polqual,x.polrelid) as predicate,pg_get_expr(x.polwithcheck,x.polrelid) as checked
  from pg_policy x join pg_class c on c.oid=x.polrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','storage')
 loop
  if coalesce(p.predicate,'') ilike '%select%' or coalesce(p.checked,'') ilike '%select%' then continue; end if;
  predicate:=replace(p.predicate,'auth.uid()','(select auth.uid())');
  checked:=replace(p.checked,'auth.uid()','(select auth.uid())');
  if predicate is not distinct from p.predicate and checked is not distinct from p.checked then continue; end if;
  clauses:='';
  if predicate is not null then clauses:=clauses||' using ('||predicate||')'; end if;
  if checked is not null then clauses:=clauses||' with check ('||checked||')'; end if;
  execute format('alter policy %I on %I.%I%s',p.polname,p.nspname,p.relname,clauses);
 end loop;
end;$$;
-- Remove only these two exact redundant, non-constraint indexes. Leave all
-- unique/constraint-backed indexes and all RLS policies intact.
do $$
declare pair text[]; redundant oid; retained oid;
begin
 foreach pair slice 1 in array array[['idx_posts_created_at_desc','posts_created_at_idx'],['idx_posts_parent_id','posts_parent_id_idx']] loop
  redundant:=to_regclass('public.'||pair[1]);retained:=to_regclass('public.'||pair[2]);
  if redundant is null or retained is null then continue; end if;
  if exists(select 1 from pg_constraint where conindid in (redundant,retained)) then continue; end if;
  if exists(select 1 from pg_index a join pg_index b on a.indrelid=b.indrelid
   join pg_class ac on ac.oid=a.indexrelid join pg_class bc on bc.oid=b.indexrelid
   where a.indexrelid=redundant and b.indexrelid=retained and a.indisvalid and b.indisvalid
   and ac.relam=bc.relam and a.indisunique=b.indisunique and not a.indisprimary and not b.indisprimary
   and a.indkey=b.indkey and a.indclass=b.indclass and a.indcollation=b.indcollation and a.indoption=b.indoption
   and a.indpred::text is not distinct from b.indpred::text and a.indexprs::text is not distinct from b.indexprs::text) then
   execute format('drop index public.%I',pair[1]);
  end if;
 end loop;
end;$$;
commit;
