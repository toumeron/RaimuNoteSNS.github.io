import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const author='11111111-1111-4111-8111-111111111111';
const allowed='22222222-2222-4222-8222-222222222222';
const attacker='33333333-3333-4333-8333-333333333333';
const post='44444444-4444-4444-8444-444444444444';
const comment='55555555-5555-4555-8555-555555555555';
const path=`${author}/${post}/66666666-6666-4666-8666-666666666666.png`;
const ref=`storage://post-media/${path}`;
let checks=0;
// The repo predates versioned base-schema migrations. This intentionally
// permissive legacy fixture tests that the new restrictive guards stand alone.
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
`);
await db.exec(`
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
create table public.profiles(id uuid primary key references auth.users(id),username text,is_official boolean default false,bot_prompt text);
create table public.posts(id uuid primary key,user_id uuid references public.profiles(id),visibility text default 'public',content text,image_urls text[] default '{}');
create table public.comments(id uuid primary key,user_id uuid,post_id uuid references public.posts(id),content text,image_urls text[] default '{}');
create table public.follows(follower_id uuid,followee_id uuid);
create table public.memberships(creator_id uuid,member_id uuid);
create table public.custom_emojis(id uuid default gen_random_uuid(),uploaded_by uuid,name text);
create table public.notifications(id uuid,user_id uuid,post_id uuid,content_preview text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);
create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
`);
for(const table of ['likes','post_reactions','reposts','mentions','profile_pins']) {
 await db.exec(`create table public.${table}(id uuid default gen_random_uuid(),user_id uuid,post_id uuid);`);
}
for(const table of ['comment_likes','comment_reactions','reply_reposts']) {
 await db.exec(`create table public.${table}(id uuid default gen_random_uuid(),user_id uuid,comment_id uuid);`);
}
for(const table of ['external_reposts','bookmarks','chat_sessions','push_subscriptions']) {
 await db.exec(`create table public.${table}(id uuid default gen_random_uuid(),user_id uuid,content text);`);
}
await db.exec(`grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant all on all tables in schema public,storage to anon,authenticated,service_role;
 grant execute on all functions in schema auth,storage to anon,authenticated,service_role;
 insert into auth.users values('${author}'),('${allowed}'),('${attacker}');
 insert into public.profiles(id,username,bot_prompt) values('${author}','author','private bot instructions'),('${allowed}','allowed',null),('${attacker}','attacker',null);`);
const tables = (await db.query("select tablename from pg_tables where schemaname in ('public','storage') and tablename<>'buckets'")).rows;
for(const {tablename} of tables) {
 const schema=tablename==='objects'?'storage':'public';
 await db.exec(`alter table ${schema}.${tablename} enable row level security; create policy legacy_debug_all on ${schema}.${tablename} for all to anon,authenticated using(true) with check(true);`);
}
for(const migration of ['20261003130000_enforce_post_audience.sql','20261008120000_security_hardening.sql','20261008121000_private_post_media.sql','20261008122000_private_bot_settings.sql']) {
 await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
}
await db.exec(`insert into public.posts(id,user_id,visibility,content,image_urls) values('${post}','${author}','following','secret',array['${ref}']);
 insert into public.comments values('${comment}','${author}','${post}','secret reply',array['${ref}']);
 insert into storage.objects(bucket_id,name,owner_id) values('post-media','${path}','${author}');
 insert into public.follows values('${author}','${allowed}'),('${attacker}','${author}');
 insert into public.likes(user_id,post_id) values('${allowed}','${post}');
 insert into public.notifications values(gen_random_uuid(),'${attacker}','${post}','secret notification');
 insert into public.notifications values(gen_random_uuid(),'${author}',null,'owner notification');
 insert into public.chat_sessions(user_id,content) values('${author}','private conversation');
 insert into public.push_subscriptions(user_id,content) values('${author}','private push credential');`);
async function asActor(role,id,operation) {
 await db.exec('begin');
 try {
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,...(id?{sub:id}:{})})]);
  await db.exec(`set local role ${role}`);
  const result=await operation();await db.exec('rollback');return result;
 } catch(error) {await db.exec('rollback');throw error;}
}
async function count(table,where='true') {return Number((await db.query(`select count(*) n from ${table} where ${where}`)).rows[0].n);}
async function checkCount(role,id,table,wanted) {await asActor(role,id,async()=>assert.equal(await count(table),wanted,`${role}/${id}: ${table}`));checks++;}
for(const table of ['posts','comments','likes','storage.objects']) {
 const name=table.includes('.')?table:'public.'+table;
 await checkCount('authenticated',allowed,name,1);
 await checkCount('authenticated',author,name,1);
 await checkCount('authenticated',attacker,name,0);
 await checkCount('anon',null,name,0);
}
for(const table of ['chat_sessions','push_subscriptions','profile_private_settings']) {
 await checkCount('authenticated',author,'public.'+table,1);
 await checkCount('authenticated',attacker,'public.'+table,0);
}
await checkCount('authenticated',attacker,'public.notifications',0);
await asActor('authenticated',attacker,async()=>{
 const rows=await db.query(`update public.posts set content='hacked' where id='${post}' returning id`);assert.equal(rows.rows.length,0);
});checks++;
for(const sql of [
 `insert into public.posts(id,user_id,visibility,content) values(gen_random_uuid(),'${author}','public','forged')`,
 `insert into public.custom_emojis(uploaded_by,name) values('${author}','forged')`,
 `insert into public.follows values('${author}','${attacker}')`,
 `insert into public.comments(id,user_id,post_id,content) values(gen_random_uuid(),'${attacker}','${post}','forged')`,
 `update public.profiles set is_official=true where id='${attacker}'`,
 `insert into public.notifications values(gen_random_uuid(),'${attacker}',null,'forged')`,
 `insert into storage.objects(bucket_id,name) values('post-media','${path}')`,
 `insert into public.posts(id,user_id,visibility,image_urls) values(gen_random_uuid(),'${attacker}','following',array['https://example.com/leak.png'])`,
 `insert into public.posts(id,user_id,visibility,image_urls) values(gen_random_uuid(),'${attacker}','public',array['${ref}'])`,
 `select public.consume_security_quota('${author}','chat')`
]) {
 await assert.rejects(asActor('authenticated',attacker,()=>db.exec(sql)));checks++;
}
await asActor('authenticated',author,async()=>{
 await db.exec(`update public.profiles set bot_prompt='new private prompt' where id='${author}'`);
 assert.equal((await db.query(`select bot_prompt from public.profiles where id='${author}'`)).rows[0].bot_prompt,null);
 assert.equal((await db.query('select bot_prompt from public.profile_private_settings')).rows[0].bot_prompt,'new private prompt');
});checks++;
// Removing the author's follow revokes both content and storage reads.
await db.exec(`delete from public.follows where follower_id='${author}' and followee_id='${allowed}'`);
await checkCount('authenticated',allowed,'storage.objects',0);
await checkCount('authenticated',allowed,'public.posts',0);
await db.exec(`update public.posts set visibility='public' where id='${post}'`);
await checkCount('anon',null,'storage.objects',1);
await checkCount('anon',null,'public.posts',1);
// Stored quotas cannot be forged through the Data API.
await asActor('service_role',null,async()=>{
 for(let i=0;i<31;i++) {const {rows}=await db.query('select public.consume_security_quota($1,$2) ok',[author,'chat']);assert.equal(rows[0].ok,i<30);checks++;}
});
await db.close();
console.log(`PASS: ${checks} PostgreSQL security checks (isolated legacy fixture; live schema verification still required)`);
