// Each command runs one original verification in its own process.
// Dependencies are loaded only after selecting that verification.
const suites = {
  // account-about-db-test.mjs
  "account-about": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
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
  },

  // account-reviews-db-test.mjs
  "account-reviews": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db = new PGlite();
const target='11111111-1111-4111-8111-111111111111';
const writer='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table profiles(id uuid primary key,username text,display_name text,avatar_url text,is_official boolean);
grant usage on schema public,auth to anon,authenticated;
grant select,insert,update on profiles to anon,authenticated;
insert into profiles values('${target}','target','Target',null,false),('${writer}','writer','Writer',null,true),('${other}','other','Other',null,false);`);
await db.exec(await readFile('supabase/migrations/20261008230000_account_reviews.sql','utf8'));
async function asActor(role,id,sql) {
 await db.exec('begin');
 try {await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);
 const {rows}=await db.query(sql);await db.exec('commit');return rows;
 } catch(error){await db.exec('rollback');throw error;}
}
const submit=(id,stars=5,title='ありがとう',content='いつもお世話になっています')=>`select submit_account_review('${id}',${stars},'${title}','${content}') as id`;
const read=()=>`select get_account_reviews('${target}',0) as data`;
assert.equal((await asActor('anon',null,read()))[0].data.enabled,false);
await assert.rejects(asActor('authenticated',writer,`update profiles set review=true where id='${writer}'`));
await assert.rejects(asActor('authenticated',writer,`insert into profiles(id,review) values(gen_random_uuid(),true)`));
await assert.rejects(asActor('authenticated',writer,submit(target)));
await db.exec(`update profiles set review=true where id='${target}'`);
await assert.rejects(asActor('anon',null,submit(target)));
await assert.rejects(asActor('authenticated',writer,submit(target,0)));
await assert.rejects(asActor('authenticated',writer,submit(target,6)));
await assert.rejects(asActor('authenticated',writer,submit(target,5,'title','   ')));
await assert.rejects(asActor('authenticated',writer,submit(target,5,'x'.repeat(101))));
await assert.rejects(asActor('authenticated',writer,submit(target,5,'title','x'.repeat(2001))));
const [{id}] = await asActor('authenticated',writer,submit(target));
await asActor('authenticated',other,submit(target,3));
let data=(await asActor('anon',null,read()))[0].data;
assert.equal(data.total,2);assert.equal(data.average,4);assert.equal(data.distribution['5'],1);assert.equal(data.reviews.find(r=>r.author_id===writer).author.is_official,true);
assert.equal('liked_by' in data.reviews[0],false);
// The flag belongs to the reviewed account; reviewers do not need it enabled.
assert.equal((await db.query(`select review from profiles where id='${writer}'`)).rows[0].review,false);
await asActor('authenticated',writer,submit(target,4,'更新','更新後の感想'));
data=(await asActor('anon',null,read()))[0].data;
assert.equal(data.total,2);assert.equal(data.average,3.5);assert.equal(data.reviews.find(r=>r.id===id).content,'更新後の感想');
const like=enabled=>`select set_account_review_like('${id}',${enabled}) as data`;
await asActor('authenticated',other,like(true));
await asActor('authenticated',other,like(true));
assert.equal((await asActor('authenticated',other,read()))[0].data.reviews.find(r=>r.id===id).likes_count,1);
assert.equal((await asActor('authenticated',other,read()))[0].data.reviews.find(r=>r.id===id).liked_by_me,true);
assert.equal((await asActor('authenticated',writer,read()))[0].data.reviews.find(r=>r.id===id).liked_by_me,false);
await asActor('authenticated',other,like(false));
assert.equal((await asActor('anon',null,read()))[0].data.reviews.find(r=>r.id===id).likes_count,0);
await assert.rejects(asActor('authenticated',other,`select * from account_reviews`));
await assert.rejects(asActor('authenticated',other,`update account_reviews set author_id='${other}'`));
await db.exec(`update profiles set review=false where id='${target}'`);
assert.equal((await asActor('anon',null,read()))[0].data.reviews.length,0);
await assert.rejects(asActor('authenticated',other,like(true)));
await assert.rejects(asActor('authenticated',writer,submit(target)));
assert.equal((await db.query('select count(*)::int as n from account_reviews')).rows[0].n,2);
await db.exec(`delete from profiles where id='${target}'`);
assert.equal((await db.query('select count(*)::int as n from account_reviews')).rows[0].n,0);
await db.close();
console.log('Account reviews DB checks passed: administrator-only flag, any authenticated reviewer, validation, summary, edit, idempotent likes, private like IDs, disabled visibility, cascade.');
  },

  // account-suspension-db-test.mjs
  "account-suspension": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema limenote_security;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table public.profiles(id uuid primary key,is_private boolean default false,display_name text);
create table public.posts(id uuid primary key default gen_random_uuid(),user_id uuid,visibility text default 'public',content text);
create table public.comments(id uuid primary key default gen_random_uuid(),user_id uuid,post_id uuid,content text);
create view public.timeline_posts with (security_invoker=true) as select * from public.posts;
create table public.follows(follower_id uuid,followee_id uuid,approved boolean default true);
create table public.likes(user_id uuid,post_id uuid);
create table public.chat_sessions(user_id uuid,content text);
create table public.notifications(actor_id uuid,post_id uuid);
create table storage.objects(bucket_id text,name text);
insert into profiles values('${a}',false,'A'),('${b}',false,'B');
insert into posts(user_id,content) values('${a}','A public'),('${b}','B public');
insert into comments(user_id,content) values('${a}','A reply'),('${b}','B reply');
insert into storage.objects values('post-media','${a}/image.png');
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant all on all tables in schema public,storage to authenticated,service_role;grant select on all tables in schema public,storage to anon;
create function public.test_definer_write() returns void language sql security definer set search_path='' as $$insert into public.chat_sessions values(auth.uid(),'forged RPC')$$;`);
for(const t of ['posts','comments','likes','notifications']) await db.exec(`alter table ${t} enable row level security;create policy legacy_all on ${t} for all using(true) with check(true);`);
await db.exec(`alter table storage.objects enable row level security;create policy legacy_all on storage.objects for all using(true) with check(true);`);
await db.exec(await readFile('supabase/migrations/20261012140000_account_suspension.sql','utf8'));
async function as(id,sql,role='authenticated'){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const r=await db.query(sql);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}}
const total=(await db.query('select count(*)::int n from posts')).rows[0].n;
await assert.rejects(as(b,`update profiles set "Account_suspension"=true where id='${b}'`),/administrator-managed/);
await db.exec(`update profiles set "Account_suspension"=true where id='${a}'`);
for(const id of [a,b,null]){const rows=await as(id,'select * from posts',id?'authenticated':'anon');assert.equal(rows.length,1);assert.equal(rows[0].user_id,b);}
assert.equal((await as(a,'select * from comments')).length,1);
assert.equal((await as(b,'select * from timeline_posts')).length,1);
assert.equal((await as(a,'select * from storage.objects')).length,0);
for(const sql of [`insert into posts(user_id,content) values('${a}','blocked')`,`insert into follows values('${a}','${b}',true)`,`insert into likes values('${a}',gen_random_uuid())`,`update profiles set display_name='changed' where id='${a}'`,`delete from posts where user_id='${a}'`,`select test_definer_write()`,`update profiles set "Account_suspension"=false where id='${a}'`]) await assert.rejects(as(a,sql),/ACCOUNT_SUSPENDED/);
await assert.rejects(as(a,`insert into storage.objects values('avatars','new')`),/row-level security/);
await assert.rejects(as(null,`insert into posts(user_id,content) values('${a}','bot')`,'service_role'),/ACCOUNT_SUSPENDED/);
await as(b,`insert into posts(user_id,content) values('${b}','active posting')`);
await db.exec(`update profiles set "Account_suspension"=false where id='${a}'`);
assert.equal((await as(b,'select * from posts')).length,total+1);
assert.equal((await as(a,'select * from comments')).length,2);
assert.equal((await as(a,'select * from storage.objects')).length,1);
await as(a,`select test_definer_write()`);
assert.equal((await db.query('select count(*)::int n from chat_sessions')).rows[0].n,1);
console.log('Suspension: REST/RPC writes, self-unfreeze, bots and storage blocked; browsing and complete data restoration passed.');
await db.close();
  },

  // anime-history-db-test.mjs
  "anime-history": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite(),alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',post='33333333-3333-4333-8333-333333333333';
