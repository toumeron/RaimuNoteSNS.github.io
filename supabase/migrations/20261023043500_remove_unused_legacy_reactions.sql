-- The active client uses post_reactions/comment_reactions. This retired table
-- is empty in the linked database and has no application writers or readers.
-- Never delete historical reactions if another environment still has data.
begin;
set local lock_timeout='5s';
lock table public.reactions in access exclusive mode;
do $$ begin
 if exists(select 1 from public.reactions) then
  raise exception 'Legacy reactions still contain data; migrate them before retiring this table';
 end if;
end $$;
drop table public.reactions;
notify pgrst,'reload schema';
commit;
