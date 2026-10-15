// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('allows public X snapshots and follows while retaining snapshot and owner validation',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create function auth.uid() returns uuid language sql as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
 create table follows(follower_id uuid,followee_id uuid,external_provider text,external_handle text,external_profile jsonb,follow_key text generated always as(coalesce(followee_id::text,external_provider||':'||external_handle)) stored,unique(follower_id,follow_key),constraint follows_target_check check(true));
 create table bookmarks(external_id text,external_snapshot jsonb,constraint bookmark_public_external check(true));
 create table external_reposts(post_id text,constraint external_reposts_post_id_check check(true));
 create table likes(post_id uuid,external_post_id text,post_snapshot jsonb,external_mirrored boolean default false,constraint likes_target_valid check(true));`);
 await db.exec(readFileSync(new URL('../../supabase/migrations/20261016043000_x_external_posts.sql',import.meta.url),'utf8'));
 const snapshot=JSON.stringify({id:'x:20',visibility:'public',author:{id:'x-user:12'}});
 await db.query('insert into bookmarks values($1,$2)', ['x:20',snapshot]);await db.query('insert into likes(external_post_id,post_snapshot)values($1,$2)',['x:20',snapshot]);
 await expect(db.query('insert into bookmarks values($1,$2)',['x:21',snapshot])).rejects.toThrow();
 await expect(db.query('insert into likes(external_post_id,post_snapshot)values($1,$2)',['x:20',JSON.stringify({id:'x:20',visibility:'members',author:{}})])).rejects.toThrow();
 await db.query("select set_external_follow('x','example',true,'{}')");const rows=await db.query('select follower_id,external_provider from follows');expect(rows.rows).toEqual([{follower_id:'11111111-1111-1111-1111-111111111111',external_provider:'x'}]);
 await expect(db.query("select set_external_follow('x','bad/handle',true,'{}')")).rejects.toThrow();await db.query("select set_external_follow('x','example',false)");expect((await db.query('select * from follows')).rows).toHaveLength(0);
 }finally{await db.close();}
},20000);