await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table profiles(id uuid primary key,suspended boolean default false,username text);create table posts(id uuid primary key,user_id uuid references profiles(id));
create table profile_private_settings(user_id uuid primary key references profiles(id),bot_prompt text,notification_preferences jsonb default '{}'::jsonb);
create function is_account_suspended(account_id uuid) returns boolean language sql stable as $$select suspended from public.profiles where id=account_id$$;
alter table profile_private_settings enable row level security;grant usage on schema public,auth to anon,authenticated;grant select on profile_private_settings to authenticated;
create policy private_settings_owner on profile_private_settings for select to authenticated using(user_id=auth.uid());
insert into profiles values('${alice}',false,'alice'),('${bob}',false,'bob');insert into posts values('${post}','${alice}');insert into profile_private_settings(user_id,bot_prompt,notification_preferences) values('${alice}','keep','{"like":false}');`);
await db.exec(await readFile('supabase/migrations/20261018050000_anime_watch_history.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261018060000_anime_history_group_delete.sql','utf8'));
async function actor(role,id,sql,params=[]){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const r=await db.query(sql,params);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}}
const entry=(id=100,source='manual')=>({id:`annict:${id}:work`,work:{id,title:'テストアニメ',aliases:['テストアニメ'],image:'https://example.com/anime.jpg',season:'2026年秋',copyright:'',episodesCount:12},episode:null,episodeText:'',watchedAt:'2026-10-18T01:00:00Z',source,sourceUrl:'',...(source==='post'?{postId:post}:{})});
const save=(id,rows)=>actor('authenticated',id,"select update_anime_history('save',$1::jsonb) state",[JSON.stringify(rows)]);
await assert.rejects(actor('anon',null,'select get_anime_history()'));await assert.rejects(actor('authenticated',null,'select get_anime_history()'));
let [{state}]=await save(alice,[entry()]);assert.equal(state.entries.length,1);const publicState=(await actor('anon',null,"select get_anime_history(target_username=>'alice') state"))[0].state;assert.equal(publicState.entries.length,1);assert.deepEqual(publicState.ignored,[]);assert.equal(publicState.autoAdd,false);await save(alice,[entry()]);
[{state}]=await actor('authenticated',alice,'select get_anime_history() state');assert.equal(state.entries.length,1);
await save(alice,[{...entry(),source:'post',postId:post,watchedAt:'2026-10-19T00:00:00Z'}]);
[{state}]=await actor('authenticated',alice,'select get_anime_history() state');assert.equal(state.entries[0].source,'manual');
await actor('authenticated',alice,"select update_anime_history('delete',record_id=>'annict:100:work')");await save(alice,[entry(100,'post')]);
[{state}]=await actor('authenticated',alice,'select get_anime_history() state');assert.equal(state.entries.length,0);assert(state.ignored.includes('annict:100:work'));
await save(alice,[entry()]);await save(alice,[entry(101,'post')]);
await assert.rejects(save(bob,[entry(101,'post')]));assert.deepEqual((await actor('authenticated',bob,'select get_anime_history() state'))[0].state.entries,[]);
await actor('authenticated',alice,"select update_anime_history('auto',enabled=>false)");await save(alice,[entry(102,'post')]);
[{state}]=await actor('authenticated',alice,'select get_anime_history() state');assert.equal(state.entries.length,2);
await assert.rejects(save(alice,[{...entry(),work:{id:100,title:'x',image:'javascript:alert(1)'}}]));
await assert.rejects(save(alice,[{...entry(),source:'unknown'}]));await assert.rejects(save(alice,[{...entry(),id:null}]));
await assert.rejects(save(alice,Array.from({length:51},(_,i)=>entry(i+1))));
await assert.rejects(actor('authenticated',bob,`update profile_private_settings set anime_history='{}' where user_id='${alice}'`));
const [settings]=(await actor('authenticated',alice,'select bot_prompt,notification_preferences from profile_private_settings'));assert.equal(settings.bot_prompt,'keep');assert.deepEqual(settings.notification_preferences,{like:false});
const grouped=[{...entry(200),id:'annict:200:episode:1'},{...entry(200),id:'annict:200:episode:2'}];
await save(alice,grouped);await save(bob,[entry(200)]);
[{state}]=await actor('authenticated',alice,"select update_anime_history('delete_work',record_id=>'200') state");
assert(state.entries.every(e=>e.work.id!==200));assert(grouped.every(e=>state.ignored.includes(e.id)));
assert((await actor('authenticated',bob,'select get_anime_history() state'))[0].state.entries.some(e=>e.work.id===200));
await actor('authenticated',alice,"select update_anime_history('auto',enabled=>true)");await save(alice,grouped.map(e=>({...e,source:'post',postId:post})));
assert((await actor('authenticated',alice,'select get_anime_history() state'))[0].state.entries.every(e=>e.work.id!==200));
await assert.rejects(actor('anon',null,"select update_anime_history('delete_work',record_id=>'200')"));
await assert.rejects(actor('authenticated',alice,"select update_anime_history('delete_work',record_id=>'invalid')"));
await db.exec(`update profiles set suspended=true where id='${alice}'`);await assert.rejects(save(alice,[entry(103)]));
assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n,3);
await db.close();console.log('PASS: no new tables; public reads with owner-only writes; validation; idempotence; mention provenance; group deletion and tombstones; settings preservation; suspended writes rejected.');
  },

  // direct-messages-db-test.mjs
  "direct-messages": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',d='44444444-4444-4444-8444-444444444444';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
create table public.profiles(id uuid primary key,username text,display_name text,avatar_url text,is_private boolean default false,is_official boolean default false,created_at timestamptz default now());
create table public.follows(follower_id uuid,followee_id uuid,approved boolean default true);
create table public.profile_private_settings(user_id uuid primary key references profiles(id));
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
alter table storage.objects enable row level security;grant all on storage.objects to anon,authenticated;
create policy legacy_storage on storage.objects for all to anon,authenticated using(true) with check(true);
insert into profiles(id,username,display_name) values('${a}','a','A'),('${b}','b','B'),('${c}','c','C'),('${d}','d','D');`);
await db.exec(await readFile('supabase/migrations/20261010143000_direct_messages.sql','utf8'));
async function as(id,sql,role='authenticated'){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const {rows}=await db.query(sql);await db.exec('commit');return rows;}catch(e){await db.exec('rollback');throw e;}}
const call=(id,sql)=>as(id,`select ${sql} as value`).then(rows=>rows[0]?.value);
const pending=await call(a,`send_direct_message('${b}','First request')`);
assert.equal((await as(b,`select status from direct_conversations where id='${pending}'`))[0].status,'pending');
assert.equal((await as(b,`select * from direct_messages where conversation_id='${pending}'`)).length,1);
assert.equal((await as(c,`select * from direct_messages`)).length,0);
assert.equal((await as(c,`select * from direct_conversations`)).length,0);
await assert.rejects(call(a,`send_direct_message('${b}','Second request')`),/承認/);
await assert.rejects(call(b,`send_direct_message('${a}','Before approval')`),/承認/);
await assert.rejects(call(a,`respond_direct_request('${pending}',true)`));
await assert.rejects(call(c,`respond_direct_request('${pending}',true)`));
await assert.rejects(as(a,`update direct_conversations set status='accepted' where id='${pending}'`));
await assert.rejects(as(c,`insert into direct_messages(conversation_id,sender_id,content) values('${pending}','${a}','forged')`));
const inbox=await call(b,'get_direct_inbox()');assert.equal(inbox[0].unreadCount,1);assert.equal(inbox[0].peer.id,a);
const time=(await as(b,`select created_at::text from direct_messages where conversation_id='${pending}'`))[0].created_at;
await call(b,`read_direct_conversation('${pending}','${time}')`);assert.equal((await call(b,'get_direct_inbox()'))[0].unreadCount,0);
await assert.rejects(call(c,`read_direct_conversation('${pending}',now())`));
await call(b,`respond_direct_request('${pending}',true)`);await call(b,`send_direct_message('${a}','Accepted reply')`);
assert.equal((await call(a,'get_direct_inbox()'))[0].unreadCount,1);
const retryId='55555555-5555-4555-8555-555555555555';await call(a,`send_direct_message('${b}','Retry','{}','${retryId}')`);await call(a,`send_direct_message('${b}','Retry','{}','${retryId}')`);assert.equal((await as(b,`select * from direct_messages where id='${retryId}'`)).length,1);
await assert.rejects(call(b,`send_direct_message('${a}','Forged retry','{}','${retryId}')`));
await call(c,`set_dm_preferences('none')`);assert.equal(await call(c,'get_dm_preferences()'),'none');await assert.rejects(call(a,`send_direct_message('${c}','Blocked')`));await assert.rejects(call(a,`open_direct_conversation('${c}')`));
await db.exec(`insert into follows values('${a}','${c}',true),('${c}','${a}',false)`);await assert.rejects(call(a,`send_direct_message('${c}','Unapproved follow')`));await db.exec(`update follows set approved=true`);
const mutual=await call(a,`send_direct_message('${c}','Mutual despite none')`);assert.equal((await as(c,`select status from direct_conversations where id='${mutual}'`))[0].status,'accepted');
await assert.rejects(call(a,`set_dm_preferences('invalid')`));await assert.rejects(as(null,`select get_direct_inbox()`,'anon'));
const rejected=await call(d,`send_direct_message('${b}','Reject this')`);await call(b,`respond_direct_request('${rejected}',false)`);await assert.rejects(call(d,`send_direct_message('${b}','Again')`));assert.equal((await as(d,`select * from direct_messages where conversation_id='${rejected}'`)).length,0);
await assert.rejects(call(a,`send_direct_message('${a}','Self')`));await assert.rejects(call(a,`send_direct_message('${b}','')`));await assert.rejects(call(a,`send_direct_message('${b}',repeat('x',4001))`));
const path=`${mutual}/${a}/picture`;
await as(a,`insert into storage.objects(bucket_id,name) values('direct-message-media','${path}')`);
await call(a,`send_direct_message('${c}','','{${path}}')`);
assert.equal((await as(c,`select * from storage.objects where name='${path}'`)).length,1);
assert.equal((await as(b,`select * from storage.objects where name='${path}'`)).length,0);
await assert.rejects(as(b,`insert into storage.objects(bucket_id,name) values('direct-message-media','${mutual}/${a}/forged')`));
await as(a,`delete from storage.objects where name='${path}'`);assert.equal((await as(a,`select * from storage.objects where name='${path}'`)).length,1);
await assert.rejects(call(a,`send_direct_message('${b}','','{${path}}')`));
await db.exec(`insert into storage.objects(bucket_id,name) values('avatars','public-avatar')`);
assert.equal((await as(null,`select * from storage.objects where bucket_id='avatars'`,'anon')).length,1);
assert.equal((await as(null,`select * from storage.objects where bucket_id='direct-message-media'`,'anon')).length,0);
assert.equal((await db.query("select public from storage.buckets where id='direct-message-media'")).rows[0].public,false);
console.log('DM permissions, requests, mutual follows, unread state, retries and private attachments passed.');

await db.exec(await readFile('supabase/migrations/20261010163000_chat_inbox_actions.sql','utf8'));
await call(a,`set_chat_inbox_preference('${pending}','pins',true)`);
assert.equal((await call(a,'get_chat_inbox_preferences()')).pins[pending],true);
assert.equal((await call(b,'get_chat_inbox_preferences()')).pins[pending],undefined);
const peerBefore=await as(b,`select * from direct_messages where conversation_id='${pending}'`);
await assert.rejects(call(c,`delete_direct_chat('${pending}')`));
await call(a,`delete_direct_chat('${pending}')`);
assert.equal((await as(a,`select * from direct_messages where conversation_id='${pending}'`)).length,0);
assert.equal((await as(b,`select * from direct_messages where conversation_id='${pending}'`)).length,peerBefore.length);
assert.equal((await call(a,'get_direct_inbox()')).some(row=>row.id===pending),false);
assert.equal((await call(b,'get_direct_inbox()')).some(row=>row.id===pending),true);
await call(b,`send_direct_message('${a}','After deletion')`);
assert.deepEqual((await as(a,`select content from direct_messages where conversation_id='${pending}'`)).map(row=>row.content),['After deletion']);
assert.equal((await call(a,'get_direct_inbox()')).find(row=>row.id===pending).unreadCount,1);
await assert.rejects(call(a,`set_chat_inbox_preference('limeai','hidden',true)`));
await call(a,`set_chat_inbox_preference('friend:custom:owned','hidden',true)`);
assert.equal((await call(a,'get_chat_inbox_preferences()')).hidden['friend:custom:owned'],true);
console.log('Chat inbox pinning, per-viewer deletion, future arrivals and access isolation passed');

