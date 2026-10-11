import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ viewer: 'viewer', rows: [] as any[], error: null as any, writes: [] as any[], lookup: vi.fn() }));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => state.viewer }));
vi.mock('./posts', () => ({ getPostById: state.lookup }));
vi.mock('./external-posts', () => ({ isExternalPostId: (id: string) => id.startsWith('bsky:at://') }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  let action = 'select', payload: unknown, start = 0, end = Infinity;
  const filters: unknown[] = [];
  const query = { select: () => query, order: () => query, eq: (key: string, value: string) => { filters.push([key, value]); return query; }, range: (a: number, b: number) => { start = a; end = b; return query; }, insert: (value: unknown) => { action = 'insert'; payload = value; return query; }, delete: () => { action = 'delete'; return query; }, then: (resolve: any) => { if (action !== 'select') state.writes.push({action,payload,filters}); return Promise.resolve({data: action === 'select' ? state.rows.slice(start,end+1) : null,error:state.error}).then(resolve); } };
  return query;
} } }));
import { getBookmarkIds, getBookmarkPage, setBookmark } from './bookmarks';
beforeEach(() => { state.viewer = 'viewer'; state.rows = []; state.error = null; state.writes = []; state.lookup.mockReset().mockImplementation(async (id: string) => ({id,content:'current content'})); });
it('saves native posts and replies by reference without retaining restricted content', async () => {
  await setBookmark({id:'native',content:'restricted content',visibility:'following'},true,'viewer');
  await setBookmark({id:'reply:child',content:'reply content'},true,'viewer');
  expect(state.writes.map(row=>row.payload)).toEqual([{user_id:'viewer',post_id:'native'},{user_id:'viewer',comment_id:'child'}]);
});
it('stores only public external snapshots and removes profile repost attribution', async () => {
  const post:any={id:'bsky:at://did/example',visibility:'public',content:'external',author:{id:'author'},profileRepostedBy:'other',parentPost:{id:'private'}};
  await setBookmark(post,true,'viewer');
  expect(state.writes[0].payload.external_snapshot).toMatchObject({id:post.id,parentPost:null});
  expect(state.writes[0].payload.external_snapshot.profileRepostedBy).toBeUndefined();
  await expect(setBookmark({...post,visibility:'following'},true,'viewer')).rejects.toThrow('読み込んで');
  expect(state.writes).toHaveLength(1);
});
it('deletes only the requested source belonging to the active viewer',async()=>{
  await setBookmark({id:'reply:child'},false,'viewer');
  expect(state.writes[0]).toMatchObject({action:'delete',filters:[['user_id','viewer'],['comment_id','child']]});
});
it('does not write after an account changes and tolerates an already-saved duplicate',async()=>{
  state.viewer='other';await expect(setBookmark({id:'native'},true,'viewer')).rejects.toThrow('切り替わりました');expect(state.writes).toHaveLength(0);
  state.viewer='viewer';state.error={code:'23505'};await expect(setBookmark({id:'native'},true,'viewer')).resolves.toBeUndefined();
  state.error=new Error('write denied');await expect(setBookmark({id:'native'},true,'viewer')).rejects.toThrow('write denied');
});
it('loads saved native originals with current permissions and does not show revoked or deleted posts',async()=>{
  const external:any={id:'bsky:at://did/public',visibility:'public',content:'external'};
  state.rows=[{post_id:'restricted'},{comment_id:'child'},{external_id:external.id,external_snapshot:external}];
  state.lookup.mockImplementation(async(id:string)=>id==='restricted'?null:{id,replyId:'child'});
  const page=await getBookmarkPage('viewer');
  expect(state.lookup.mock.calls.map(row=>row[0])).toEqual(['restricted','reply:child']);
  expect(page.posts.map(post=>post.id)).toEqual(['reply:child',external.id]);expect(page.unavailable).toBe(1);
});
it('keeps pagination moving even when all saved originals in a page are unavailable',async()=>{
  state.rows=[{post_id:'removed'},{post_id:'restricted'},{post_id:'visible'}];state.lookup.mockResolvedValue(null);
  expect(await getBookmarkPage('viewer',0,2)).toEqual({entries:[],posts:[],unavailable:2,next:2});
});
it('uses the bookmark owner credentials for native original reads without writing',async()=>{
 const q:any={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[{id:'saved',post_id:'private',created_at:'2026-10-11'}],error:null})};
 const client:any={from:vi.fn(()=>q)};
 const context={client,userId:'other'};
 const page=await getBookmarkPage('other',0,20,context);
 expect(client.from).toHaveBeenCalledWith('bookmarks');
 expect(state.lookup).toHaveBeenCalledWith('private',context);
 expect(page.entries[0]).toMatchObject({savedAt:'2026-10-11',bookmarkId:'saved'});
 expect(state.writes).toEqual([]);
});
it('loads bookmark state beyond the first server page',async()=>{
  state.rows=Array.from({length:1001},(_,i)=>({post_id:`post-${i}`}));expect(await getBookmarkIds('viewer')).toHaveLength(1001);
  state.error=new Error('read denied');await expect(getBookmarkIds('viewer')).rejects.toThrow('read denied');
});

it('records confirmed bookmark changes, including removals, without learning failed writes',async()=>{
 const listener=vi.fn();window.addEventListener('lime:recommendation-engagement',listener);
 try {
  await setBookmark({id:'native'},true,'viewer');
  expect(listener.mock.calls[0][0].detail).toEqual({id:'native',viewer:'viewer',action:'bookmark',active:true});
  await setBookmark({id:'native'},false,'viewer');
  expect(listener.mock.calls[1][0].detail.active).toBe(false);
  state.error=new Error('denied');await expect(setBookmark({id:'native'},true,'viewer')).rejects.toThrow();
  expect(listener).toHaveBeenCalledTimes(2);
 }finally{window.removeEventListener('lime:recommendation-engagement',listener);}
});
