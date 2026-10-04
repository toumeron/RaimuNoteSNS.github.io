begin;
alter table public.spaces add column if not exists announcement_post_id uuid;
create unique index if not exists spaces_announcement_post_idx on public.spaces(announcement_post_id) where announcement_post_id is not null;
-- Explicitly invoked only after the host successfully connects. A row lock makes retries idempotent.
create or replace function public.announce_live_space(p_space_id text) returns uuid language plpgsql security definer set search_path=public as $$
declare room spaces; post_id uuid;
begin
 if auth.uid() is null then raise exception 'ログインしてください'; end if;
 select * into room from spaces where id=p_space_id and host_id=auth.uid() and is_active and heartbeat_at>now()-interval '90 seconds' for update;
 if not found then raise exception '開催中のホストのみ投稿できます'; end if;
 if room.announcement_post_id is not null then return room.announcement_post_id; end if;
 if not exists(select 1 from space_members where space_id=p_space_id and user_id=auth.uid() and role='host' and heartbeat_at>now()-interval '90 seconds') then raise exception 'スペースに接続してください'; end if;
 post_id:=gen_random_uuid();
 insert into posts(id,user_id,content,image_urls,visibility,client_name,is_quote,is_bot) values(post_id,auth.uid(),'https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/'||room.id,'{}','public','LimeNote',false,false);
 update spaces set announcement_post_id=post_id where id=p_space_id;
 return post_id;
end; $$;
create or replace function public.get_space_card(p_space_id text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',s.id,'title',s.title,'host_id',s.host_id,'speaker_policy',s.speaker_policy,
 'is_active',s.is_active and s.heartbeat_at>now()-interval '90 seconds',
 'profiles',jsonb_build_object('display_name',p.display_name,'username',p.username,'avatar_url',p.avatar_url))
 from spaces s join profiles p on p.id=s.host_id where s.id=p_space_id;
$$;
revoke all on function public.announce_live_space(text), public.get_space_card(text) from public;
grant execute on function public.announce_live_space(text) to authenticated;
grant execute on function public.get_space_card(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
