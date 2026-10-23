import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const migration=await readFile('supabase/migrations/20261023043000_consolidate_export_limits.sql','utf8');
const retire=await readFile('supabase/migrations/20261023043500_remove_unused_legacy_reactions.sql','utf8');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
 create table profiles(id uuid primary key);
 create table profile_private_settings(user_id uuid primary key references profiles(id) on delete cascade,bot_prompt text,friend_state jsonb);
 alter table profile_private_settings enable row level security;
 create policy owner on profile_private_settings for select to authenticated using(user_id=auth.uid());
 grant usage on schema public,auth to anon,authenticated,service_role;
 grant select on profile_private_settings to authenticated;
 grant all on profile_private_settings to service_role;
 create table account_exports(user_id uuid primary key,attempts integer,attempt_window timestamptz);
 insert into profiles values('${owner}'),('${other}');
 insert into profile_private_settings values('${owner}','keep this prompt','{"friends":["friend"]}');
 insert into account_exports values('${owner}',4,now()),('${other}',2,now()-interval '1 hour');
 create table reactions(id bigint primary key);`);

const before=(await db.query('select * from account_exports order by user_id')).rows;
await db.exec(migration);
assert.deepEqual((await db.query('select * from account_exports order by user_id')).rows,before);
assert.equal((await db.query("select relkind from pg_class where oid='account_exports'::regclass")).rows[0].relkind,'v');
assert.deepEqual((await db.query(`select bot_prompt,friend_state from profile_private_settings where user_id='${owner}'`)).rows[0],{bot_prompt:'keep this prompt',friend_state:{friends:['friend']}});

async function actor(role,id,sql){
 await db.exec('begin');
 try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const result=await db.query(sql);await db.exec('commit');return result.rows;}
 catch(error){await db.exec('rollback');throw error;}
}
const attempt=id=>`select account_export_attempt('${id}') as allowed`;
assert.equal((await actor('service_role',null,attempt(owner)))[0].allowed,true);
assert.equal((await actor('service_role',null,attempt(owner)))[0].allowed,false);
assert.equal((await actor('service_role',null,attempt(other)))[0].allowed,true);
assert.equal((await db.query(`select export_attempts from profile_private_settings where user_id='${other}'`)).rows[0].export_attempts,1);
// The already-deployed Edge Function resets the old endpoint after successful
// reauthentication; the updatable service-only view keeps that flow working.
await actor('service_role',null,`update account_exports set attempts=0 where user_id='${owner}'`);
assert.equal((await actor('service_role',null,attempt(owner)))[0].allowed,true);
await assert.rejects(actor('anon',null,'select * from account_exports'));
await assert.rejects(actor('authenticated',owner,'select * from account_exports'));
await assert.rejects(actor('authenticated',owner,attempt(owner)));
await assert.rejects(actor('authenticated',owner,'update profile_private_settings set export_attempts=0'));
await assert.rejects(actor('authenticated',owner,'delete from profile_private_settings'));
assert.equal((await actor('authenticated',owner,'select * from profile_private_settings')).length,1);

// Retirement must be data-safe and dependency-safe, and must be atomic.
await db.exec('insert into reactions values(1)');
await assert.rejects(db.exec(retire),/still contain data/);await db.exec('rollback');
assert.equal((await db.query('select count(*)::int n from reactions')).rows[0].n,1);
await db.exec('delete from reactions;create view existing_reactions_reader as select * from reactions');
await assert.rejects(db.exec(retire),/depend/);await db.exec('rollback');
await db.exec('drop view existing_reactions_reader');await db.exec(retire);
assert.equal((await db.query("select to_regclass('public.reactions') name")).rows[0].name,null);
await db.exec(`delete from profiles where id='${owner}'`);
assert.equal((await db.query(`select * from account_exports where user_id='${owner}'`)).rows.length,0);
await db.close();
console.log('Table consolidation: preserved metadata/settings, rate limiting and service reset, owner isolation, cascade, and guarded retirement passed.');
