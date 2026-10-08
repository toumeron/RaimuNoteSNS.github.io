begin;
alter table public.profiles add column if not exists review boolean not null default false;

-- Only the dashboard/server may opt an account into reviews.
create function public.guard_review_flag() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and
    ((TG_OP='INSERT' and NEW.review) or (TG_OP='UPDATE' and NEW.review is distinct from OLD.review)) then
    raise exception 'Review eligibility is managed by the administrator' using errcode='42501';
  end if;
  return NEW;
end $$;
create trigger profile_review_flag before insert or update on public.profiles
for each row execute function public.guard_review_flag();
revoke all on function public.guard_review_flag() from public;

-- A single review record contains its rating, text and likes. Do not create a
-- separate settings, rating-summary or review-likes table.
create table public.account_reviews (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title text not null default '' check (char_length(title)<=100),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  liked_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id,author_id)
);
create index account_reviews_profile_date on public.account_reviews(profile_id,created_at desc,id desc);
alter table public.account_reviews enable row level security;
-- Writes go through the narrow RPCs below. Never expose other users' like IDs.
revoke all on public.account_reviews from public,anon,authenticated;
grant all on public.account_reviews to service_role;

create function public.get_account_reviews(target_profile uuid, page_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if page_offset<0 then raise exception 'Invalid offset'; end if;
  if not exists(select 1 from public.profiles where id=target_profile and review) then
    return jsonb_build_object('enabled',false,'total',0,'average',0,'distribution','{}'::jsonb,'reviews','[]'::jsonb);
  end if;
  select jsonb_build_object('enabled',true,'total',count(*),'average',coalesce(round(avg(rating),1),0),
    'distribution',jsonb_build_object('5',count(*) filter(where rating=5),'4',count(*) filter(where rating=4),
      '3',count(*) filter(where rating=3),'2',count(*) filter(where rating=2),'1',count(*) filter(where rating=1)))
  into result from public.account_reviews where profile_id=target_profile;
  return result || jsonb_build_object('reviews',coalesce((
    select jsonb_agg(row_data order by created_at desc,id desc) from (
      select r.id,r.created_at,jsonb_build_object('id',r.id,'author_id',r.author_id,'rating',r.rating,'title',r.title,
        'content',r.content,'created_at',r.created_at,'likes_count',cardinality(r.liked_by),
        'liked_by_me',coalesce(auth.uid()=any(r.liked_by),false),'author',jsonb_build_object(
          'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'is_official',p.is_official)) row_data
      from public.account_reviews r join public.profiles p on p.id=r.author_id
      where r.profile_id=target_profile order by r.created_at desc,r.id desc limit 50 offset page_offset
    ) rows
  ),'[]'::jsonb));
end $$;

create function public.submit_account_review(target_profile uuid, stars integer, review_title text, review_content text)
returns uuid language plpgsql security definer set search_path='' as $$
declare review_id uuid;
begin
  if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
  -- Lock the flag while writing so an administrator disabling reviews wins safely.
  perform 1 from public.profiles where id=target_profile and review for share;
  if not found then raise exception 'Reviews are not enabled for this account' using errcode='42501'; end if;
  if stars is null or stars not between 1 and 5 or review_content is null or
     char_length(btrim(review_content)) not between 1 and 2000 or char_length(coalesce(review_title,''))>100 then
    raise exception 'Invalid review' using errcode='22023';
  end if;
  insert into public.account_reviews(profile_id,author_id,rating,title,content)
    values(target_profile,auth.uid(),stars,btrim(coalesce(review_title,'')),btrim(review_content))
    on conflict(profile_id,author_id) do update set rating=excluded.rating,title=excluded.title,
      content=excluded.content,updated_at=now()
    returning id into review_id;
  return review_id;
end $$;

create function public.set_account_review_like(target_review uuid, enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare likes uuid[];
begin
  if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
  if enabled is null then raise exception 'Invalid like'; end if;
  update public.account_reviews r set liked_by=case when enabled then
    array_append(array_remove(r.liked_by,auth.uid()),auth.uid()) else array_remove(r.liked_by,auth.uid()) end
  where r.id=target_review and exists(select 1 from public.profiles p where p.id=r.profile_id and p.review)
  returning liked_by into likes;
  if not found then raise exception 'Review not available' using errcode='42501'; end if;
  return jsonb_build_object('liked',auth.uid()=any(likes),'count',cardinality(likes));
end $$;
revoke all on function public.get_account_reviews(uuid,integer),public.submit_account_review(uuid,integer,text,text),
  public.set_account_review_like(uuid,boolean) from public;
grant execute on function public.get_account_reviews(uuid,integer) to anon,authenticated;
grant execute on function public.submit_account_review(uuid,integer,text,text),public.set_account_review_like(uuid,boolean) to authenticated;
commit;
