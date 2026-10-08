import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.viewer',true),'')::uuid $$;
create table profiles(id uuid primary key, username text);
grant usage on schema public,auth to anon,authenticated;
insert into profiles values('${owner}','owner');`);
await db.exec(await readFile(new URL('../supabase/migrations/20261008170000_account_about.sql', import.meta.url), 'utf8'));
await db.exec(`insert into profiles values('${other}','other');`);
assert.equal((await db.query('select * from account_about')).rows.length, 2);
async function asActor(role, id, sql) {
  await db.exec('begin');
  try {
    await db.query("select set_config('test.viewer',$1,true)", [id ?? '']);
    await db.exec(`set local role ${role}`);
    const rows = (await db.query(sql)).rows;
    await db.exec('commit'); return rows;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const save = (id, country='JP', client='LimeNote for Web') => `select update_account_connection('${id}','${country}','${client}')`;
await asActor('authenticated',owner,save(owner));
await assert.rejects(asActor('authenticated',other,save(owner)));
await assert.rejects(asActor('anon',null,save(owner)));
await assert.rejects(asActor('authenticated',owner,save(owner,'Tokyo')));
await assert.rejects(asActor('authenticated',owner,save(owner,'JP','Made up App Store')));
await assert.rejects(asActor('authenticated',owner,`update account_about set username_change_count=99`));
const rows = await asActor('anon',null,'select * from account_about');
assert.equal(rows.find(row=>row.user_id===owner).country_code,'JP');
assert.equal(rows.find(row=>row.user_id===other).country_code,null);
await db.exec(`update profiles set username='renamed' where id='${owner}'; update profiles set username='renamed' where id='${owner}';`);
let row = (await db.query(`select * from account_about where user_id='${owner}'`)).rows[0];
assert.equal(row.username_change_count,1); assert.ok(row.last_username_change_at);
await asActor('authenticated',owner,save(owner,'US','LimeNote for iPhone'));
row = (await db.query(`select * from account_about where user_id='${owner}'`)).rows[0];
assert.equal(row.username_change_count,1); assert.equal(row.country_code,'US');
assert.deepEqual(Object.keys(row).sort(),['user_id','country_code','connection_source','connection_updated_at','username_change_count','last_username_change_at','tracking_since'].sort());
await db.exec(`delete from profiles where id='${owner}'`);
assert.equal((await db.query('select * from account_about')).rows.length,1);
console.log('Account about DB: ownership, public reads, country-only storage, username tracking and cascade passed');
await db.close();
