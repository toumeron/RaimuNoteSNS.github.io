begin;
set local lock_timeout='3s';
-- RLS protects rows, not individual columns. A pending/ordinary participant
-- must not retrieve the admin invite token, join requests, upload registry,
-- or other members' read/mute/delete settings through the Data API.
revoke select on public.direct_conversations from public,anon,authenticated;
-- Remove any previous column grants too, including future legacy fixtures.
do $$declare col text;begin
 for col in select column_name from information_schema.columns
  where table_schema='public' and table_name='direct_conversations'
 loop
  execute format('revoke select (%I) on public.direct_conversations from public,anon,authenticated',col);
 end loop;
end$$;
grant select(id,user_low,user_high,status,initiated_by,is_group)
 on public.direct_conversations to authenticated;
-- "Delete for me" is private: peers must not see who hid a message.
revoke select on public.direct_messages from public,anon,authenticated;
do $$declare col text;begin
 for col in select column_name from information_schema.columns
  where table_schema='public' and table_name='direct_messages'
 loop
  execute format('revoke select (%I) on public.direct_messages from public,anon,authenticated',col);
 end loop;
end$$;
grant select(id,conversation_id,sender_id,content,attachments,created_at,
 friend_id,friend_name,friend_avatar,reply_to,system_event,reactions)
 on public.direct_messages to authenticated;
-- Realtime DELETE has no row-policy check. Never include private content in
-- its old-record identity if a legacy deployment enabled REPLICA IDENTITY FULL.
alter table public.direct_conversations replica identity default;
alter table public.direct_messages replica identity default;
-- Group summaries already redact tokens/requests except for administrators.
-- Verified Edge handlers use service_role; ordinary clients use summaries.
notify pgrst,'reload schema';
commit;