await db.exec(await readFile('supabase/migrations/20261010180000_cloudinary_direct_media.sql','utf8'));
const cloudRef=`cloudinary:direct_messages/${mutual}/${a}/66666666-6666-4666-8666-666666666666`;
const register=`register_direct_media('${mutual}','${a}','${cloudRef}','png')`;
await assert.rejects(call(a,register),/permission denied/);
await as(null,`select ${register}`,'service_role');
await assert.rejects(call(c,`send_direct_message('${a}','','{${cloudRef}}')`),/Invalid attachment/);
await call(a,`send_direct_message('${c}','','{${cloudRef}}')`);
assert.equal((await as(c,`select * from direct_messages where '${cloudRef}'=any(attachments)`)).length,1);
assert.equal((await as(null,`select release_direct_media('${mutual}','${a}','${cloudRef}') as value`,'service_role'))[0].value,false);
const unused=cloudRef.replace('66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777');
await as(null,`select register_direct_media('${mutual}','${a}','${unused}','jpg')`,'service_role');
assert.equal((await as(null,`select release_direct_media('${mutual}','${c}','${unused}') as value`,'service_role'))[0].value,false);
assert.equal((await as(null,`select release_direct_media('${mutual}','${a}','${unused}') as value`,'service_role'))[0].value,true);
await assert.rejects(as(a,`insert into storage.objects(bucket_id,name) values('direct-message-media','${path}-new')`),/row-level security/);
assert.equal((await as(c,`select * from storage.objects where name='${path}'`)).length,1);
await assert.rejects(as(null,`select register_direct_media('${mutual}','${b}','${cloudRef}','png')`,'service_role'),/Invalid asset/);
console.log('Cloudinary registration, ownership, sent-media retention, legacy reads and Supabase upload blocking passed');
await db.exec(await readFile('supabase/migrations/20261010190000_profile_direct_permission.sql','utf8'));
assert.equal(await call(a,`can_direct_message('${b}')`),true);
assert.equal(await call(a,`can_direct_message('${a}')`),false);
assert.equal(await call(d,`can_direct_message('${b}')`),false);
assert.equal(await call(d,`can_direct_message('${c}')`),false);
assert.equal(await call(a,`can_direct_message('${c}')`),true);
assert.equal(await call(b,`can_direct_message('${d}')`),false);
assert.equal(await call(c,`can_direct_message('${b}')`),true);
await assert.rejects(as(null,`select can_direct_message('${b}')`,'anon'),/permission denied/);
console.log('Profile DM visibility: requests, mutual follows, self, declined conversations and authentication passed');
await db.exec(`alter table profile_private_settings add column notification_preferences jsonb not null default '{}';
create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,actor_id uuid,type text,actor_name text,actor_username text,actor_avatar_url text,actor_is_official boolean,content_preview text,event_key text,is_read boolean default false,created_at timestamptz default now());
create unique index notifications_event_key_unique on notifications(user_id,event_key) where event_key is not null;
alter table notifications enable row level security;grant select on notifications to authenticated;
create policy notification_owner on notifications for select to authenticated using(user_id=auth.uid());
create function notification_enabled(recipient uuid,kind text) returns boolean language sql stable security definer as $$select coalesce((select notification_preferences->kind<>'false'::jsonb from public.profile_private_settings where user_id=recipient),true)$$;`);
await db.exec(await readFile('supabase/migrations/20261010200000_direct_message_notifications.sql','utf8'));
const notifiedId='99999999-9999-4999-8999-999999999999';
await db.exec(`update profiles set is_private=true where id='${a}'`);
await call(a,`send_direct_message('${c}','Private sender DM','{}','${notifiedId}')`);
let notices=await as(c,`select * from notifications`);assert.equal(notices.length,1);assert.equal(notices[0].type,'dm');assert.equal(notices[0].content_preview,'Private sender DM');assert.equal(notices[0].conversation_id,mutual);assert.equal(notices[0].direct_message_id,notifiedId);
assert.equal((await as(b,`select * from notifications`)).length,0);assert.equal((await as(a,`select * from notifications`)).length,0);
await call(a,`send_direct_message('${c}','Retry','{}','${notifiedId}')`);assert.equal((await as(c,`select * from notifications`)).length,1);
await call(c,`read_direct_conversation('${mutual}',now())`);assert.equal((await as(c,`select is_read from notifications`))[0].is_read,true);
await call(c,`set_notification_preference('dm',false)`);await call(a,`send_direct_message('${c}','Muted DM')`);assert.equal((await as(c,`select * from notifications`)).length,1);
const request=await call(d,`send_direct_message('${a}','New request')`);notices=await as(a,`select * from notifications`);assert.equal(notices[0].type,'dm_request');assert.equal(notices[0].conversation_id,request);
await call(a,`respond_direct_request('${request}',false)`);assert.equal((await as(a,`select is_read from notifications`))[0].is_read,true);
await call(c,`set_notification_preference('dm',true)`);await call(a,`send_direct_message('${c}','','{${cloudRef}}')`);assert.equal((await as(c,`select content_preview from notifications where not is_read`))[0].content_preview,'画像を送信しました');
await call(c,`delete_direct_chat('${mutual}')`);assert.equal((await as(c,`select * from notifications where not is_read`)).length,0);
await assert.rejects(as(a,`insert into notifications(user_id,type)values('${b}','dm')`),/permission denied/);
console.log('DM/request notification events, private sender, image preview, retry deduplication, preferences and read/delete synchronization passed');
await db.exec(await readFile('supabase/migrations/20261010213000_group_direct_messages.sql','utf8'));
await call(c,`set_dm_preferences('everyone')`);
const group=await call(a,`create_group_direct_conversation(array['${b}'::uuid,'${c}'::uuid],'Group')`);
let summary=await call(a,`get_group_direct_conversation('${group}')`);
assert.equal(summary.members.length,3);assert.equal(summary.isGroup,true);assert.equal(summary.members.find(m=>m.id===a).admin,true);
assert.equal(summary.members.find(m=>m.id===b).status,'pending');assert.equal(summary.members.find(m=>m.id===c).status,'accepted');
assert.equal((await as(b,`select * from direct_messages where conversation_id='${group}'`)).length,0);
assert.equal((await as(d,`select * from direct_conversations where id='${group}'`)).length,0);
await assert.rejects(call(d,`get_group_direct_conversation('${group}')`));
await assert.rejects(call(b,`send_group_direct_message('${group}','unapproved')`));
await call(b,`respond_direct_request('${group}',true)`);
await call(a,`send_group_direct_message('${group}','Group first')`);
assert.equal((await as(b,`select * from direct_messages where conversation_id='${group}' and content='Group first'`)).length,1);
assert.equal((await as(d,`select * from direct_messages where conversation_id='${group}'`)).length,0);
assert.equal((await call(b,'get_direct_inbox()')).find(g=>g.id===group).unreadCount,1);
await call(b,`read_direct_conversation('${group}',now())`);assert.equal((await call(b,'get_direct_inbox()')).find(g=>g.id===group).unreadCount,0);
await assert.rejects(call(b,`update_group_direct_conversation('${group}','Forged','','',true)`));
await call(a,`update_group_direct_conversation('${group}','Renamed','Description','',true)`);
assert.equal((await call(b,`get_group_direct_conversation('${group}')`)).peer.displayName,'Renamed');
const groupMedia=`cloudinary:direct_messages/${group}/${a}/77777777-7777-4777-8777-777777777777`;
await as(null,`select register_direct_media('${group}','${a}','${groupMedia}','png')`,'service_role');
await assert.rejects(as(null,`select register_direct_media('${group}','${d}','cloudinary:direct_messages/${group}/${d}/77777777-7777-4777-8777-777777777777','png')`,'service_role'));
await assert.rejects(call(b,`send_group_direct_message('${group}','','{${groupMedia}}')`));
await call(a,`send_group_direct_message('${group}','','{${groupMedia}}')`);
await call(b,`delete_direct_chat('${group}')`);assert.equal((await as(b,`select * from direct_messages where conversation_id='${group}'`)).length,0);assert.ok((await as(c,`select * from direct_messages where conversation_id='${group}'`)).length>0);
await call(a,`send_group_direct_message('${group}','After group delete')`);assert.deepEqual((await as(b,`select content from direct_messages where conversation_id='${group}'`)).map(m=>m.content),['After group delete']);
const beforeMute=(await as(c,`select * from notifications where conversation_id='${group}'`)).length;await call(c,`set_group_direct_muted('${group}',true)`);await call(a,`send_group_direct_message('${group}','Muted group')`);assert.equal((await as(c,`select * from notifications where conversation_id='${group}'`)).length,beforeMute);
await assert.rejects(call(b,`set_group_direct_invite('${group}',true)`));
const token=await call(a,`set_group_direct_invite('${group}',true)`);assert.equal(token.length,64);
assert.equal((await call(d,`get_group_direct_invitation('${token}')`)).memberCount,3);
await call(d,`request_group_direct_join('${token}')`);assert.equal((await as(d,`select * from direct_messages where conversation_id='${group}'`)).length,0);
assert.equal((await call(a,`get_group_direct_conversation('${group}')`)).requests.length,1);await assert.rejects(call(b,`manage_group_direct_member('${group}','${d}','approve')`));
await call(a,`manage_group_direct_member('${group}','${d}','approve')`);assert.equal((await as(d,`select * from direct_messages where conversation_id='${group}'`)).length,0);
await call(a,`send_group_direct_message('${group}','After join')`);assert.equal((await as(d,`select * from direct_messages where conversation_id='${group}'`)).length,1);
await call(a,`set_group_direct_invite('${group}',false)`);await assert.rejects(call(d,`request_group_direct_join('${token}')`));
await assert.rejects(call(a,`manage_group_direct_member('${group}','${a}','remove')`));await call(a,`manage_group_direct_member('${group}','${b}','admin')`);await call(a,`manage_group_direct_member('${group}','${a}','remove')`);
assert.equal((await as(a,`select * from direct_messages where conversation_id='${group}'`)).length,0);await assert.rejects(call(a,`send_group_direct_message('${group}','After leave')`));
assert.ok((await call(b,'get_direct_inbox()')).some(g=>g.id===group));
await call(d,`set_dm_preferences('none')`);await assert.rejects(call(c,`create_group_direct_conversation(array['${b}'::uuid,'${d}'::uuid])`));
await call(b,`update_group_direct_conversation('${group}','Renamed','Description','',true,86400)`);
await call(b,`send_group_direct_message('${group}','Expiring')`);
const expiry=(await as(c,`select expires_at from direct_messages where conversation_id='${group}' and content='Expiring'`))[0].expires_at;assert.ok(expiry);
await db.exec(`update direct_messages set expires_at=now()-interval '1 second' where conversation_id='${group}' and content='Expiring'`);
assert.equal((await as(c,`select * from direct_messages where conversation_id='${group}' and content='Expiring'`)).length,0);
console.log('Group creation, requests, member RLS, media ownership, unread/deletion, notifications, mute, edits, invitation approval/revocation and admin transfer passed');
await db.exec(await readFile('supabase/migrations/20261010220000_group_ai_friends.sql','utf8'));
const friendDefs=JSON.stringify([{id:'builtin:one',name:'One',avatar:'',prompt:'Friendly'},{id:'custom:two',name:'Two',avatar:'',prompt:'Quiet'}]);
const aiGroup=await call(a,`create_group_with_friends('{}','${friendDefs}'::jsonb)`);
const aiSummary=await call(a,`get_group_direct_conversation('${aiGroup}')`);assert.equal(aiSummary.friends.length,2);
assert.equal((await as(b,`select * from direct_conversations where id='${aiGroup}'`)).length,0);
await assert.rejects(call(b,`add_group_ai_friends('${aiGroup}','[]')`));
await assert.rejects(call(b,`remove_group_ai_friend('${aiGroup}','${a}:builtin:one')`));
const aiTrigger=crypto.randomUUID();await call(a,`send_group_direct_message('${aiGroup}','Hello','{}','${aiTrigger}')`);
await assert.rejects(call(a,`save_group_friend_reply('${aiGroup}','${a}','${aiTrigger}','${a}:builtin:one','Fake')`),/permission denied/);
await db.query(`select save_group_friend_reply($1,$2,$3,$4,'Reply')`,[aiGroup,a,aiTrigger,`${a}:builtin:one`]);
await db.query(`select save_group_friend_reply($1,$2,$3,$4,'Retry')`,[aiGroup,a,aiTrigger,`${a}:builtin:one`]);
const aiReplies=await as(a,`select * from direct_messages where reply_to='${aiTrigger}'`);assert.equal(aiReplies.length,1);assert.equal(aiReplies[0].friend_name,'One');
await assert.rejects(db.query(`select save_group_friend_reply($1,$2,$3,$4,'Fake actor')`,[aiGroup,b,aiTrigger,`${a}:builtin:one`]));
await call(a,`remove_group_ai_friend('${aiGroup}','${a}:builtin:one')`);assert.equal((await call(a,`get_group_direct_conversation('${aiGroup}')`)).friends.length,1);
await assert.rejects(db.query(`select save_group_friend_reply($1,$2,$3,$4,'Removed')`,[aiGroup,a,aiTrigger,`${a}:builtin:one`]));
assert.equal((await as(a,`select friend_name from direct_messages where reply_to='${aiTrigger}'`))[0].friend_name,'One');
console.log('Multiple AI friends, isolated group membership, server-only attribution, idempotent replies and removal passed');
await db.exec(await readFile('supabase/migrations/20261010223000_group_invite_friend_count.sql','utf8'));
const aiInvite=await call(a,`set_group_direct_invite('${aiGroup}',true)`);assert.equal((await call(b,`get_group_direct_invitation('${aiInvite}')`)).memberCount,2);
await db.exec(await readFile('supabase/migrations/20261010233000_preserve_chat_history.sql','utf8'));
assert.equal((await as(c,`select content from direct_messages where conversation_id='${group}' and content='Expiring'`)).length,1);
assert.equal((await db.query("select column_name from information_schema.columns where table_name in('direct_conversations','direct_messages') and column_name in('expires_at','disappearing_seconds')")).rows.length,0);
await call(b,`update_group_direct_conversation('${group}','Permanent','No expiry','',true,86400)`);
await call(b,`send_group_direct_message('${group}','Permanent message')`);
assert.equal((await call(b,`get_group_direct_conversation('${group}')`)).peer.displayName,'Permanent');
assert.ok((await call(b,'get_direct_inbox()')).some(g=>g.id===group));
const permanentTrigger=crypto.randomUUID();await call(a,`send_group_direct_message('${aiGroup}','Permanent AI','{}','${permanentTrigger}')`);
await db.query(`select save_group_friend_reply($1,$2,$3,$4,'Permanent AI reply')`,[aiGroup,a,permanentTrigger,`${a}:custom:two`]);
assert.equal((await as(a,`select content from direct_messages where reply_to='${permanentTrigger}'`))[0].content,'Permanent AI reply');
assert.equal((await as(d,`select * from direct_messages where conversation_id='${aiGroup}'`)).length,0);
console.log('Disappearing-message settings/columns removed; old expired content restored; permanent human and friend messages keep access isolation');
await db.exec(await readFile('supabase/migrations/20261011000000_direct_message_actions.sql','utf8'));
const actionsMessage=crypto.randomUUID();await call(a,`send_group_direct_message('${aiGroup}','Reaction test','{}','${actionsMessage}')`);
await call(a,`toggle_direct_reaction('${actionsMessage}','👍')`);
assert.equal((await as(a,`select reactions from direct_messages where id='${actionsMessage}'`))[0].reactions['👍'][a],true);
await call(a,`toggle_direct_reaction('${actionsMessage}','👍')`);
assert.deepEqual((await as(a,`select reactions from direct_messages where id='${actionsMessage}'`))[0].reactions,{});
await assert.rejects(call(d,`toggle_direct_reaction('${actionsMessage}','👍')`));
await assert.rejects(call(a,`toggle_direct_reaction('${actionsMessage}','not emoji')`));
const pairAction=crypto.randomUUID();await call(a,`send_direct_message('${b}','Delete test','{}','${pairAction}')`);
await assert.rejects(call(b,`delete_direct_message('${pairAction}',true)`));
await call(b,`delete_direct_message('${pairAction}',false)`);
assert.equal((await as(b,`select * from direct_messages where id='${pairAction}'`)).length,0);
assert.equal((await as(a,`select * from direct_messages where id='${pairAction}'`)).length,1);
assert.ok(!(await call(b,'get_direct_inbox()')).some(c=>c.preview==='Delete test'));
await assert.rejects(call(b,`toggle_direct_reaction('${pairAction}','👍')`));
await call(a,`delete_direct_message('${pairAction}',true)`);
assert.equal((await as(a,`select * from direct_messages where id='${pairAction}'`)).length,0);
await call(a,`delete_direct_message('${actionsMessage}',true)`);
assert.equal((await as(a,`select * from direct_messages where id='${actionsMessage}'`)).length,0);
await assert.rejects(call(a,`toggle_direct_reaction('${actionsMessage}','👍')`));
console.log('Reaction toggles, invalid emoji/nonmember rejection, viewer-only deletion, author-only global deletion, inbox and RLS passed');
await db.exec(await readFile('supabase/migrations/20261011003000_friend_message_reactions.sql','utf8'));
const reactionTrigger=crypto.randomUUID();await call(a,`send_group_direct_message('${aiGroup}','Friend reaction','{}','${reactionTrigger}')`);
await db.query(`select save_group_friend_reply($1,$2,$3,$4,'Friend reply','👍')`,[aiGroup,a,reactionTrigger,`${a}:custom:two`]);
const friendReaction=(await as(a,`select reactions from direct_messages where id='${reactionTrigger}'`))[0].reactions;
assert.deepEqual(Object.keys(friendReaction['👍']),[`friend:${a}:custom:two`]);
await db.query(`select save_group_friend_reply($1,$2,$3,$4,'Retry','❤️')`,[aiGroup,a,reactionTrigger,`${a}:custom:two`]);
assert.deepEqual((await as(a,`select reactions from direct_messages where id='${reactionTrigger}'`))[0].reactions,friendReaction);
await assert.rejects(call(a,`save_group_friend_reply('${aiGroup}','${a}','${reactionTrigger}','${a}:custom:two','Fake','👍')`),/permission denied/);
await assert.rejects(db.query(`select save_group_friend_reply($1,$2,$3,$4,'Invalid','oops')`,[aiGroup,a,reactionTrigger,`${a}:custom:two`]));
console.log('AI friend reaction attribution, atomic reply/reaction save, retry deduplication and client spoof rejection passed');
const replyId=crypto.randomUUID();await call(a,`send_direct_reply('${reactionTrigger}','Reply to the original','{}','${replyId}')`);
assert.equal((await as(a,`select reply_to from direct_messages where id='${replyId}'`))[0].reply_to,reactionTrigger);
await call(a,`send_direct_reply('${reactionTrigger}','Retry','{}','${replyId}')`);
await assert.rejects(call(d,`send_direct_reply('${reactionTrigger}','Not a member','{}',gen_random_uuid())`));
await call(a,`delete_direct_message('${reactionTrigger}',true)`);
await assert.rejects(call(a,`send_direct_reply('${reactionTrigger}','Deleted','{}',gen_random_uuid())`));
console.log('Reply persistence, retry deduplication and hidden/deleted/nonmember parent protection passed');
// Before hardening, even ordinary participants could select the invite secret.
const privateToken=await call(b,`set_group_direct_invite('${group}',true)`);
assert.equal((await as(c,`select invite_token from direct_conversations where id='${group}'`))[0].invite_token,privateToken);
await db.exec(await readFile('supabase/migrations/20261012030000_private_conversation_columns.sql','utf8'));
for(const field of ['invite_token','group_requests','group_members','media_assets','group_friends','read_low','deleted_high']) {
 await assert.rejects(as(c,`select ${field} from direct_conversations where id='${group}'`),/permission denied/);
}
await assert.rejects(as(c,`select * from direct_conversations where id='${group}'`),/permission denied/);
assert.equal((await as(c,`select id,is_group from direct_conversations where id='${group}'`)).length,1);
assert.equal((await as(a,`select id from direct_conversations where id='${group}'`)).length,0);
assert.equal((await call(c,`get_group_direct_conversation('${group}')`)).inviteToken,null);
assert.equal((await call(b,`get_group_direct_conversation('${group}')`)).inviteToken,privateToken);
assert.ok((await call(c,'get_direct_inbox()')).some(entry=>entry.id===group));
assert.ok((await as(c,`select id from direct_messages where conversation_id='${group}'`)).length>0);
await assert.rejects(as(b,`select hidden_by from direct_messages where conversation_id='${group}'`),/permission denied/);
await assert.rejects(as(b,`select * from direct_messages where conversation_id='${group}'`),/permission denied/);
assert.ok((await as(b,`select id,content,attachments,reactions from direct_messages where conversation_id='${group}'`)).length>0);
assert.ok((await db.query("select relreplident from pg_class where relname in ('direct_messages','direct_conversations')")).rows.every(row=>row.relreplident==='d'));
console.log('Confirmed invite-token exploit blocked; sensitive column grants denied, admin summaries and participant message RLS preserved');
await db.close();
  },

  // external-accounts-db-test.mjs
  "external-accounts": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
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
  },

  // external-follows-db-test.mjs
  "external-follows": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table profiles(id uuid primary key);insert into profiles values('${a}'),('${b}');
