import { expect, it, vi } from 'vitest';
import { mergeAccountPage } from './mergeAccountPages';
type Item = {id:string;time:number};
const compare=(a:Item,b:Item)=>b.time-a.time||a.id.localeCompare(b.id);
it('merges all account streams in order, keeps a stable prefix, and deduplicates bookmarks across pages',async()=>{
 const data={a:[[{id:'same',time:9},{id:'a',time:7}],[{id:'later-a',time:3}]],b:[[{id:'b',time:10},{id:'same',time:8}],[{id:'later-b',time:5}]]};
 const load=vi.fn(async(id:string,offset:number)=>({items:data[id as 'a'|'b'][offset],next:offset===0?1:undefined}));
 const first=await mergeAccountPage(['a','b'],null,load,compare,item=>item.id,3);
 expect(first.items.map(i=>i.id)).toEqual(['b','same','a']);
 const saved=JSON.stringify(first.next);
 const second=await mergeAccountPage(['a','b'],first.next!,load,compare,item=>item.id,3);
 expect(second.items.map(i=>i.id)).toEqual(['later-b','later-a']);
 expect(second.next).toBeUndefined();expect(JSON.stringify(first.next)).toBe(saved);
});
it('continues past unavailable originals and stops exhausted sources',async()=>{
 const load=vi.fn(async(id:string,offset:number)=>({items:offset===1?[{id,time:1}]:[],next:id==='a'&&offset===0?1:undefined}));
 const page=await mergeAccountPage(['a','empty'],null,load,compare,item=>item.id,20);
 expect(page.items).toEqual([{id:'a',time:1}]);expect(page.next).toBeUndefined();expect(load).toHaveBeenCalledTimes(3);
});
it('does not silently omit an account when authentication or a read fails',async()=>{
 await expect(mergeAccountPage(['a','b'],null,async id=>{if(id==='b')throw new Error('login required');return {items:[{id,time:1}]};},compare,i=>i.id,20)).rejects.toThrow('login required');
});
it('aborts before reading any account',async()=>{
 const c=new AbortController();c.abort();const load=vi.fn();
 await expect(mergeAccountPage(['a'],null,load,compare,i=>i.id,20,c.signal)).rejects.toThrow();expect(load).not.toHaveBeenCalled();
});
it('retains distinct notification events even when IDs coincide across owners',async()=>{
 const page=await mergeAccountPage(['a','b'],null,async id=>({items:[{id,time:id==='a'?2:1}]}),compare,i=>i.id,20);
 expect(page.items).toHaveLength(2);
});
