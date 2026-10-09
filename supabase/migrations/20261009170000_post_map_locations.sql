-- Manually selected locations belong to existing posts, not a separate table.
alter table public.posts add column if not exists map_latitude double precision;
alter table public.posts add column if not exists map_longitude double precision;
do $$ begin
if not exists (select 1 from pg_constraint where conrelid='public.posts'::regclass and conname='posts_map_location_valid') then
alter table public.posts add constraint posts_map_location_valid check (
  (map_latitude is null and map_longitude is null) or
  (map_latitude is not null and map_longitude is not null and
   map_latitude between -90 and 90 and map_longitude between -180 and 180)
);
end if;
end $$;
create index if not exists posts_map_visible on public.posts(map_latitude, map_longitude, created_at desc)
  where map_latitude is not null and visibility = 'public';
create or replace function public.set_post_map_location(post_id uuid, latitude double precision, longitude double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  update public.posts set map_latitude = latitude, map_longitude = longitude
    where id = post_id and user_id = auth.uid();
  if not found then raise exception 'Post not found or not owned' using errcode='42501'; end if;
end;
$$;
revoke all on function public.set_post_map_location(uuid,double precision,double precision) from public,anon;
grant execute on function public.set_post_map_location(uuid,double precision,double precision) to authenticated;
