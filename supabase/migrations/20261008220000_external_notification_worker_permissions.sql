-- Existing subscriptions predate server-side polling and did not grant access
-- to service_role. RLS bypass alone does not confer table privileges.
grant select on public.post_notification_subscriptions to service_role;
grant update(last_checked_at) on public.post_notification_subscriptions to service_role;
notify pgrst, 'reload schema';