create table follows(follower_id uuid references profiles(id),followee_id uuid references profiles(id) not null,created_at timestamptz not null default now(),primary key(follower_id,followee_id),check(follower_id<>followee_id));insert into follows values('${a}','${b}',now());
alter table follows enable row level security;create policy read on follows for select using(true);create policy own_insert on follows for insert with check(follower_id=auth.uid());create policy own_delete on follows for delete using(follower_id=auth.uid());
create table profile_private_settings(user_id uuid primary key,external_accounts_imported_at timestamptz);insert into profile_private_settings values('${a}',now());
create table external_account_users(user_id uuid,provider text,handle text,created_at timestamptz default now());insert into external_account_users(user_id,provider,handle) values('${a}','bluesky','artist.bsky.social'),('${a}','misskey','artist@misskey.io');
create function notify_account_activity() returns trigger language plpgsql as $$begin if new.followee_id is null then raise exception 'Native notification for external user';end if;return new;end$$;create trigger notify_account_activity after insert on follows for each row execute function notify_account_activity();
grant usage on schema public,auth to authenticated,anon;grant select on follows to anon,authenticated;grant insert,delete on follows to authenticated;`);
await db.exec(await readFile('supabase/migrations/20261009030000_unify_external_follows.sql','utf8'));
async function actor(id,sql,params=[]){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec('set local role authenticated');const rows=(await db.query(sql,params)).rows;await db.exec('commit');return rows;}catch(error){await db.exec('rollback');throw error;}}
assert.equal((await db.query('select count(*)::int n from follows')).rows[0].n,3);
assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")).rows[0].n,3);
assert.equal((await actor(a,'select * from external_account_users where user_id=$1',[a])).length,2);
const follow=(id,enabled,profile=null)=>actor(id,'select set_external_follow($1,$2,$3,$4)',['bluesky','new.bsky.social',enabled,profile]);
await follow(a,true,{displayName:'New artist'});await follow(a,true);assert.equal((await db.query('select count(*)::int n from follows')).rows[0].n,4);
await follow(b,false);assert.equal((await db.query('select count(*)::int n from follows')).rows[0].n,4);
await assert.rejects(follow(null,true));
await assert.rejects(actor(b,'insert into follows(follower_id,external_provider,external_handle) values($1,$2,$3)',[a,'bluesky','forged.bsky.social']));
await follow(a,false);await actor(a,'select import_external_account_users($1)',[[{provider:'bluesky',handle:'new.bsky.social'}]]);assert.equal((await db.query('select count(*)::int n from follows')).rows[0].n,3);
assert.equal((await db.query('select count(*)::int n from follows where followee_id is not null')).rows[0].n,1);
// Exercise the same authenticated INSERT ... ON CONFLICT DO NOTHING used by
// the client bulk import; keep the deployed X handle constraint.
const xSchema=await readFile('supabase/migrations/20261016043000_x_external_posts.sql','utf8');
await db.exec(xSchema.slice(xSchema.indexOf('alter table public.follows'),xSchema.indexOf('alter table public.bookmarks')));
const bulk=`insert into follows(follower_id,external_provider,external_handle,external_profile) values($1,'x','artist','{"id":"x-user:123","username":"artist@twitter.com","followImport":{"kind":"public-follow-import","source":"x","actor":"owner@twitter.com"}}'),($1,'bluesky','imported-new.bsky.social','{"followImport":{"kind":"public-follow-import","source":"bluesky","actor":"owner.bsky.social"}}'),($1,'bluesky','artist.bsky.social',null) on conflict(follower_id,follow_key) do nothing returning external_handle`;
assert.deepEqual((await actor(a,bulk,[a])).map(row=>row.external_handle).sort(),['artist','imported-new.bsky.social']);
assert.equal((await actor(a,bulk,[a])).length,0);
await assert.rejects(actor(b,bulk,[a]));
await assert.rejects(actor(a,`insert into follows(follower_id,external_provider,external_handle) values($1,'x','invalid handle')`,[a]));
assert.equal((await db.query('select count(*)::int n from follows where followee_id is not null')).rows[0].n,1);
await actor(a,`insert into follows(follower_id,external_provider,external_handle) values($1,'x','manual')`,[a]);
const removeImported=`delete from follows where follower_id=$1 and external_provider in ('x','bluesky') and external_profile->'followImport'->>'kind'='public-follow-import' returning external_handle`;
assert.equal((await actor(b,removeImported,[a])).length,0);
assert.deepEqual((await actor(a,removeImported,[a])).map(row=>row.external_handle).sort(),['artist','imported-new.bsky.social']);
assert.equal((await actor(a,removeImported,[a])).length,0);
assert.equal((await db.query("select count(*)::int n from follows where external_handle in ('manual','artist.bsky.social')")).rows[0].n,2);
assert.equal((await db.query('select count(*)::int n from follows where followee_id is not null')).rows[0].n,1);
await db.close();console.log('Unified follows: legacy rows/native follows preserved, no new table, public list, idempotency, own writes, anonymous rejection and no native external notifications passed.');
  },

  // external-likes-db-test.mjs
  "external-likes": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',p='33333333-3333-4333-8333-333333333333';
await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table profiles(id uuid primary key);insert into profiles values('${a}'),('${b}');
create table posts(id uuid primary key,user_id uuid,visibility text,likes_count int default 0);insert into posts values('${p}','${a}','public',1);
alter table posts enable row level security;create policy visible on posts for select using(visibility='public' or user_id=auth.uid());
create table likes(post_id uuid not null references posts(id),user_id uuid not null references profiles(id),created_at timestamptz not null default now(),primary key(post_id,user_id),unique(post_id,user_id));insert into likes(post_id,user_id) values('${p}','${b}');alter table likes enable row level security;create policy read_likes on likes for select using(true);create policy own on likes for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create table profile_private_settings(user_id uuid primary key references profiles(id),bot_prompt text default 'private');alter table profile_private_settings enable row level security;create policy own on profile_private_settings for select using(user_id=auth.uid());insert into profile_private_settings(user_id) values('${a}');
create function notify_account_activity() returns trigger language plpgsql as $$begin if new.post_id is null then raise exception 'Native notification invoked for external like';end if;return new;end$$;create trigger notify_account_activity after insert on likes for each row execute function notify_account_activity();
create function handle_post_like_count() returns trigger language plpgsql security definer as $$begin if TG_OP='INSERT' then update public.posts set likes_count=likes_count+1 where id=new.post_id;else update public.posts set likes_count=likes_count-1 where id=old.post_id;end if;return null;end$$;create trigger on_post_liked_v2 after insert or delete on likes for each row execute function handle_post_like_count();
grant usage on schema public,auth to anon,authenticated;grant select on posts,profiles,profile_private_settings to anon,authenticated;grant select,insert,update,delete on likes to authenticated;grant select on likes to anon;`);
await db.exec(await readFile('supabase/migrations/20261009013000_external_likes_and_recommendation_feedback.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261009024000_recommendation_feedback_visual_enrichment.sql','utf8'));
async function actor(role,id,sql,params=[]){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const result=await db.query(sql,params);await db.exec('commit');return result.rows;}catch(e){await db.exec('rollback');throw e;}}
const id='bsky:at://did:plc:test/app.bsky.feed.post/abc',snapshot={id,visibility:'public',userId:'bsky:did:plc:test',content:'',imageUrls:['https://example.com/art.jpg'],author:{id:'bsky:did:plc:test',username:'artist'}};
const save=(owner,s=snapshot,enabled=true,mirrored=false)=>actor('authenticated',owner,'select set_external_like($1,$2,$3) result',[s,enabled,mirrored]);
assert.equal((await db.query('select count(*)::int n from likes')).rows[0].n,1);
assert.equal((await save(a))[0].result.count,1);assert.equal((await save(a))[0].result.count,1);
assert.equal((await db.query('select likes_count from posts')).rows[0].likes_count,1);
assert.equal((await save(b))[0].result.count,2);assert.equal((await save(a,snapshot,true,true))[0].result.unmirroredCount,1);
assert.equal((await actor('anon',null,'select * from external_like_states($1)',[[id]]))[0].liked,false);
assert.equal((await actor('authenticated',a,'select * from external_like_states($1)',[[id]]))[0].liked,true);
await assert.rejects(save(null));await assert.rejects(save(a,{...snapshot,visibility:'private'}));await assert.rejects(save(a,{...snapshot,id:p}));
await assert.rejects(actor('authenticated',a,'insert into likes(user_id,external_post_id,post_snapshot) values($1,$2,$3)',[b,'bsky:at://did:plc:test/app.bsky.feed.post/forged',{...snapshot,id:'bsky:at://did:plc:test/app.bsky.feed.post/forged'}]));
await actor('authenticated',a,'delete from likes where user_id=$1',[b]);assert.equal((await db.query('select count(*)::int n from likes where user_id=$1',[b])).rows[0].n,2);
await actor('authenticated',a,'select dismiss_recommendation($1)',[{id,userId:snapshot.userId}]);
assert.equal((await actor('authenticated',a,'select recommendation_feedback from profile_private_settings'))[0].recommendation_feedback.length,1);
assert.equal((await actor('authenticated',b,'select * from profile_private_settings')).length,0);
const beforeEnrich=(await actor('authenticated',a,'select recommendation_feedback from profile_private_settings'))[0].recommendation_feedback[0];
const enrichment={id,userId:snapshot.userId,enrichment:true,vector:Array(512).fill(.01),imageUrls:snapshot.imageUrls,visualKind:'moe'};
await actor('authenticated',a,'select dismiss_recommendation($1)',[enrichment]);
const afterEnrich=(await actor('authenticated',a,'select recommendation_feedback from profile_private_settings'))[0].recommendation_feedback[0];
assert.equal(afterEnrich.createdAt,beforeEnrich.createdAt);assert.equal(afterEnrich.vector.length,512);
await actor('authenticated',b,'select dismiss_recommendation($1)',[enrichment]);assert.equal((await actor('authenticated',b,'select * from profile_private_settings')).length,0);
await save(a);assert.equal((await actor('authenticated',a,'select recommendation_feedback from profile_private_settings'))[0].recommendation_feedback.length,0);
await actor('authenticated',a,'select dismiss_recommendation($1)',[enrichment]);assert.equal((await actor('authenticated',a,'select recommendation_feedback from profile_private_settings'))[0].recommendation_feedback.length,0);
await assert.rejects(actor('authenticated',a,'select dismiss_recommendation($1)',[{...enrichment,vector:[1]}]));
await assert.rejects(actor('authenticated',a,'select dismiss_recommendation($1)',[{}]));await assert.rejects(actor('anon',null,'select dismiss_recommendation($1)',[{id,userId:'x'}]));
const misskey={...snapshot,id:'misskey:https://misskey.io/notes/abc123',userId:'misskey-user:artist'};await save(a,misskey);
assert.equal((await save(a,snapshot,false))[0].result.liked,false);assert.equal((await save(a,snapshot,false))[0].result.count,1);
await actor('authenticated',a,`insert into likes(post_id,user_id) values('${p}','${a}') on conflict(post_id,user_id) do nothing`);assert.equal((await db.query('select likes_count from posts')).rows[0].likes_count,2);
assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n,4);
assert.equal((await db.query('select bot_prompt from profile_private_settings where user_id=$1',[a])).rows[0].bot_prompt,'private');
// Reproduce the production policy reset that hides external likes with no native post_id.
await db.exec(`drop policy security_visible_parent on likes;drop policy security_insert_visible_parent on likes;
create policy security_visible_parent on likes as restrictive for select to anon,authenticated using(exists(select 1 from posts where id=likes.post_id));
create policy security_insert_visible_parent on likes as restrictive for insert to anon,authenticated with check(exists(select 1 from posts where id=likes.post_id));`);
assert.equal((await actor('authenticated',a,'select * from likes where external_post_id is not null')).length,0,'reproduces external likes missing from the profile');
await db.exec(await readFile('supabase/migrations/20261019070000_restore_external_likes_visibility.sql','utf8'));
assert.equal((await actor('authenticated',a,'select * from likes where external_post_id is not null')).length,2,'existing Bluesky and Misskey likes become visible without rewriting data');
assert.equal((await actor('anon',null,'select * from likes where external_post_id is not null')).length,2,'public external likes remain visible');
const another={...misskey,id:'misskey:https://misskey.io/notes/another'};
await actor('authenticated',a,'insert into likes(user_id,external_post_id,post_snapshot) values($1,$2,$3)',[a,another.id,another]);
await assert.rejects(actor('authenticated',a,'insert into likes(user_id,external_post_id,post_snapshot) values($1,$2,$3)',[b,another.id,another]));
await db.exec(`insert into posts(id,user_id,visibility)values('44444444-4444-4444-8444-444444444444','${b}','private');insert into likes(post_id,user_id)values('44444444-4444-4444-8444-444444444444','${b}');`);
assert.equal((await actor('anon',null,`select * from likes where post_id='44444444-4444-4444-8444-444444444444'`)).length,0,'native private post likes stay hidden');
await assert.rejects(actor('authenticated',a,'insert into likes(user_id,external_post_id,post_snapshot) values($1,$2,$3)',[a,'misskey:https://misskey.io/notes/private',{...another,id:'misskey:https://misskey.io/notes/private',visibility:'private'}]));
await db.close();console.log('External likes DB checks passed: existing native rows/counts/upserts retained, no new tables, both provider IDs, idempotency, mirror counts, owner isolation, no external native notifications, private feedback and positive override.');
  },

  // free-tier-db-test.mjs
  "free-tier": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();
