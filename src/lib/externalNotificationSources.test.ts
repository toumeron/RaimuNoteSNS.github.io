import {afterEach,expect,it,vi} from 'vitest';
import {fetchExternalEvents} from '../../supabase/functions/check-external-notifications/sources';
afterEach(()=>vi.unstubAllGlobals());
const target={id:'subscription',provider:'bluesky' as const,external_actor:'alice.bsky.social',created_at:'2026-10-08T10:00:00Z'};
it('omits historical posts, reposts and replies; carries images and stable external ids',async()=>{
 const post=(key:string,date:string)=>({uri:`at://did:plc:alice/app.bsky.feed.post/${key}`,indexedAt:date,author:{handle:'alice.bsky.social',displayName:'Alice'},record:{text:key,createdAt:date},embed:{images:[{thumb:'https://image.example/thumb'}]}});
 const fetch=vi.fn().mockResolvedValue(Response.json({feed:[{post:post('new','2026-10-08T11:00:00Z')},{post:post('repost','2026-10-08T11:00:00Z'),reason:{$type:"app.bsky.feed.defs#reasonRepost"}},{post:{...post('reply','2026-10-08T11:00:00Z'),record:{reply:{},text:'reply'}}},{post:post('old','2026-10-01T11:00:00Z')}]}));vi.stubGlobal('fetch',fetch);
 const rows=await fetchExternalEvents(target);expect(rows.map(row=>row.content)).toEqual(['new']);expect(rows[0].id).toBe('bsky:at://did:plc:alice/app.bsky.feed.post/new');expect(rows[0].images).toEqual(['https://image.example/thumb']);
});
it('paginates and skips events already observed without changing the provider host',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({feed:[],cursor:'next'})).mockResolvedValueOnce(Response.json({feed:[{post:{uri:'at://seen',indexedAt:'2026-10-08T11:00:00Z',record:{text:'seen'}}}]}));vi.stubGlobal('fetch',fetch);
 expect(await fetchExternalEvents({...target,external_cursor:{seen:['bsky:at://seen']}})).toEqual([]);expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toContain('cursor=next');
});
it('Misskey uses only the fixed public API and excludes nonpublic notes and replies',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({id:'actor',name:'Alice',avatarUrl:'avatar'})).mockResolvedValueOnce(Response.json([{id:'new',url:'https://remote.example/notes/remote-id',createdAt:'2026-10-08T11:00:00Z',visibility:'public',text:'note',files:[]},{id:'private',createdAt:'2026-10-08T11:00:00Z',visibility:'followers',text:'secret'},{id:'reply',createdAt:'2026-10-08T11:00:00Z',visibility:'public',replyId:'parent',text:'reply'}]));vi.stubGlobal('fetch',fetch);
 const result=await fetchExternalEvents({...target,provider:'misskey',external_actor:'alice@127.0.0.1'});expect(result.map(row=>row.id)).toEqual(['misskey:https://misskey.io/notes/new']);expect(fetch.mock.calls.every(([url])=>String(url).startsWith('https://misskey.io/api/'))).toBe(true);
});
it('does not replace the cursor after a provider failure',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})));await expect(fetchExternalEvents(target)).rejects.toThrow('503');});

it('does not stop at a pinned old post or a previously seen post mixed with new ones',async()=>{
 const item=(key:string,date:string)=>({post:{uri:'at://'+key,indexedAt:date,record:{text:key}}});
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({feed:[{...item('pin','2020-01-01'),reason:{$type:'app.bsky.feed.defs#reasonPin'}},item('seen','2026-10-08T11:00:00Z'),item('new','2026-10-08T11:00:00Z')],cursor:'second'})).mockResolvedValueOnce(Response.json({feed:[item('next','2026-10-08T10:30:00Z')]}));vi.stubGlobal('fetch',fetch);
 const rows=await fetchExternalEvents({...target,external_cursor:{seen:['bsky:at://seen']}});expect(rows.map(row=>row.content)).toEqual(['next','new']);expect(fetch).toHaveBeenCalledTimes(2);
});
