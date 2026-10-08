begin;
create table public.profile_private_settings (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 bot_prompt text
);
alter table public.profile_private_settings enable row level security;
revoke all on public.profile_private_settings from public,anon,authenticated;
grant select on public.profile_private_settings to authenticated;
grant all on public.profile_private_settings to service_role;
create policy private_settings_owner on public.profile_private_settings for select to authenticated using(user_id=auth.uid());
insert into public.profile_private_settings(user_id,bot_prompt) select id,bot_prompt from public.profiles where bot_prompt is not null;
-- Keep the legacy column as a NULL compatibility placeholder. Never publish
-- its value through profiles(*), embedded authors, Realtime or exports.
update public.profiles set bot_prompt=null where bot_prompt is not null;
create function limenote_security.store_private_bot_prompt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.bot_prompt is not null then
  if auth.role() in ('anon','authenticated') and new.id is distinct from auth.uid() then
   raise exception 'Cannot update another account settings' using errcode='42501';
  end if;
  insert into public.profile_private_settings(user_id,bot_prompt) values(new.id,new.bot_prompt)
   on conflict(user_id) do update set bot_prompt=excluded.bot_prompt;
  new.bot_prompt:=null;
 end if;
 return new;
end;$$;
revoke all on function limenote_security.store_private_bot_prompt() from public,anon,authenticated;
-- Profiles are created by the signup trigger without a bot prompt. Settings
-- are written after the profile exists so the FK is always satisfied.
create trigger security_private_bot_prompt before update on public.profiles for each row execute function limenote_security.store_private_bot_prompt();
-- Prevent a signup/REST insert from placing a prompt in the public placeholder.
alter table public.profiles add constraint profile_bot_prompt_is_private check(bot_prompt is null) not valid;
alter table public.profiles validate constraint profile_bot_prompt_is_private;
notify pgrst,'reload schema';
commit;
