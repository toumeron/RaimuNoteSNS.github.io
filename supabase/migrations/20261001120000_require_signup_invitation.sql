-- Store the actual value in Vault, never in migrations or VITE_* variables.
-- Missing configuration deliberately rejects new accounts.
create extension if not exists supabase_vault with schema vault;
create schema if not exists limenote_auth_private;
revoke all on schema limenote_auth_private from public, anon, authenticated;

create or replace function limenote_auth_private.require_signup_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_code text;
  supplied_code text := new.raw_user_meta_data ->> 'invite_code';
begin
  select decrypted_secret into expected_code
    from vault.decrypted_secrets
    where name = 'limenote_signup_invite_code';

  if expected_code is null or expected_code = ''
     or supplied_code is null or supplied_code = ''
     or length(supplied_code) > 128
     or supplied_code <> expected_code then
    raise exception using errcode = 'P0001', message = 'A valid invitation code is required to create an account.';
  end if;

  -- Do not retain the submitted secret in the profile, user metadata or JWT.
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite_code';
  return new;
end;
$$;

revoke all on function limenote_auth_private.require_signup_invitation() from public, anon, authenticated;

-- All INSERT paths are guarded, including direct calls to the Auth signup API.
-- Existing accounts and login/session updates are unaffected.
drop trigger if exists require_signup_invitation on auth.users;
create trigger require_signup_invitation
before insert on auth.users
for each row execute function limenote_auth_private.require_signup_invitation();
