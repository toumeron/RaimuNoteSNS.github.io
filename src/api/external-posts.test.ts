import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ existing: false, error: false, writes: [] as { table: string; action: string; payload?: any }[] }));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/lib/bluesky', () => ({ fetchBlueskyPost: async (id: string) => ({id, content:'External original', imageUrls:['https://example.com/image.png'],visibility:'public',source:'bluesky',author:{id:'did:plc:author',username:'author.bsky.social',displayName:'Author'},createdAt:'2026-10-03T00:00:00Z'}) }));
vi.mock('@/lib/supabase', () => ({ supabase: { from(table: string) {
  let action='select', counting=false, payload: any;
  const builder = {
    select: (_: string, options?: {count?: string}) => {counting=!!options?.count;return builder;},
    eq:()=>builder,maybeSingle:()=>builder,order:()=>builder,range:()=>builder,
    insert:(input: any)=>{action='insert';payload=input;return builder;},delete:()=>{action='delete';return builder;},
    then:(resolve: any)=>{
      if(action!=='select') db.writes.push({table,action,payload});
      return Promise.resolve({data: !counting && action==='select' && db.existing ? {post_id:'external'} : null,
        count:counting ? (table==='external_reposts'?2:1) : null,error:db.error?new Error('denied'):null}).then(resolve);
    },
  };return builder;
} } }));
import { getExternalPost, toggleExternalRepost } from './external-posts';
const id='bsky:at://did:plc:author/app.bsky.feed.post/original';
beforeEach(()=>{db.existing=false;db.error=false;db.writes=[];});
it('stores a public external snapshot in profile shares, without inserting a timeline post',async()=>{
  expect(await toggleExternalRepost(id)).toEqual({reposted:true,repostsCount:3});
  expect(db.writes).toHaveLength(1);
  expect(db.writes[0]).toMatchObject({table:'external_reposts',action:'insert',payload:{post_id:id,user_id:'viewer',post_snapshot:{id,visibility:'public',imageUrls:['https://example.com/image.png']}}});
});
it('undoes an external share and keeps source identifiers intact',async()=>{
  db.existing=true;
  expect((await toggleExternalRepost(id)).reposted).toBe(false);
  expect(db.writes[0]).toMatchObject({table:'external_reposts',action:'delete'});
});
it('loads external originals for quotes with independent Lime share counts',async()=>{
  expect(await getExternalPost(id)).toMatchObject({id,repostsCount:3,repostedByMe:false,author:{coverUrl:'',bio:''}});
});
it('does not persist a repost when the viewer lookup fails',async()=>{
  db.error=true;
  await expect(toggleExternalRepost(id)).rejects.toThrow('denied');
  expect(db.writes).toHaveLength(0);
});
