begin;
-- Remove the retired inference model's metadata; conversation history is preserved.
-- Safe both for databases with the old feature and fresh installations.
alter table public.chat_sessions drop constraint if exists chat_sessions_model_check;
alter table public.chat_sessions drop constraint if exists chat_sessions_flash_job_object;
drop index if exists public.chat_sessions_flash_job_id;
alter table public.chat_sessions drop column if exists flash_job;
alter table public.chat_sessions drop column if exists model;
notify pgrst, 'reload schema';
commit;
