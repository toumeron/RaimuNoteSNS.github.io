import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.viewer',true),'')::uuid $$;
create table profiles(id uuid primary key);insert into profiles values('${alice}'),('${bob}');
grant usage on schema public,auth to anon,authenticated;`);
await db.exec(await readFile(new URL('../supabase/migrations/20261008180000_external_account_users.sql',import.meta.url),'utf8'));
async function asUser(role,id,sql){
 await db.exec('begin');try{
 await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);
 const rows=(await db.query(sql)).rows;await db.exec('commit');return rows;
 }catch(e){await db.exec('rollback');throw e;}
}
const legacy=`'[{"provider":"bluesky","handle":"cat.bsky.social"},{"provider":"misskey","handle":"cat@misskey.io"}]'::jsonb`;
await asUser('authenticated',alice,`select import_external_account_users(${legacy})`);
assert.equal((await asUser('authenticated',alice,'select * from external_account_users')).length,2);
assert.equal((await asUser('authenticated',bob,'select * from external_account_users')).length,0);
await assert.rejects(asUser('anon',null,'select * from external_account_users'));
await assert.rejects(asUser('authenticated',bob,`insert into external_account_users(user_id,provider,handle) values('${alice}','bluesky','hacker.bsky.social')`));
await asUser('authenticated',bob,`delete from external_account_users where user_id='${alice}'`);
assert.equal((await asUser('authenticated',alice,'select * from external_account_users')).length,2);
await asUser('authenticated',alice,`delete from external_account_users where provider='bluesky'`);
await asUser('authenticated',alice,`select import_external_account_users(${legacy})`);
assert.equal((await asUser('authenticated',alice,'select * from external_account_users')).length,1);
await assert.rejects(asUser('authenticated',alice,`update external_account_imports set imported_at=now()`));
await assert.rejects(asUser('anon',null,`select import_external_account_users(${legacy})`));
await assert.rejects(asUser('authenticated',bob,`select import_external_account_users('[{"provider":"bad","handle":"cat"}]')`));
assert.equal((await db.query(`select * from external_account_imports where user_id='${bob}'`)).rows.length,0);
await asUser('authenticated',bob,`select import_external_account_users('[]')`);
await asUser('authenticated',bob,`insert into external_account_users(user_id,provider,handle) values('${bob}','bluesky','bob.bsky.social') on conflict do nothing`);
await asUser('authenticated',bob,`insert into external_account_users(user_id,provider,handle) values('${bob}','bluesky','bob.bsky.social') on conflict do nothing`);
assert.equal((await asUser('authenticated',bob,'select * from external_account_users')).length,1);
await db.exec(`delete from profiles where id='${bob}'`);
assert.equal((await db.query(`select * from external_account_users where user_id='${bob}'`)).rows.length,0);
console.log('Cloud external users: owner isolation, one-time import, deletion, idempotent addition, rollback and cascade passed');
await db.close();
