import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table posts(id uuid primary key, user_id uuid not null, visibility text, created_at timestamptz default now());
grant usage on schema public,auth to anon,authenticated;
insert into posts(id,user_id,visibility) values('${owner}','${owner}','public'),('${other}','${other}','followers');`);
await db.exec(await readFile('supabase/migrations/20261009170000_post_map_locations.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261009170000_post_map_locations.sql','utf8')); // Safe if manually applied twice.
async function save(actor, role='authenticated', lat=35, lon=139, post=owner){
 await db.exec('begin');
 try {await db.query("select set_config('test.viewer',$1,true)",[actor??'']);await db.exec(`set local role ${role}`);await db.query('select set_post_map_location($1,$2,$3)',[post,lat,lon]);await db.exec('commit');}
 catch(e){await db.exec('rollback');throw e;}
}
await save(owner);
assert.equal((await db.query('select map_latitude from posts where id=$1',[owner])).rows[0].map_latitude,35);
await assert.rejects(save(other));
await assert.rejects(save(null,'anon'));
await assert.rejects(save(null));
await assert.rejects(save(owner,'authenticated',91));
await assert.rejects(save(owner,'authenticated',35,181));
await assert.rejects(save(owner,'authenticated',null,139));
await db.query('insert into posts(id,user_id,visibility) values($1,$2,$3)',['33333333-3333-4333-8333-333333333333',owner,'public']);
await save(owner,'authenticated',null,null);
assert.equal((await db.query('select map_latitude from posts where id=$1',[owner])).rows[0].map_latitude,null);
await save(other,'authenticated',34,135,other);
assert.equal((await db.query('select visibility from posts where id=$1',[other])).rows[0].visibility,'followers');
assert.equal((await db.query("select count(*)::int as n from information_schema.tables where table_schema='public'")).rows[0].n,1);
await db.close(); console.log('PASS: location ownership, anonymous denial, coordinate constraints, removal, unchanged visibility, no extra tables');
