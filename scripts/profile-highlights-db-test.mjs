import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const viewer = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const publicPost = '44444444-4444-4444-8444-444444444444';
const privatePost = '55555555-5555-4555-8555-555555555555';
const otherPost = '66666666-6666-4666-8666-666666666666';
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.viewer',true),'')::uuid $$;
  create table profiles(id uuid primary key);
  create table posts(id uuid primary key, user_id uuid references profiles(id), visibility text);
  create table comments(post_id uuid);
  alter table comments enable row level security;
  create table follows(follower_id uuid, followee_id uuid);
  create table memberships(creator_id uuid, member_id uuid);
  alter table posts enable row level security;
  create policy posts_read on posts for select using(true);
  grant usage on schema auth,public to anon,authenticated;
  grant select on profiles,posts,follows,memberships to anon,authenticated;
  insert into profiles values('${owner}'),('${viewer}'),('${stranger}');
  insert into posts values('${publicPost}','${owner}','public'),('${privatePost}','${owner}','following'),('${otherPost}','${stranger}','public');
  insert into follows values('${owner}','${viewer}');
`);
for (const file of ['20261003130000_enforce_post_audience.sql', '20261008130000_profile_highlights.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
}
async function asActor(role, id, sql) {
  await db.exec('begin');
  try {
    await db.query("select set_config('test.viewer',$1,true)", [id ?? '']);
    await db.exec(`set local role ${role}`);
    const result = await db.query(sql);
    await db.exec('commit');
    return result.rows;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const insert = (user, post) => `insert into profile_highlights(user_id,post_id) values('${user}','${post}')`;
await asActor('authenticated', owner, insert(owner, publicPost));
await asActor('authenticated', owner, insert(owner, privatePost));
// Idempotent addition preserves the original highlight timestamp.
await asActor('authenticated', owner, insert(owner, publicPost) + ' on conflict(user_id,post_id) do nothing');
assert.equal((await asActor('authenticated', owner, 'select * from profile_highlights')).length, 2);
assert.equal((await asActor('authenticated', viewer, 'select * from profile_highlights')).length, 2);
assert.equal((await asActor('authenticated', stranger, 'select * from profile_highlights')).length, 1);
assert.equal((await asActor('anon', null, 'select * from profile_highlights')).length, 1);
await assert.rejects(asActor('authenticated', stranger, insert(owner, otherPost)));
await assert.rejects(asActor('authenticated', owner, insert(owner, otherPost)));
await assert.rejects(asActor('anon', null, insert(owner, publicPost)));
await asActor('authenticated', stranger, 'delete from profile_highlights');
assert.equal((await asActor('authenticated', owner, 'select * from profile_highlights')).length, 2);
await asActor('authenticated', owner, `delete from profile_highlights where post_id='${publicPost}'`);
assert.equal((await asActor('anon', null, 'select * from profile_highlights')).length, 0);
await db.exec(`delete from posts where id='${privatePost}'`);
assert.equal((await db.query('select * from profile_highlights')).rows.length, 0);
await db.close();
console.log('Profile highlights DB checks passed: ownership, audiences, idempotency, removal and cascade deletion.');
