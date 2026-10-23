-- Individual choices are private account data. Public posts retain only totals.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.poll_votes,public.profile_private_settings,public.posts in share row exclusive mode;
alter table public.profile_private_settings add column poll_votes jsonb not null default '{}'::jsonb
 check(jsonb_typeof(poll_votes)='object');
insert into public.profile_private_settings(user_id,poll_votes)
 select user_id,jsonb_object_agg(post_id::text,jsonb_build_object('option_index',option_index,'created_at',created_at))
 from public.poll_votes group by user_id
 on conflict(user_id) do update set poll_votes=excluded.poll_votes;
do $$ begin
 if exists(select 1 from public.poll_votes v left join public.profile_private_settings s using(user_id)
  where s.user_id is null or not(s.poll_votes?v.post_id::text)
   or (s.poll_votes->v.post_id::text->>'option_index')::integer is distinct from v.option_index
   or (s.poll_votes->v.post_id::text->>'created_at')::timestamptz is distinct from v.created_at) or
 (select count(*) from public.poll_votes)<>(select count(*) from public.profile_private_settings s cross join lateral jsonb_each(s.poll_votes)) then
  raise exception 'Poll vote preservation mismatch';
 end if;
end $$;
drop table public.poll_votes;
drop function if exists public.validate_poll_vote(),public.count_poll_vote();
create view public.poll_votes with(security_invoker=true) as
 select vote.key::uuid as post_id,s.user_id,(vote.value->>'option_index')::integer as option_index,
 (vote.value->>'created_at')::timestamptz as created_at
 from public.profile_private_settings s cross join lateral jsonb_each(s.poll_votes) vote
 join public.posts p on p.id=vote.key::uuid;
revoke all on public.poll_votes from public,anon,authenticated,service_role;
grant select,insert on public.poll_votes to authenticated;
grant select on public.poll_votes to service_role;

create function public.write_private_poll_vote() returns trigger
language plpgsql security definer set search_path='' as $$
declare definition jsonb;author uuid;audience text;choice jsonb;
begin
 if auth.uid() is null or new.user_id is distinct from auth.uid() then
  raise exception 'ログインしてください' using errcode='42501';
 end if;
 if public.is_account_suspended(auth.uid()) then raise exception 'ACCOUNT_SUSPENDED' using errcode='42501';end if;
 select poll,user_id,visibility into definition,author,audience from public.posts where id=new.post_id for update;
 if not found or not public.can_view_post_audience(author,audience) then
  raise exception '投票できません' using errcode='42501';
 end if;
 if definition is null or definition='null'::jsonb or
  new.option_index is null or new.option_index<0 or new.option_index>3 or
  new.option_index>=jsonb_array_length(definition->'options') or
  clock_timestamp()>=(definition->>'endsAt')::timestamptz then
  raise exception '投票が終了したか回答が無効です' using errcode='23514';
 end if;
 new.created_at:=coalesce(new.created_at,now());
 choice:=jsonb_build_object('option_index',new.option_index,'created_at',new.created_at);
 insert into public.profile_private_settings(user_id) values(new.user_id) on conflict do nothing;
 update public.profile_private_settings set poll_votes=poll_votes||jsonb_build_object(new.post_id::text,choice)
 where user_id=new.user_id and not(poll_votes?new.post_id::text);
 if not found then raise exception 'すでに投票しています' using errcode='23505';end if;
 -- The post row lock serializes all votes and the choice write rolls back if
 -- updating the existing public counter fails. Never publish the choice map.
 update public.posts set poll=jsonb_set(poll,array['options',new.option_index::text,'votes'],
  to_jsonb(coalesce((poll->'options'->new.option_index->>'votes')::integer,0)+1)) where id=new.post_id;
 return new;
end $$;
revoke all on function public.write_private_poll_vote() from public,anon,authenticated;
create trigger write_private_poll_vote instead of insert on public.poll_votes
 for each row execute function public.write_private_poll_vote();

-- Maintain the former foreign-key cascades in both directions.
create function public.remove_deleted_post_votes() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.profile_private_settings set poll_votes=poll_votes-old.id::text where poll_votes?old.id::text;
 return old;
end $$;
create trigger remove_deleted_post_votes after delete on public.posts
 for each row execute function public.remove_deleted_post_votes();
create function public.remove_deleted_account_vote_totals() returns trigger
language plpgsql security definer set search_path='' as $$
declare vote record;option_index integer;
begin
 for vote in select * from jsonb_each(old.poll_votes) loop
  option_index:=(vote.value->>'option_index')::integer;
  update public.posts set poll=jsonb_set(poll,array['options',option_index::text,'votes'],
   to_jsonb(greatest(0,coalesce((poll->'options'->option_index->>'votes')::integer,0)-1)))
  where id=vote.key::uuid;
 end loop;
 return old;
end $$;
create trigger remove_deleted_account_vote_totals after delete on public.profile_private_settings
 for each row execute function public.remove_deleted_account_vote_totals();
revoke all on function public.remove_deleted_post_votes(),public.remove_deleted_account_vote_totals() from public,anon,authenticated;

-- Keep the deployed account archive endpoints and stable view pagination.
do $$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.account_export_tables()'::regprocedure);
 needle:='or c.table_name=''user_entitlements''';
 if strpos(definition,needle)=0 then raise exception 'Unexpected export source definition';end if;
 execute replace(definition,needle,'or c.table_name in (''user_entitlements'',''poll_votes'')');
 definition:=pg_get_functiondef('public.account_export_rows(uuid,text,integer,timestamptz)'::regprocedure);
 needle:='if p_table=''user_entitlements'' then ordering:=''t.user_id,t.feature'';end if;';
 if strpos(definition,needle)=0 then raise exception 'Unexpected export ordering definition';end if;
 execute replace(definition,needle,needle||' if p_table=''poll_votes'' then ordering:=''t.post_id,t.user_id'';end if;');
end $$;
notify pgrst,'reload schema';
commit;
