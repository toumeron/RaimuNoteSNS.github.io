import {expect,it} from 'vitest';
import {groupMapPosts} from './mapPostGroups';
it('groups 10,000 dense posts without dropping any and skips offscreen projections',()=>{
 const posts=Array.from({length:10000},(_,i)=>({id:String(i),createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:35.68,longitude:139.76}}));
 const groups=groupMapPosts(posts,()=>({x:100,y:100}));expect(groups).toHaveLength(1);expect(groups[0].posts).toHaveLength(10000);
 expect(groupMapPosts(posts,()=>null)).toHaveLength(0);
});
it('keeps separate cells separately selectable',()=>{
 const posts=[0,1,2].map(i=>({id:String(i),createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:i,longitude:139}}));
 const groups=groupMapPosts(posts,p=>({x:p.mapLocation.latitude*25,y:0}));expect(groups).toHaveLength(3);expect(groups.flatMap(g=>g.posts)).toEqual(posts);
});


it('keeps coincident posts in one marker at their original position',()=>{
 const posts=['one','two'].map(id=>({id,createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:35.68113,longitude:139.76706}}));
 const groups=groupMapPosts(posts,()=>({x:120,y:80}));
 expect(groups).toHaveLength(1);expect(groups[0].point).toEqual({x:120,y:80});expect(groups[0].posts).toEqual(posts);
});