await db.exec(`create role authenticated;create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table posts(id uuid primary key,user_id uuid,created_at timestamptz,parent_id uuid);
create index idx_posts_created_at_desc on posts(created_at desc);create index posts_created_at_idx on posts(created_at desc);
create index idx_posts_parent_id on posts(parent_id);create index posts_parent_id_idx on posts(parent_id);
alter table posts enable row level security;
create policy own_read on posts for select to authenticated using (auth.uid()=user_id);
create policy own_write on posts for insert to authenticated with check (auth.uid()=user_id);
grant usage on schema public,auth to authenticated;grant select,insert on posts to authenticated;
insert into posts values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',now(),null);
insert into posts values ('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',now(),null);`);
await db.exec(await readFile('supabase/migrations/20261011230000_free_tier_performance.sql','utf8'));
assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname in ('idx_posts_parent_id','idx_posts_created_at_desc')")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname in ('posts_parent_id_idx','posts_created_at_idx')")).rows[0].n,2);
await db.exec("set role authenticated;select set_config('test.viewer','22222222-2222-4222-8222-222222222222',false)");
assert.equal((await db.query('select count(*)::int n from posts')).rows[0].n,1);
await db.exec("insert into posts values (gen_random_uuid(),'22222222-2222-4222-8222-222222222222',now(),null)");
await assert.rejects(db.exec("insert into posts values (gen_random_uuid(),'44444444-4444-4444-8444-444444444444',now(),null)"));
await db.exec("select set_config('test.viewer','',false)");
assert.equal((await db.query('select count(*)::int n from posts')).rows[0].n,0);
await db.close();console.log('Free-tier migration preserves owner-only reads/writes and retained indexes');
  },

  // lists-db-test.mjs
  "lists": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();const owner='11111111-1111-4111-8111-111111111111',viewer='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',privateId='44444444-4444-4444-8444-444444444444';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;create table profiles(id uuid primary key);insert into profiles values('${owner}'),('${viewer}');create table profile_private_settings(user_id uuid primary key references profiles(id),bot_prompt text);alter table profile_private_settings enable row level security;create policy settings_read on profile_private_settings for select using(user_id=auth.uid());grant usage on schema public,auth to anon,authenticated;grant select on profiles to anon,authenticated;grant select on profile_private_settings to authenticated;`);
await db.exec(await readFile('supabase/migrations/20261012020000_user_lists.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261018030000_list_member_limit_500.sql','utf8'));
const actor=async value=>db.exec(`reset role;set role authenticated;select set_config('test.viewer','${value}',false)`);
await actor(owner);await db.query("insert into user_lists(id,name,is_private) values($1,'公開',false),($2,'秘密',true)",[id,privateId]);
const member={id:viewer,username:'viewer',displayName:'Viewer'};
await db.query('select set_list_member($1,$2,true)',[id,member]);await db.query('select set_list_member($1,$2,true)',[id,member]);assert.equal((await db.query('select members from user_lists where id=$1',[id])).rows[0].members.length,1);
await assert.rejects(db.query('update user_lists set owner_id=$1 where id=$2',[viewer,id]));
await assert.rejects(db.query("update user_lists set cover_ref='https://example.test/cover.png' where id=$1",[id]));
await db.query('update user_lists set cover_ref=$1 where id=$2',[`cloudinary:lists/${owner}/${id}/55555555-5555-4555-8555-555555555555.png`,id]);
await assert.rejects(db.query('update user_lists set members=$1 where id=$2',[[member,member],id]));
await actor(viewer);assert.equal((await db.query('select * from user_lists')).rows.length,1);await assert.rejects(db.query('select set_list_member($1,$2,false)',[id,member]));await assert.rejects(db.query('select set_saved_list($1,true)',[privateId]));await assert.rejects(db.query("insert into user_lists(owner_id,name) values($1,'偽装')",[owner]));
await db.query('select set_saved_list($1,true)',[id]);await db.query('select set_saved_list($1,true)',[id]);assert.deepEqual((await db.query('select saved_lists from profile_private_settings')).rows[0].saved_lists,[id]);
assert.equal(Number((await db.query('select * from list_follower_counts($1)',[[id]])).rows[0].followers),1);assert.equal((await db.query('select * from list_follower_counts($1)',[[privateId]])).rows.length,0);
await db.query('select set_saved_list($1,false)',[id]);assert.equal((await db.query('select saved_lists from profile_private_settings')).rows[0].saved_lists.length,0);
await actor(owner);await db.query('select set_list_member($1,$2,false)',[id,member]);assert.equal((await db.query('select members from user_lists where id=$1',[id])).rows[0].members.length,0);
const externalMembers=Array.from({length:500},(_,i)=>({id:`x:list-${i}`,username:`member${i}@twitter.com`,displayName:`Member ${i}`}));
await db.query('update user_lists set members=$1 where id=$2',[externalMembers.slice(0,20),id]);
await db.query('select set_list_member($1,$2,true)',[id,externalMembers[20]]);
assert.equal((await db.query('select members from user_lists where id=$1',[id])).rows[0].members.length,21);
await db.query('update user_lists set members=$1 where id=$2',[externalMembers,id]);
await db.query('select set_list_member($1,$2,true)',[id,externalMembers[0]]);
await assert.rejects(db.query('select set_list_member($1,$2,true)',[id,{id:'x:overflow',username:'overflow@twitter.com'}]));
await db.query('select set_list_member($1,$2,false)',[id,externalMembers[0]]);
assert.equal((await db.query('select members from user_lists where id=$1',[id])).rows[0].members.length,499);
await db.query('update user_lists set is_private=true where id=$1',[id]);await actor(viewer);assert.equal((await db.query('select * from user_lists')).rows.length,0);
await db.exec('reset role;set role anon');assert.equal((await db.query('select * from user_lists')).rows.length,0);await assert.rejects(db.query('select set_saved_list($1,true)',[id]));await db.close();console.log('Lists DB checks passed: private RLS, owner-only changes, atomic/unique membership, Cloudinary ownership, private subscriptions and counts');
  },

  // maps-db-test.mjs
  "maps": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
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
  },

  // notifications-db-test.mjs
  "notifications": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',p='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444';
await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table profiles(id uuid primary key,username text,display_name text,avatar_url text,is_official boolean);
create table profile_private_settings(user_id uuid primary key references profiles(id),bot_prompt text);
create table posts(id uuid primary key,user_id uuid references profiles(id),content text,image_urls text[],visibility text);
create table comments(id uuid primary key,post_id uuid references posts(id),user_id uuid references profiles(id),parent_comment_id uuid references comments(id),content text,image_urls text[]);
create table likes(user_id uuid,post_id uuid);create table reposts(user_id uuid,post_id uuid);
create table post_reactions(user_id uuid,post_id uuid,emoji text);
create table comment_likes(user_id uuid,comment_id uuid);create table reply_reposts(user_id uuid,comment_id uuid);create table comment_reactions(user_id uuid,comment_id uuid,emoji text);
create table follows(follower_id uuid,followee_id uuid);create table mentions(id uuid default gen_random_uuid(),post_id uuid,mentioned_user_id uuid);
create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),actor_id uuid not null references profiles(id),post_id uuid references posts(id),type text not null,is_read boolean default false,created_at timestamptz default now(),actor_name text,actor_avatar_url text,content_preview text);
create table post_notification_subscriptions(id uuid primary key default gen_random_uuid(),subscriber_id uuid not null references profiles(id),target_user_id uuid not null references profiles(id),created_at timestamptz not null default now(),unique(subscriber_id,target_user_id),check(subscriber_id<>target_user_id));
insert into profiles values('${a}','alice','Alice',null,true),('${b}','bob','Bob',null,false);
insert into posts values('${p}','${a}','original',array['image.jpg'],'public');
insert into profile_private_settings values('${a}','preserve me');
`);
const tableCountBefore=(await db.query("select count(*) as count from information_schema.tables where table_schema='public'")).rows[0].count;
await db.exec(await readFile(new URL('../supabase/migrations/20261008210000_notification_preferences_and_activity.sql',import.meta.url),'utf8'));
await db.exec(`create trigger mention_notify after insert on mentions for each row execute function create_mention_notification();create trigger new_post_notify after insert on posts for each row execute function notify_post_subscribers();`);
const count=async(type)=>Number((await db.query('select count(*) as count from notifications where type=$1',[type])).rows[0].count);
await db.exec(`insert into comments values('${c}','${p}','${b}',null,'reply',array['reply.jpg']);insert into likes values('${b}','${p}');insert into reposts values('${b}','${p}');insert into post_reactions values('${b}','${p}','❤️');insert into follows values('${b}','${a}');insert into mentions(post_id,mentioned_user_id) values('${p}','${b}');`);
for(const type of ['reply','like','repost','reaction','follow','mention'])assert.equal(await count(type),1,type);
assert.deepEqual((await db.query("select image_urls from notifications where type='like'")).rows[0].image_urls,['image.jpg']);
await db.exec(`insert into likes values('${a}','${p}'),('${b}','${p}');`);assert.equal(await count('like'),1,'self and duplicate events suppressed');
await db.exec(`insert into comment_likes values('${a}','${c}');insert into reply_reposts values('${a}','${c}');insert into comment_reactions values('${a}','${c}','👍');`);
for(const type of ['like','repost','reaction'])assert.equal(await count(type),2,'reply activity '+type);
await db.query("select set_config('test.viewer',$1,false)",[a]);
await db.exec("set role authenticated; select set_notification_preference('like',false);reset role;");
assert.equal((await db.query('select bot_prompt from profile_private_settings where user_id=$1',[a])).rows[0].bot_prompt,'preserve me');
await db.exec(`delete from notifications where type='like' and user_id='${a}';insert into likes values('${b}','${p}');`);assert.equal(await count('like'),1,'disabled kind not created');
await db.exec(`insert into post_notification_subscriptions(subscriber_id,target_user_id) values('${b}','${a}');insert into posts values('55555555-5555-4555-8555-555555555555','${a}','new','{}','public');insert into posts values('66666666-6666-4666-8666-666666666666','${a}','private','{}','following');`);assert.equal(await count('new_post'),1,'private posts not pushed');
const subscription=(await db.query(`insert into post_notification_subscriptions(subscriber_id,provider,external_actor) values('${a}','bluesky','alice.bsky.social') returning id,created_at`)).rows[0];
const now=new Date().toISOString();const events=[{id:'bsky:at://did:plc:test/app.bsky.feed.post/new',created_at:now,name:'External',avatar:'',content:'new external',images:[]},{id:'bsky:old',created_at:'2020-01-01',content:'old',images:[]}];
await db.query('select record_external_post_notifications($1,$2,$3)',[subscription.id,JSON.stringify(events),JSON.stringify({seen:[events[0].id]})]);
assert.equal(await count('new_post'),2,'new external event only');
await db.query('select record_external_post_notifications($1,$2,$3)',[subscription.id,JSON.stringify(events),'{}']);assert.equal(await count('new_post'),2,'worker deduplication');
await db.exec('set role authenticated;');await assert.rejects(db.query('select record_external_post_notifications($1,$2,$3)',[subscription.id,'[]','{}']));await db.exec('reset role;');
await db.query("select set_config('test.viewer',$1,false)",[a]);await db.exec("set role authenticated;select set_notification_preference('new_post',false);reset role;");
await db.query('select record_external_post_notifications($1,$2,$3)',[subscription.id,JSON.stringify([{...events[0],id:'bsky:disabled'}]),'{}']);assert.equal(await count('new_post'),2,'external preference respected');
// Exercise retention with real RLS and read-only notification update privileges.
await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create schema net;
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
insert into notifications(user_id,actor_id,type,created_at) values('${a}','${b}','follow','2026-05-01');
alter table notifications enable row level security;create policy own_notifications on notifications for select to authenticated using(user_id=auth.uid());create policy own_notifications_update on notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());grant select on notifications to authenticated;
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261008213000_notification_delivery_and_expiry.sql',import.meta.url),'utf8'));
assert.equal(Number((await db.query("select count(*) as count from notifications where created_at='2026-05-01'")).rows[0].count),0,'old May notifications deleted');
await db.exec(`update notifications set expires_at=now()-interval '1 second' where user_id='${a}';set role authenticated;`);
assert.equal(Number((await db.query('select count(*) as count from notifications')).rows[0].count),0,'expired notifications excluded from badge count by RLS');
await assert.rejects(db.exec('select public.expire_notifications()'));await db.exec('reset role;');
await db.query("select set_config('test.viewer',$1,false)",[b]);await db.exec('set role authenticated;');
await db.exec("update notifications set is_read=true where is_read=false");
await assert.rejects(db.exec("update notifications set actor_name='tampered'"));await db.exec('reset role;');
await db.exec(await readFile(new URL('../supabase/migrations/20261008220000_external_notification_worker_permissions.sql',import.meta.url),'utf8'));
await db.exec('set role service_role;');
assert.equal((await db.query('select count(*) as count from post_notification_subscriptions')).rows[0].count,2,'server can read subscriptions');
await db.exec('update post_notification_subscriptions set last_checked_at=now()');
await assert.rejects(db.exec("update post_notification_subscriptions set external_actor='tampered'"));
await db.exec('reset role;');
await db.exec(await readFile(new URL('../supabase/migrations/20261008223000_notification_event_delivery.sql',import.meta.url),'utf8'));
await db.exec(`insert into notifications(user_id,actor_id,type) values('${b}','${a}','follow');`);
assert.equal(Number((await db.query('select count(*) as count from notifications where expires_at<=now()')).rows[0].count),0,'expired rows removed on notification insert without cron');
assert.equal((await db.query('select count(*) as count from information_schema.tables where table_schema=\'public\'')).rows[0].count,tableCountBefore,'no new app tables');
// Reproduce production: a restrictive UPDATE policy without any permissive UPDATE policy silently writes zero rows.
await db.exec(`drop policy own_notifications_update on notifications;
create policy security_owner_update on notifications as restrictive for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
insert into notifications(user_id,actor_id,type) values('${a}','${b}','follow'),('${b}','${a}','mention');`);
await db.query("select set_config('test.viewer',$1,false)",[b]);await db.exec('set role authenticated;');
assert.equal((await db.query(`update notifications set is_read=true where user_id='${b}' and not is_read returning id`)).rows.length,0,'reproduces the missing permissive owner update policy');
await db.exec('reset role;');
await db.exec(await readFile(new URL('../supabase/migrations/20261019063000_notification_owner_read_updates.sql',import.meta.url),'utf8'));
await db.exec('set role authenticated;');
assert((await db.query(`update notifications set is_read=true where user_id='${b}' and not is_read returning id`)).rows.length>0,'bulk owner read is persisted');
assert.equal(Number((await db.query('select count(*) as count from notifications where not is_read')).rows[0].count),0,'own unread count clears');
assert.equal((await db.query(`update notifications set is_read=true where user_id='${a}' returning id`)).rows.length,0,'other account stays protected');
await assert.rejects(db.exec("update notifications set actor_name='tampered'"));await db.exec('reset role;');
assert(Number((await db.query(`select count(*) as count from notifications where user_id='${a}' and not is_read`)).rows[0].count)>0,'other account unread flags remain intact');
await db.exec('set role anon;');await assert.rejects(db.exec('update notifications set is_read=true'));await db.exec('reset role;');
console.log('Notifications DB: all activity kinds, replies, self/duplicate suppression, private settings, external delivery/age/deduplication, disabled settings and worker permissions passed; no new tables');await db.close();
  },

  // polls-db-test.mjs
  "polls": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',voter='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',post='44444444-4444-4444-8444-444444444444',privatePost='55555555-5555-4555-8555-555555555555';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table public.profiles(id uuid primary key);insert into profiles values('${owner}'),('${voter}'),('${other}');
