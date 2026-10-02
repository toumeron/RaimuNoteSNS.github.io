-- Only future replies record a client. Historical replies have no known device.
alter table public.comments add column if not exists client_name text;
