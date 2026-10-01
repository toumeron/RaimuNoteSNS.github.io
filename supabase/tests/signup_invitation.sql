begin;

-- Exercise the actual trigger function without creating real accounts.
create temporary table invite_test_users (id integer, raw_user_meta_data jsonb);
create trigger require_signup_invitation before insert on invite_test_users
for each row execute function limenote_auth_private.require_signup_invitation();

delete from vault.secrets where name = 'limenote_signup_invite_code';

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into invite_test_users values (1, '{"invite_code":"test-only-invitation"}');
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then raise exception 'Missing server secret must reject signup'; end if;
end $$;

select vault.create_secret('test-only-invitation', 'limenote_signup_invite_code');

do $$
declare
  metadata jsonb;
  rejected boolean;
begin
  foreach metadata in array array[
    null::jsonb, '{}'::jsonb, '{"invite_code":""}'::jsonb,
    '{"invite_code":"wrong"}'::jsonb,
    '{"invite_code":"TEST-ONLY-INVITATION"}'::jsonb,
    jsonb_build_object('invite_code', repeat('x', 129))
  ] loop
    rejected := false;
    begin
      insert into invite_test_users values (2, metadata);
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then raise exception 'Missing/invalid code must reject signup'; end if;
  end loop;

  insert into invite_test_users values
    (3, '{"invite_code":"test-only-invitation","display_name":"Test account"}');
  select raw_user_meta_data into metadata from invite_test_users where id = 3;
  if metadata <> '{"display_name":"Test account"}'::jsonb then
    raise exception 'Invitation must be removed; other metadata must be preserved';
  end if;

  -- An existing user's update/login-related writes do not require an invitation.
  update invite_test_users set raw_user_meta_data = '{"display_name":"Updated"}' where id = 3;
  if (select count(*) from invite_test_users) <> 1 then
    raise exception 'Rejected attempts must not create accounts';
  end if;
  if has_function_privilege('anon', 'limenote_auth_private.require_signup_invitation()', 'EXECUTE')
     or has_function_privilege('authenticated', 'limenote_auth_private.require_signup_invitation()', 'EXECUTE') then
    raise exception 'Clients must not execute the secret-reading function';
  end if;
end $$;

select vault.update_secret(id, '') from vault.secrets where name = 'limenote_signup_invite_code';
do $$
declare rejected boolean := false;
begin
  begin
    insert into invite_test_users values (4, '{"invite_code":"test-only-invitation"}');
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then raise exception 'Empty server secret must reject signup'; end if;
end $$;

rollback;
