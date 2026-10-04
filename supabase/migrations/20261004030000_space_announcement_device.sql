begin;
drop function public.announce_live_space(text);
create or replace function public.announce_live_space(p_space_id text, p_client_name text default 'LimeNote for Web') returns uuid language plpgsql security definer set search_path=public as $$
declare room spaces; post_id uuid;
begin
 if auth.uid() is null then raise exception 'ログインしてください'; end if;
 select * into room from spaces where id=p_space_id and host_id=auth.uid() and is_active and heartbeat_at>now()-interval '90 seconds' for update;
 if not found then raise exception '開催中のホストのみ投稿できます'; end if;
 if room.announcement_post_id is not null then return room.announcement_post_id; end if;
 if not exists(select 1 from space_members where space_id=p_space_id and user_id=auth.uid() and role='host' and heartbeat_at>now()-interval '90 seconds') then raise exception 'スペースに接続してください'; end if;
 if p_client_name not in ('LimeNote for iPhone','LimeNote for iPad','LimeNote for Android','LimeNote for Windows','LimeNote for Mac','LimeNote for Linux','LimeNote for Web') then raise exception '投稿元の機種名が無効です'; end if;
 post_id:=gen_random_uuid();
 insert into posts(id,user_id,content,image_urls,visibility,client_name,is_quote,is_bot) values(post_id,auth.uid(),'https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/'||room.id,'{}','public',p_client_name,false,false);
 update spaces set announcement_post_id=post_id where id=p_space_id;
 return post_id;
end; $$;
revoke all on function public.announce_live_space(text,text) from public;
grant execute on function public.announce_live_space(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
