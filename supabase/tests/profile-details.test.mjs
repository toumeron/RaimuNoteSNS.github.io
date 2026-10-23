import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.viewer',true),'')::uuid $$;
create table profiles(id uuid primary key, bio text);
alter table profiles enable row level security;
create policy read_all on profiles for select using(true);
create policy own_update on profiles for update using(id=auth.uid()) with check(id=auth.uid());
grant usage on schema public,auth to anon,authenticated;
grant select on profiles to anon,authenticated;
insert into profiles(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
await db.exec(await readFile('supabase/migrations/20261023113000_profile_birthday_and_website.sql', 'utf8'));
await db.exec(await readFile('supabase/migrations/20261023115000_profile_website_host_validation.sql', 'utf8'));
await db.exec(await readFile('supabase/migrations/20261023121500_profile_website_unicode.sql', 'utf8'));
await db.exec(`set role authenticated;select set_config('test.viewer','11111111-1111-4111-8111-111111111111',false);
update profiles set birth_date='1998-05-10',website_url='https://lit.link/key_trend' where id=auth.uid();`);
assert.equal((await db.query('select birth_date::text as date from profiles where id=auth.uid()')).rows[0].date, '1998-05-10');
assert.equal((await db.query("update profiles set birth_date='2000-01-01' where id='22222222-2222-4222-8222-222222222222' returning id")).rows.length,0);
for(const sql of ["update profiles set website_url='https://example' where id=auth.uid()", "update profiles set website_url='https://ただの文章' where id=auth.uid()", "update profiles set website_url='https://-bad.example.com' where id=auth.uid()","update profiles set birth_date=current_date+1 where id=auth.uid()", "update profiles set birth_date='2023-02-29' where id=auth.uid()", "update profiles set website_url='javascript:alert(1)' where id=auth.uid()", "update profiles set website_url='https://user:password@example.com' where id=auth.uid()"]){await assert.rejects(db.exec(sql));}
for (const value of ['HTTPS://Example.COM/MyPage?Key=Value', 'https://例え.テスト/日本語?検索=猫']) {
 await db.query('update profiles set website_url=$1 where id=auth.uid()', [value]);
 assert.equal((await db.query('select website_url from profiles where id=auth.uid()')).rows[0].website_url, value);
}
await db.exec("update profiles set website_url='https://lit.link/key_trend' where id=auth.uid()");
await db.exec('set role anon');
assert.equal((await db.query("select website_url from profiles where website_url is not null")).rows[0].website_url,'https://lit.link/key_trend');
await assert.rejects(db.exec("update profiles set website_url=null"));
await db.exec('set role authenticated;update profiles set birth_date=null,website_url=null where id=auth.uid()');
assert.equal((await db.query('select website_url from profiles where id=auth.uid()')).rows[0].website_url,null);
await db.close();
console.log('Profile detail migration: date/URL validation, public display, owner editing, removal passed');