create table public.posts(id uuid primary key,user_id uuid references profiles(id),content text,visibility text);
alter table posts enable row level security;create policy posts_read on posts for select to anon,authenticated using(visibility='public' or user_id=auth.uid());
create policy posts_insert on posts for insert to authenticated with check(user_id=auth.uid());create policy posts_update on posts for update to authenticated using(user_id=auth.uid());
grant usage on schema public,auth to anon,authenticated;grant select on posts to anon;grant select,insert,update on posts to authenticated;grant select on profiles to authenticated;`);
await db.exec(await readFile('supabase/migrations/20261012010000_post_polls.sql','utf8'));
const viewer=async(id)=>db.exec(`reset role;set role authenticated;select set_config('test.viewer','${id}',false)`);
const draft=JSON.stringify({options:[{label:'回答1',votes:99},{label:'回答2'}],durationMinutes:1440,endsAt:'2099-01-01'});
await viewer(owner);await db.query("insert into posts(id,user_id,content,visibility,poll) values($1,$2,'質問','public',$3)",[post,owner,draft]);
await db.query("insert into posts(id,user_id,content,visibility,poll) values($1,$2,'秘密','private',$3)",[privatePost,owner,draft]);
let row=(await db.query('select poll from posts where id=$1',[post])).rows[0];assert.equal(row.poll.options[0].votes,0);assert.ok(Date.parse(row.poll.endsAt)<Date.parse('2099-01-01'));
await assert.rejects(db.query("update posts set poll=jsonb_set(poll,'{options,0,votes}','999') where id=$1",[post]));
await assert.rejects(db.query("insert into posts values(gen_random_uuid(),$1,'bad','public',$2)",[owner,JSON.stringify({options:[{},{label:'回答'}],durationMinutes:1})]));
await assert.rejects(db.query("insert into posts values(gen_random_uuid(),$1,'bad','public',$2)",[owner,JSON.stringify({options:[{label:'回答',image:'https://example.com/image.jpg'},{label:'回答2'}],durationMinutes:1})]));
await viewer(voter);await db.query('insert into poll_votes(post_id,user_id,option_index) values($1,$2,0)',[post,voter]);
await assert.rejects(db.query('insert into poll_votes(post_id,user_id,option_index) values($1,$2,1)',[post,voter]));
await assert.rejects(db.query('insert into poll_votes(post_id,user_id,option_index) values($1,$2,0)',[privatePost,voter]));
await assert.rejects(db.query('insert into poll_votes(post_id,user_id,option_index) values($1,$2,0)',[post,other]));
assert.equal((await db.query('select poll from posts where id=$1',[post])).rows[0].poll.options[0].votes,1);
await viewer(other);assert.equal((await db.query('select * from poll_votes')).rows.length,0);
await assert.rejects(db.query('insert into poll_votes(post_id,user_id,option_index) values($1,$2,3)',[post,other]));
await db.exec("reset role");await db.query('delete from profiles where id=$1',[voter]);assert.equal((await db.query('select poll from posts where id=$1',[post])).rows[0].poll.options[0].votes,0);await db.exec('alter table posts disable trigger validate_post_poll');await db.query("update posts set poll=jsonb_set(poll,'{endsAt}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",[post]);await db.exec('alter table posts enable trigger validate_post_poll');
await viewer(other);await assert.rejects(db.query('insert into poll_votes(post_id,user_id,option_index) values($1,$2,1)',[post,other]));
await db.close();console.log('Poll database checks passed: server deadlines/counts, immutable definitions, uniqueness, private post ACL, anonymous voter privacy, invalid/expired votes');
  },

  // profile-data-consolidation-db-test.mjs
  "profile-data-consolidation": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
const aPost='33333333-3333-4333-8333-333333333333',bPost='44444444-4444-4444-8444-444444444444';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema limenote_security;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.viewer',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
create table profiles(id uuid primary key,username text,bot_prompt text,pinned_post_id uuid);
create table posts(id uuid primary key,user_id uuid references profiles(id));
alter table profiles enable row level security;create policy profile_read on profiles for select using(true);create policy profile_write on profiles for all to authenticated using(true) with check(true);
grant usage on schema public,auth to anon,authenticated;
grant select on profiles,posts to anon,authenticated;grant insert,update on profiles to authenticated;
insert into profiles(id,username,bot_prompt) values('${alice}','alice','private prompt'),('${bob}','bob',null);
insert into posts values('${aPost}','${alice}'),('${bPost}','${bob}');`);
for(const file of ['20261004114000_profile_pins.sql','20261008122000_private_bot_settings.sql','20261008170000_account_about.sql','20261008180000_external_account_users.sql'])
 await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.exec(`insert into profile_pins values('${alice}','${aPost}');update profiles set pinned_post_id='${bPost}' where id='${bob}';
update account_about set country_code='JP',connection_source='LimeNote for Web',connection_updated_at='2026-10-08',username_change_count=2,last_username_change_at='2026-09-01',tracking_since='2026-08-01' where user_id='${alice}';
insert into external_account_imports values('${alice}','2026-10-08');
insert into external_account_users(user_id,provider,handle) values('${alice}','bluesky','alice.bsky.social');`);
await db.exec(await readFile(new URL('../supabase/migrations/20261008190000_consolidate_profile_data.sql',import.meta.url),'utf8'));
const aliceRow=(await db.query(`select * from profiles where id='${alice}'`)).rows[0];
assert.equal(aliceRow.pinned_post_id,aPost);assert.equal(aliceRow.country_code,'JP');assert.equal(aliceRow.username_change_count,2);
assert.equal((await db.query(`select pinned_post_id from profiles where id='${bob}'`)).rows[0].pinned_post_id,bPost);
assert.equal((await db.query(`select bot_prompt from profile_private_settings where user_id='${alice}'`)).rows[0].bot_prompt,'private prompt');
for(const name of ['profile_pins','account_about','external_account_imports'])assert.equal((await db.query(`select to_regclass('public.${name}') as relation`)).rows[0].relation,null);
async function asUser(role,id,sql){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const rows=(await db.query(sql)).rows;await db.exec('commit');return rows;}catch(e){await db.exec('rollback');throw e;}}
await asUser('authenticated',alice,`update profiles set pinned_post_id=null where id='${alice}'`);
await assert.rejects(asUser('authenticated',alice,`update profiles set pinned_post_id='${bPost}' where id='${alice}'`));
await assert.rejects(asUser('authenticated',bob,`update profiles set pinned_post_id='${aPost}' where id='${alice}'`));
await asUser('authenticated',alice,`update profiles set pinned_post_id='${aPost}' where id='${alice}'`);
await assert.rejects(asUser('authenticated',alice,`update profiles set username_change_count=99 where id='${alice}'`));
await assert.rejects(asUser('authenticated',alice,`update profiles set country_code='US' where id='${alice}'`));
await asUser('authenticated',alice,`update profiles set username='renamed' where id='${alice}'`);
assert.equal((await db.query(`select username_change_count from profiles where id='${alice}'`)).rows[0].username_change_count,3);
await asUser('authenticated',alice,`select update_account_connection('${alice}','US','LimeNote for iPhone')`);
await assert.rejects(asUser('authenticated',bob,`select update_account_connection('${alice}','JP','LimeNote for Web')`));
await assert.rejects(asUser('anon',null,`select update_account_connection('${alice}','JP','LimeNote for Web')`));
assert.equal((await db.query(`select country_code from profiles where id='${alice}'`)).rows[0].country_code,'US');
await asUser('authenticated',alice,`delete from external_account_users where user_id='${alice}'`);
await asUser('authenticated',alice,`select import_external_account_users('[{"provider":"bluesky","handle":"alice.bsky.social"}]')`);
assert.equal((await asUser('authenticated',alice,'select * from external_account_users')).length,0);
await asUser('authenticated',bob,`select import_external_account_users('[{"provider":"misskey","handle":"bob@misskey.io"}]')`);
assert.equal((await asUser('authenticated',bob,'select * from external_account_users')).length,1);
assert.equal((await asUser('authenticated',bob,`select * from profile_private_settings where user_id='${alice}'`)).length,0);
await db.exec(`delete from posts where id='${aPost}'`);
assert.equal((await db.query(`select pinned_post_id from profiles where id='${alice}'`)).rows[0].pinned_post_id,null);
await asUser('authenticated',alice,`insert into profiles(id,username,country_code,username_change_count) values('55555555-5555-4555-8555-555555555555','bad','JP',99)`).then(()=>assert.fail('foreign insert allowed'),()=>{});
console.log('Profile consolidation: copied all data, removed 3 redundant tables, validated own pins, metadata guards, username counts, country RPC, private imports and post deletion');
await db.close();
  },

  // profile-highlights-db-test.mjs
  "profile-highlights": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');

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
  },

  // protected-accounts-db-test.mjs
  "protected-accounts": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',follower='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated;
