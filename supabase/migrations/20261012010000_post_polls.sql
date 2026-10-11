begin;
set local lock_timeout='3s';
alter table public.posts add column poll jsonb;
-- Poll definitions and aggregate totals stay on the existing post. Only individual,
-- immutable votes require separate rows for uniqueness and voter privacy.
create table public.poll_votes(
 post_id uuid not null references public.posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 option_index integer not null check(option_index between 0 and 3),
 created_at timestamptz not null default now(),primary key(post_id,user_id)
);
alter table public.poll_votes enable row level security;
revoke all on public.poll_votes from public,anon,authenticated;
grant select,insert on public.poll_votes to authenticated;
grant all on public.poll_votes to service_role;
create policy poll_votes_own_read on public.poll_votes for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.posts p where p.id=post_id));
create policy poll_votes_own_insert on public.poll_votes for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.posts p where p.id=post_id));
create function public.validate_post_poll() returns trigger language plpgsql set search_path='' as $$
declare option jsonb;minutes integer;
begin
 if tg_op='UPDATE' then
  if new.poll is distinct from old.poll and pg_trigger_depth()<=1 then raise exception '投票内容は投稿後に変更できません';end if;
  return new;
 end if;
 if new.poll is null then return new;end if;
 if jsonb_typeof(new.poll) is distinct from 'object' or jsonb_typeof(new.poll->'options') is distinct from 'array' or jsonb_array_length(new.poll->'options') not between 2 and 4 then raise exception '回答は2〜4個にしてください';end if;
 minutes:=(new.poll->>'durationMinutes')::integer;
 if minutes is null or minutes not between 1 and 10080 then raise exception '投票期間が無効です';end if;
 for option in select value from jsonb_array_elements(new.poll->'options') loop
  if jsonb_typeof(option->'label') is distinct from 'string' or length(trim(option->>'label')) not between 1 and 25 then raise exception '回答は1〜25文字で入力してください';end if;
  if option ? 'image' and (jsonb_typeof(option->'image') is distinct from 'string' or option->>'image' !~ ('^cloudinary:polls/'||new.user_id::text||'/'||new.id::text||'/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$')) then raise exception '投票画像が無効です';end if;
 end loop;
 new.poll:=jsonb_build_object('options',(select jsonb_agg(jsonb_build_object('label',trim(value->>'label'),'votes',0)||case when value ? 'image' then jsonb_build_object('image',value->>'image') else '{}'::jsonb end) from jsonb_array_elements(new.poll->'options')),'endsAt',now()+make_interval(mins=>minutes));
 return new;
end;$$;
create trigger validate_post_poll before insert or update of poll on public.posts for each row execute function public.validate_post_poll();
create function public.validate_poll_vote() returns trigger language plpgsql security definer set search_path='' as $$
declare definition jsonb;
begin
 if new.user_id is distinct from auth.uid() then raise exception 'ログインしてください';end if;
 select poll into definition from public.posts where id=new.post_id for update;
 if definition is null or clock_timestamp()>=(definition->>'endsAt')::timestamptz or new.option_index>=jsonb_array_length(definition->'options') then raise exception '投票が終了したか回答が無効です';end if;
 return new;
end;$$;
create trigger validate_poll_vote before insert on public.poll_votes for each row execute function public.validate_poll_vote();
create function public.count_poll_vote() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  update public.posts set poll=jsonb_set(poll,array['options',old.option_index::text,'votes'],to_jsonb(greatest(0,coalesce((poll->'options'->old.option_index->>'votes')::integer,0)-1))) where id=old.post_id;
  return old;
 end if;
 update public.posts set poll=jsonb_set(poll,array['options',new.option_index::text,'votes'],to_jsonb(coalesce((poll->'options'->new.option_index->>'votes')::integer,0)+1)) where id=new.post_id;
 return new;
end;$$;
create trigger count_poll_vote after insert or delete on public.poll_votes for each row execute function public.count_poll_vote();
revoke all on function public.validate_post_poll(),public.validate_poll_vote(),public.count_poll_vote() from public,anon,authenticated;
commit;
