begin;
-- Expiry applies to history and unread counts, including older clients.
alter table public.notifications add column expires_at timestamptz;
update public.notifications set expires_at=coalesce(created_at,now())+interval '30 days';
alter table public.notifications alter column expires_at set not null;
alter table public.notifications alter column expires_at set default (now()+interval '30 days');
create index notifications_expiry_idx on public.notifications(expires_at);
create policy security_notification_fresh_read on public.notifications as restrictive for select to anon,authenticated using(expires_at>now());
create function public.expire_notifications() returns integer language plpgsql security definer set search_path='' as $$ declare removed integer;begin
 delete from public.notifications where expires_at<=now();get diagnostics removed=row_count;return removed;
end $$;
revoke all on function public.expire_notifications() from public,anon,authenticated;
grant execute on function public.expire_notifications() to service_role;
-- One webhook uses the same dedicated secret as the deployed sender.
create or replace function public.notify_send_push() returns trigger language plpgsql security definer set search_path='' as $$ declare webhook_secret text;endpoint text;begin
 if NEW.is_read or NEW.expires_at<=now() then return NEW;end if;
 select decrypted_secret into webhook_secret from vault.decrypted_secrets where name='notification_push_webhook_secret';
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='notification_function_url';
 if webhook_secret is null or endpoint is null then raise warning 'Notification webhook configuration missing';return NEW;end if;
 perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-push-secret',webhook_secret),body:=jsonb_build_object('notification_id',NEW.id),timeout_milliseconds:=10000);
 return NEW;
end $$;
revoke all on function public.notify_send_push() from public;
do $$ begin
 if exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.notifications'::regclass and t.tgname='on_notification_send_push' and p.proname<>'send_push_for_existing_notification') then raise exception 'Unexpected legacy push trigger';end if;
end $$;
drop trigger if exists on_notification_send_push on public.notifications;
drop trigger if exists notifications_send_push on public.notifications;
create trigger notifications_send_push after insert on public.notifications for each row execute function public.notify_send_push();
-- Only notification history is removed, not posts, subscriptions or settings.
select public.expire_notifications();
notify pgrst,'reload schema';
commit;
