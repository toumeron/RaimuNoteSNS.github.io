import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({queries:[] as any[],rows:[] as any[],known:[] as any[],external:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const call:any={filters:{}};state.queries.push(call);const q:any={select:(s:string)=>{call.select=s;return q},eq:(key:string,value:any)=>{call.filters[key]=value;return q},order:()=>q,range:(start:number,end:number)=>{call.range=[start,end];return q},abortSignal:()=>Promise.resolve({data:call.select==='followee_id,external_handle'?state.known:state.rows,error:null})};return q}}}));
vi.mock('@/lib/bluesky',()=>({isBlueskyProfileId:(id:string)=>/^(did:|misskey-user:)/.test(id),fetchBlueskyFollowers:(args:any)=>state.external('followers',args),fetchBlueskyFollows:(args:any)=>state.external('following',args)}));
vi.mock('@/lib/externalProfileMetadata',()=>({externalProfileMetadata:async()=>null}));
import {fetchFollowListPage} from './followLists';
const target={id:'local',username:'target',displayName:'Target',bio:'',avatarUrl:'',coverUrl:'',createdAt:''};
beforeEach(()=>{state.queries=[];state.rows=[];state.known=[];state.external.mockReset();});
it('only displays accepted local follows and paginates rather than truncating',async()=>{
 state.rows=Array.from({length:50},(_,i)=>({profile:{id:String(i),username:`u${i}`,display_name:`User ${i}`,bio:'Full biography'}}));
 const result=await fetchFollowListPage(target,'followers','viewer','50');expect(result.users).toHaveLength(50);expect(result.cursor).toBe('100');expect(state.queries[0].filters).toEqual({followee_id:'local',approved:true});expect(state.queries[0].range).toEqual([50,99]);
});
it('known follower tab intersects accepted follows with target followers',async()=>{
 state.known=[{followee_id:'known'}];state.rows=[{profile:{id:'known',username:'known'}},{profile:{id:'unknown',username:'unknown'}}];
 const result=await fetchFollowListPage(target,'known','viewer',null);expect(result.users.map(u=>u.id)).toEqual(['known']);expect(state.queries[0].filters.approved).toBe(true);
});
it.each(['did:plc:external','misskey-user:external'])('supports provider list paging and known follower filtering for %s',async id=>{
 state.known=[{external_handle:'friend@misskey.io'}];state.external.mockResolvedValue({users:[{...target,id:'external-friend',username:'friend@misskey.io'},{...target,id:'other',username:'other'}],cursor:'next'});
 const result=await fetchFollowListPage({...target,id},'known','viewer','previous');expect(result.users).toHaveLength(1);expect(result.cursor).toBe('next');expect(state.external).toHaveBeenCalledWith('followers',expect.objectContaining({cursor:'previous',actor:'target',limit:50}));
});
