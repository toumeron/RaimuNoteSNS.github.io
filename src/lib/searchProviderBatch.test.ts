import {expect,it} from 'vitest';
import type {PostWithAuthor} from '@/types';
import {searchProviderBatch} from './searchProviderBatch';
const post=(id:string)=>({id,source:id.startsWith('x:')?'x':'bluesky'}) as PostWithAuthor;
it('keeps six relevant twitter results visible when newer Bluesky results would otherwise fill all twenty slots',()=>{
 const other=Array.from({length:30},(_,i)=>post('bsky:'+i)),twitter=Array.from({length:6},(_,i)=>post('x:'+i));
 const first=searchProviderBatch([...other,...twitter],20,true);
 expect(first.posts.filter(post=>post.source==='x').map(post=>post.id)).toEqual(twitter.map(post=>post.id));expect(first.posts[0].source).toBe('x');expect(first.posts).toHaveLength(20);
 const second=searchProviderBatch(first.remaining,20,true);expect(new Set([...first.posts,...second.posts].map(post=>post.id)).size).toBe(36);expect(second.remaining).toEqual([]);
});
it('mixes equal numbers when enough matching results exist, without changing order inside each service',()=>{
 const rows=[...Array.from({length:30},(_,i)=>post('bsky:'+i)),...Array.from({length:30},(_,i)=>post('x:'+i))];
 const page=searchProviderBatch(rows,20,true);expect(page.posts.filter(post=>post.source==='x')).toHaveLength(10);expect(page.posts.slice(0,4).map(post=>post.id)).toEqual(['x:0','bsky:0','x:1','bsky:1']);
});
it('retains normal ranking for an explicitly selected source and fills shortages without placeholders',()=>{
 const rows=[post('bsky:1'),post('x:1')];expect(searchProviderBatch(rows,20,false).posts).toEqual(rows);expect(searchProviderBatch([post('x:1'),post('x:1')],20,true).posts).toHaveLength(1);
});