create table profiles(id uuid primary key,username text,display_name text,avatar_url text,is_official boolean);
create table follows(follower_id uuid,followee_id uuid,created_at timestamptz default now(),primary key(follower_id,followee_id));
create table posts(id uuid primary key default gen_random_uuid(),user_id uuid,visibility text default 'public',content text);
create table memberships(creator_id uuid,member_id uuid);
create table notifications(id uuid default gen_random_uuid(),actor_id uuid,user_id uuid);
create function notify_account_activity() returns trigger language plpgsql as $$begin return new;end$$;
create trigger notify_account_activity after insert on follows for each row execute function notify_account_activity();
create function get_profile_activity_count(uuid) returns bigint language sql as $$select count(*) from public.posts where user_id=$1$$;
insert into profiles values('${owner}','owner','Owner',null,true),('${follower}','follower','Follower',null,false),('${outsider}','outsider','Outsider',null,false);
insert into follows(follower_id,followee_id) values('${follower}','${owner}');
insert into posts(user_id,content) values('${owner}','secret'),('${outsider}','public');`);
const activity=['comments','likes','post_reactions','reposts','reply_reposts','external_reposts','comment_likes','comment_reactions','profile_pins','profile_highlights'];
for(const t of ['posts','follows','notifications',...activity]){
 if(activity.includes(t))await db.exec(`create table ${t}(user_id uuid,post_id uuid);insert into ${t}(user_id,post_id) select '${owner}',id from posts where user_id='${owner}';`);
 await db.exec(`alter table ${t} enable row level security;grant select,insert,update,delete on ${t} to anon,authenticated;create policy legacy on ${t} for all to anon,authenticated using(true) with check(true);`);
}
await db.exec('grant select,update on profiles to anon,authenticated');
await db.exec(await readFile('supabase/migrations/20261003130000_enforce_post_audience.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261008230000_account_reviews.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261010020000_protected_accounts.sql','utf8'));
async function as(role,id,sql){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const {rows}=await db.query(sql);await db.exec('commit');return rows;}catch(e){await db.exec('rollback');throw e;}}
const query=`select * from posts where user_id='${owner}'`;
assert.equal((await as('anon',null,query)).length,1);
await db.exec(`update profiles set is_private=true where id='${owner}'`);
assert.equal((await as('anon',null,query)).length,0);
assert.equal((await as('authenticated',outsider,query)).length,0);
await assert.rejects(as('authenticated',outsider,`update profiles set is_private=false where id='${owner}'`));
assert.equal((await as('authenticated',follower,query)).length,1);
assert.equal((await as('authenticated',owner,query)).length,1);
await db.exec(`update profiles set is_private=true where id='${follower}'`);
assert.equal((await as('authenticated',owner,`select * from follows where followee_id='${owner}'`)).length,1);
await db.exec(`update profiles set is_private=false where id='${follower}'`);
for(const t of activity)assert.equal((await as('authenticated',outsider,`select * from ${t}`)).length,0,t);
assert.equal((await as('authenticated',outsider,`select * from follows`)).length,0);
assert.equal((await as('anon',null,`select get_profile_activity_count('${owner}') as n`))[0].n,null);
assert.equal((await as('authenticated',follower,`select get_profile_activity_count('${owner}') as n`))[0].n,1);
await assert.rejects(as('authenticated',outsider,`insert into follows(follower_id,followee_id) values('${outsider}','${owner}')`));
let state=(await as('authenticated',outsider,`select toggle_account_follow('${owner}') as state`))[0].state;
assert.equal(state.requested,true);assert.equal(state.followed,false);assert.equal(state.canView,false);
assert.equal((await as('authenticated',outsider,query)).length,0);
assert.equal((await as('authenticated',owner,'select get_account_follow_requests() as requests'))[0].requests.length,1);
assert.equal((await as('authenticated',follower,'select get_account_follow_requests() as requests'))[0].requests.length,0);
await as('authenticated',outsider,`update follows set approved=true where follower_id='${outsider}'`);
assert.equal((await as('authenticated',outsider,query)).length,0);
await assert.rejects(as('authenticated',outsider,`insert into follows(follower_id,followee_id,approved) values('${outsider}','${follower}',false)`));
await as('authenticated',follower,`select respond_account_follow_request('${outsider}',true)`);
assert.equal((await as('authenticated',outsider,query)).length,0);
await as('authenticated',owner,`select respond_account_follow_request('${outsider}',true)`);
assert.equal((await as('authenticated',outsider,query)).length,1);
assert.equal((await as('authenticated',owner,'select get_account_follow_requests() as requests'))[0].requests.length,0);
await as('authenticated',outsider,`select toggle_account_follow('${owner}')`);
assert.equal((await as('authenticated',outsider,query)).length,0);
await as('authenticated',outsider,`select toggle_account_follow('${owner}')`);
await as('authenticated',owner,`select respond_account_follow_request('${outsider}',false)`);
assert.equal((await as('authenticated',outsider,`select get_account_follow_state('${owner}') as state`))[0].state.requested,false);
await as('authenticated',outsider,`select toggle_account_follow('${owner}')`);
await as('authenticated',outsider,`select toggle_account_follow('${owner}')`);
assert.equal((await as('authenticated',owner,'select get_account_follow_requests() as requests'))[0].requests.length,0);
await db.exec(`update profiles set review=true where id='${owner}'`);
await as('authenticated',owner,`select submit_account_review('${owner}',5,'公開レビュー','レビューのみ公開')`);
const reviewData=(await as('anon',null,`select get_account_reviews('${owner}',0) as data`))[0].data;
assert.equal(reviewData.reviews[0].content,'レビューのみ公開');
assert.equal(reviewData.reviews[0].author.is_private,true);
assert.equal(reviewData.reviews[0].author.is_official,true);
assert.equal((await as('anon',null,`select news_sources_are_public('limenote',array[(select id::text from posts where user_id='${outsider}')]) as visible`))[0].visible,true);
const ownerPost=(await db.query(`select id from posts where user_id='${owner}'`)).rows[0].id;
assert.equal((await as('anon',null,`select news_sources_are_public('limenote',array['${ownerPost}']) as visible`))[0].visible,false);
await as('authenticated',outsider,`select toggle_account_follow('${owner}')`);
await db.exec(`update profiles set is_private=false where id='${owner}'`);
assert.equal((await as('authenticated',outsider,`select get_account_follow_state('${owner}') as state`))[0].state.followed,true);
assert.equal((await as('anon',null,query)).length,1);
assert.equal((await as('authenticated',outsider,`select toggle_account_follow('${owner}') as state`))[0].state.followed,false);
console.log('Protected account DB checks passed: old followers, requests, approval, rejection, cancellation, spoof prevention, private activity, counts, public restoration.');
await db.close();
  },

  // scheduled-posts-db-test.mjs
  "scheduled-posts": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema cron;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
create table profiles(id uuid primary key,username text,"Account_suspension" boolean default false);
insert into profiles(id,username) values('${a}','a'),('${b}','b');
create function public.is_account_suspended(uuid) returns boolean language sql stable security definer as $$select coalesce((select "Account_suspension" from public.profiles where id=$1),false)$$;
create table profile_private_settings(user_id uuid primary key references profiles(id),bot_prompt text);
alter table profile_private_settings enable row level security;create policy own on profile_private_settings for select to authenticated using(user_id=auth.uid());grant select on profile_private_settings to authenticated;
create table posts(id uuid primary key,user_id uuid,content text,image_urls text[],visibility text,client_name text,parent_id uuid,quoted_reply_id uuid,quoted_external_post jsonb,is_quote boolean,is_bot boolean,poll jsonb,map_latitude double precision,map_longitude double precision,created_at timestamptz default now());
create table mentions(post_id uuid,mentioned_user_id uuid,primary key(post_id,mentioned_user_id));
grant usage on schema public,auth to authenticated,anon,service_role;grant select on posts to authenticated,anon;
create function guard_frozen() returns trigger language plpgsql security definer as $$begin if public.is_account_suspended(auth.uid()) then raise exception 'ACCOUNT_SUSPENDED';end if;return null;end$$;
create trigger frozen before insert or update or delete on profile_private_settings for each statement execute function guard_frozen();`);
await db.exec(await readFile('supabase/migrations/20261013100000_scheduled_posts.sql','utf8'));
const pollMigration=await readFile('supabase/migrations/20261012010000_post_polls.sql','utf8');await db.exec(pollMigration.slice(pollMigration.indexOf('create function public.validate_post_poll()'),pollMigration.indexOf('create function public.validate_poll_vote()')));
const body={content:'予約本文 @b',image_urls:[`storage://post-media/${a}/${id}/image.png`],visibility:'public',poll:{options:[{label:'猫'},{label:'犬'}],durationMinutes:60}};
async function as(actor,sql,args=[]){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[actor]);await db.exec('set local role authenticated');const r=await db.query(sql,args);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}}
await as(a,'select save_scheduled_post($1,now()+interval \'1 hour\',$2)',[id,body]);
assert.equal((await db.query('select count(*)::int n from posts')).rows[0].n,0);
assert.equal((await as(a,'select get_scheduled_posts() q'))[0].q.length,1);assert.equal((await as(b,'select get_scheduled_posts() q'))[0].q.length,0);
await assert.rejects(as(b,'select save_scheduled_post($1,now()+interval \'2 hours\')',[id]),/見つかりません/);
await assert.rejects(as(a,'select save_scheduled_post($1,null,$2)',[id,body]),/予約日時/);
await assert.rejects(as(a,'select publish_scheduled_posts()'),/permission denied/);
await as(b,'select cancel_scheduled_post($1)',[id]);assert.equal((await as(a,'select get_scheduled_posts() q'))[0].q.length,1);
await db.exec(`update profile_private_settings set scheduled_posts=jsonb_set(scheduled_posts,'{${id},scheduledAt}',to_jsonb((now()-interval '1 minute')::text))`);
assert.equal((await db.query('select publish_scheduled_posts() n')).rows[0].n,1);
assert.equal((await db.query('select publish_scheduled_posts() n')).rows[0].n,0);
assert.equal((await db.query('select content from posts')).rows[0].content,body.content);assert.equal((await db.query('select count(*)::int n from mentions')).rows[0].n,1);const publishedPoll=(await db.query('select poll from posts')).rows[0].poll;assert.equal(publishedPoll.options[0].votes,0);assert(Date.parse(publishedPoll.endsAt)>Date.now()+59*60_000);
assert.equal((await as(a,'select get_scheduled_posts() q'))[0].q.length,0);
const second='44444444-4444-4444-8444-444444444444';await as(a,'select save_scheduled_post($1,now()+interval \'1 hour\',$2)',[second,{...body,image_urls:[]}]);
await db.exec(`update profiles set "Account_suspension"=true where id='${a}';update profile_private_settings set scheduled_posts=jsonb_set(scheduled_posts,'{${second},scheduledAt}',to_jsonb((now()-interval '1 minute')::text));`);
assert.equal((await db.query('select publish_scheduled_posts() n')).rows[0].n,0);assert.equal((await as(a,'select get_scheduled_posts() q'))[0].q[0].status,'failed');
await assert.rejects(as(a,'select save_scheduled_post($1,now()+interval \'1 hour\')',[second]),/ACCOUNT_SUSPENDED/);
await db.exec(`update profiles set "Account_suspension"=false where id='${a}'`);
await as(a,'select save_scheduled_post($1,now()+interval \'2 hours\')',[second]);assert.equal((await as(a,'select get_scheduled_posts() q'))[0].q[0].status,'pending');await as(a,'select cancel_scheduled_post($1)',[second]);assert.equal((await as(a,'select get_scheduled_posts() q'))[0].q.length,0);
console.log('PASS: private reservation, ownership, date validation, one-time publication, mentions, frozen failure, reschedule and cancellation');await db.close();
  },

  // security-db-test.mjs
  "security": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
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
for(const migration of ['20261003130000_enforce_post_audience.sql','20261008120000_security_hardening.sql','20261008121000_private_post_media.sql','20261020020000_post_media_dimensions.sql','20261008122000_private_bot_settings.sql']) {
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
// Both new dimensioned names and legacy names retain owner-only writes.
const dimensionPath=path.replace('.png','--1200x800.png');
await asActor('authenticated',author,async()=>{
 await db.exec(`insert into storage.objects(bucket_id,name,owner_id) values('post-media','${dimensionPath}','${author}'); update public.posts set image_urls=array['storage://post-media/${dimensionPath}'] where id='${post}'`);
});checks++;
await assert.rejects(asActor('authenticated',attacker,()=>db.exec(`insert into storage.objects(bucket_id,name,owner_id) values('post-media','${dimensionPath}','${attacker}')`)));checks++;
await assert.rejects(asActor('authenticated',author,()=>db.exec(`update public.posts set image_urls=array['storage://post-media/${dimensionPath.replace('--1200x800','--0x800')}'] where id='${post}'`)));checks++;
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
  },

  // security-legacy-db-test.mjs
  "security-legacy": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',post='44444444-4444-4444-8444-444444444444',tag='55555555-5555-4555-8555-555555555555';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema limenote_security;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated;revoke create on schema public from public,anon,authenticated;
