begin;
-- A composite primary key containing both foreign keys makes PostgREST infer
-- a comments <-> profiles many-to-many relationship. That breaks existing
-- comments.select('*, profiles(*)') author embeds with PGRST201. Preserve
-- one share per viewer, but use a separate primary key to avoid that inference.
alter table public.reply_reposts add column id uuid not null default gen_random_uuid();
alter table public.reply_reposts add constraint reply_reposts_comment_user_key unique (comment_id, user_id);
alter table public.reply_reposts drop constraint reply_reposts_pkey;
alter table public.reply_reposts add constraint reply_reposts_pkey primary key (id);
notify pgrst, 'reload schema';
commit;