create table profiles(id uuid primary key,is_official boolean default false);
create table follows(follower_id uuid,followee_id uuid,approved boolean);
create table posts(id uuid primary key,user_id uuid,visibility text,content text);
alter table posts enable row level security;create policy posts_read on posts for select using(visibility='public' or user_id=auth.uid());
create table comments(id uuid,post_id uuid,user_id uuid,content text,created_at timestamptz,likes_count integer);
alter table comments enable row level security;create policy comments_read on comments for select using(exists(select 1 from posts where id=post_id));
create table hashtags(id uuid primary key default gen_random_uuid(),tag text unique,created_at timestamptz default now());
create table post_hashtags(post_id uuid,hashtag_id uuid,created_at timestamptz default now());
create policy tags_all on hashtags for all using(true) with check(true);create policy links_all on post_hashtags for all using(true) with check(true);
create table lime_drops(id uuid default gen_random_uuid(),sender_id uuid,recipient_id uuid,status text default 'pending');
alter table lime_drops enable row level security;
create policy drops_read on lime_drops for select using(sender_id=auth.uid() or recipient_id=auth.uid());
create policy drops_add on lime_drops for insert with check(sender_id=auth.uid() and public.can_limedrop(sender_id,recipient_id));` .replace(' and public.can_limedrop(sender_id,recipient_id)',''));
await db.exec(`create policy drops_edit on lime_drops for update using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
create function public.can_limedrop(uuid,uuid) returns boolean language sql security definer as $$select true$$;
create function public.delete_old_news() returns void language sql as $$select$$;
create function public.get_profile_reply_comments(uuid,integer) returns setof comments language sql security definer as $$select * from comments$$;
create table storage.buckets(id text,file_size_limit bigint,allowed_mime_types text[]);
insert into storage.buckets(id) values('avatars'),('covers'),('posts');
grant all on all tables in schema public to anon,authenticated;
grant update(sender_id) on lime_drops to authenticated;
create view public.timeline_posts as select * from posts;grant select on timeline_posts to anon,authenticated;
insert into profiles(id) values('${a}'),('${b}'),('${c}');insert into follows values('${a}','${b}',false),('${b}','${a}',true);
insert into posts values('${post}','${a}','following','private');insert into hashtags(id,tag) values('${tag}','existing');insert into post_hashtags values('${post}','${tag}',now());`);
async function as(id,sql,role='authenticated'){
 await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const result=await db.query(sql);await db.exec('commit');return result.rows;}catch(error){await db.exec('rollback');throw error;}
}
assert.equal((await as(null,'select * from timeline_posts','anon')).length,1);
await db.exec(await readFile('supabase/migrations/20261012040000_legacy_database_security.sql','utf8'));
assert.equal((await as(null,'select * from timeline_posts','anon')).length,0);
assert.equal((await as(a,'select * from timeline_posts')).length,1);
assert.equal((await as(b,'select * from post_hashtags')).length,0);
assert.equal((await as(a,'select * from post_hashtags')).length,1);
await assert.rejects(as(null,"insert into hashtags(tag) values('anonymous')",'anon'));
await assert.rejects(as(b,`insert into post_hashtags(post_id,hashtag_id) values('${post}','${tag}')`));
await as(a,"insert into hashtags(tag) values('existing') on conflict(tag) do update set tag=excluded.tag returning id");
await assert.rejects(as(b,`update hashtags set tag='hijacked' where id='${tag}'`));
assert.equal((await as(a,`select can_limedrop('${a}','${b}') ok`))[0].ok,false);
await db.exec('update follows set approved=true');assert.equal((await as(a,`select can_limedrop('${a}','${b}') ok`))[0].ok,true);
assert.equal((await as(c,`select can_limedrop('${a}','${b}') ok`))[0].ok,false);
await assert.rejects(as(a,`insert into lime_drops(sender_id,recipient_id,status) values('${a}','${b}','accepted')`));
const drop=(await as(a,`insert into lime_drops(sender_id,recipient_id) values('${a}','${b}') returning id`))[0].id;
await assert.rejects(as(b,`update lime_drops set sender_id='${c}' where id='${drop}'`));
await as(b,`update lime_drops set status='accepted' where id='${drop}'`);
assert.equal((await as(b,`update lime_drops set status='declined' where id='${drop}' returning id`)).length,0);
await assert.rejects(as(null,'select delete_old_news()','anon'));
assert.equal((await as(b,`select * from get_profile_reply_comments('${a}',80)`)).length,0);
console.log('PASS: legacy view RLS, tag isolation/ownership, no-op upsert compatibility, gift approval/immutability, RPC grants and private reply isolation');
await db.close();
  },

  // topics-db-test.mjs
  "topics": async () => {
const { PGlite } = await import('@electric-sql/pglite');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
const db=new PGlite(),alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
create table profiles(id uuid primary key);
create table profile_private_settings(user_id uuid primary key references profiles(id),bot_prompt text,notification_preferences jsonb default '{}'::jsonb);
alter table profile_private_settings enable row level security;
grant usage on schema public,auth to anon,authenticated;
grant select on profile_private_settings to authenticated;
create policy private_settings_owner on profile_private_settings for select to authenticated using(user_id=auth.uid());
insert into profiles values('${alice}'),('${bob}');
insert into profile_private_settings(user_id,bot_prompt,notification_preferences) values('${alice}','private', '{"like":false}');`);
await db.exec(await readFile('supabase/migrations/20261008233000_topic_preferences.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261009001000_digital_illustration_topic.sql','utf8'));
async function actor(role,id,sql){await db.exec('begin');try{await db.query("select set_config('test.viewer',$1,true)",[id??'']);await db.exec(`set local role ${role}`);const result=await db.query(sql);await db.exec('commit');return result.rows;}catch(e){await db.exec('rollback');throw e;}}
const write=(ids,status)=>`select update_topic_preferences(array[${ids.map(id=>id===null?'null':`'${id}'`).join(',')}]::text[],'${status}')`;
await assert.rejects(actor('anon',null,write(['pets'],'follow')));
await assert.rejects(actor('authenticated',null,write(['pets'],'follow')));
await assert.rejects(actor('authenticated',alice,write(['unknown'],'follow')));
await assert.rejects(actor('authenticated',alice,write(['pets'],'bad')));
await assert.rejects(actor('authenticated',alice,write([],'follow')));
await assert.rejects(actor('authenticated',alice,write([null],'follow')));
await actor('authenticated',alice,write(['pets','pets','music'],'follow'));
await actor('authenticated',alice,write(['games'],'follow'));
await actor('authenticated',alice,write(['pets'],'dismiss'));
let [row]=await actor('authenticated',alice,'select * from profile_private_settings');
assert.deepEqual(row.followed_topics,['games','music']);assert.deepEqual(row.dismissed_topics,['pets']);
assert.equal(row.bot_prompt,'private');assert.deepEqual(row.notification_preferences,{like:false});
await actor('authenticated',alice,write(['pets'],'follow'));
await actor('authenticated',alice,write(['music'],'clear'));
[row]=await actor('authenticated',alice,'select * from profile_private_settings');
assert.deepEqual(row.followed_topics,['games','pets']);assert.deepEqual(row.dismissed_topics,[]);
assert.deepEqual(await actor('authenticated',bob,'select * from profile_private_settings'),[]);
await actor('authenticated',bob,write(['travel'],'follow'));
assert.deepEqual((await actor('authenticated',bob,'select * from profile_private_settings'))[0].followed_topics,['travel']);
await assert.rejects(actor('authenticated',alice,`update profile_private_settings set followed_topics='{}' where user_id='${bob}'`));
assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n,2);

await actor('authenticated',alice,write(['digital-illustration'],'follow'));
assert.ok((await actor('authenticated',alice,'select followed_topics from profile_private_settings'))[0].followed_topics.includes('digital-illustration'));

await db.close();
console.log('Topics DB checks passed: no new tables, owner privacy, authenticated writes, validation, duplicates, follow/dismiss/clear, other settings preserved.');
  },
};

const command = process.argv[2];
if (command === '--list' || !Object.hasOwn(suites, command)) {
  console.log('Usage: node scripts/verify-database.mjs <command> [arguments]\n\n' + Object.keys(suites).join('\n'));
  if (command !== '--list') process.exitCode = 2;
} else {
  // Preserve the original positional arguments consumed by individual checks.
  process.argv.splice(2, 1);
  await suites[command]();
}
