import { beforeEach, expect, it, vi } from 'vitest';
const source=vi.hoisted(()=>({profile:vi.fn(),page:vi.fn()}));
vi.mock('./bluesky',async original=>({...await original<typeof import('./bluesky')>(),fetchBlueskyProfile:source.profile,fetchBlueskyFollows:source.page}));
const state = vi.hoisted(() => ({
  user: 'alice', rows: [] as {user_id:string;provider:string;handle:string;created_at?:string;external_profile?:any}[],
  imported: new Set<string>(), fail: false, writes: [] as Record<string, unknown>[],
}));
vi.mock('./supabase', () => ({ supabase: {
  rpc: async (_name:string,args:any)=>{
    const {legacy,provider,handle,enabled}=args;
    if (state.fail) return {error:new Error('offline')};
    if(_name==='set_external_follow'){state.writes.push({user_id:state.user,provider,handle});state.rows=state.rows.filter(row=>row.user_id!==state.user||row.provider!==provider||row.handle!==handle);if(enabled)state.rows.push({user_id:state.user,provider,handle});return {error:null};}
    if (!state.imported.has(state.user)) {
      state.imported.add(state.user);
      for (const row of legacy) state.rows.push({...row,user_id:state.user});
    }
    return {error:null};
  },
  from: () => {
    let operation = 'read',start=0,end=Infinity; const filters: Record<string,any> = {};
    const q = {
      select: () => q, order: () => q,range:(a:number,b:number)=>{start=a;end=b;return q;},
      in:(key:string,value:string[])=>{filters[key]=value;return q;},abortSignal:()=>q,
      eq: (key:string,value:string) => {filters[key]=value;return q;},
      delete: () => {operation='delete';return q;},
      upsert:(rows:any[],options:any)=>({select:()=>({abortSignal:async()=>{
        if(state.fail)return {error:new Error('offline')};
        if(rows.some(row=>row.follower_id!==state.user))return {error:new Error('forbidden')};
        expect(options).toEqual({onConflict:'follower_id,follow_key',ignoreDuplicates:true});
        const data:any[]=[];
        for(const row of rows){if(state.rows.some(old=>old.user_id===row.follower_id&&old.provider===row.external_provider&&old.handle===row.external_handle))continue;state.writes.push(row);state.rows.push({user_id:row.follower_id,provider:row.external_provider,handle:row.external_handle,external_profile:row.external_profile});data.push({external_handle:row.external_handle});}
        return {data,error:null};
      }})}),
      then: (resolve:(result:unknown)=>unknown) => {
        if(state.fail)return Promise.resolve(resolve({error:new Error('offline')}));
        const matches = (row:any) => row.user_id===state.user&&Object.entries(filters).every(([key,value])=>{
         const actual=key==='follower_id'?row.user_id:key==='external_provider'?row.provider:key==='external_profile->followImport->>kind'?row.external_profile?.followImport?.kind:row[key];
         return Array.isArray(value)?value.includes(actual):actual===value;
        });
        const found=state.rows.filter(matches);
        if(operation==='delete')state.rows=state.rows.filter(row=>!matches(row));
        return Promise.resolve(resolve({data:found.slice(start,end+1).map(({provider,handle})=>({provider,handle})),count:found.length,error:null}));
      },
    };return q;
  },
} }));
import { importedFollowCount, removeImportedFollows, importPublicFollows, followImportActor, cloudExternalHandles, initialiseExternalAccounts, refreshExternalAccounts, setExternalAccountAdded, setExternalAccountOwner } from './externalAccounts';
beforeEach(() => {
  setExternalAccountOwner(null); localStorage.clear();source.profile.mockReset().mockResolvedValue({id:'did:plc:me',username:'me.bsky.social',followingCount:2,isPrivate:false});source.page.mockReset().mockResolvedValue({users:[],cursor:null});
  state.user='alice'; state.rows=[]; state.imported.clear(); state.fail=false; state.writes=[];
});
it('imports legacy handles once and removes local lists only after successful cloud load', async () => {
  localStorage.setItem('lime_bluesky_author_handles','["@Alice.Bsky.Social","@Alice.Bsky.Social"]');
  localStorage.setItem('lime_misskey_author_handles','["cat@misskey.io"]');
  setExternalAccountOwner('alice'); await initialiseExternalAccounts();
  expect(cloudExternalHandles('bluesky')).toEqual(['alice.bsky.social']);
  expect(cloudExternalHandles('misskey')).toEqual(['cat@misskey.io']);
  expect(localStorage.getItem('lime_bluesky_author_handles')).toBeNull();
  expect(state.rows).toHaveLength(2);
  await setExternalAccountAdded('bluesky','alice.bsky.social',false);
  // Another device's stale legacy list cannot resurrect a cloud deletion.
  setExternalAccountOwner(null);
  localStorage.setItem('lime_bluesky_author_handles','["alice.bsky.social"]');
  setExternalAccountOwner('alice'); await initialiseExternalAccounts();
  expect(cloudExternalHandles('bluesky')).toEqual([]);
});
it('persists additions/removals, loads on another device, and observes remote changes', async () => {
  setExternalAccountOwner('alice'); await initialiseExternalAccounts();
  await setExternalAccountAdded('bluesky','cat.bsky.social',true);
  await setExternalAccountAdded('misskey','cat@misskey.io',true);
  expect(localStorage.length).toBe(0);
  setExternalAccountOwner(null); setExternalAccountOwner('alice'); await initialiseExternalAccounts();
  expect(cloudExternalHandles('bluesky')).toEqual(['cat.bsky.social']);
  state.rows.push({user_id:'alice',provider:'bluesky',handle:'remote.bsky.social'});
  await refreshExternalAccounts();
  await setExternalAccountAdded('bluesky','cat.bsky.social',false);
  expect(cloudExternalHandles('bluesky')).toEqual(['remote.bsky.social']);
  expect(cloudExternalHandles('misskey')).toEqual(['cat@misskey.io']);
});
it('clears the previous account immediately and keeps account data isolated', async () => {
  setExternalAccountOwner('alice'); await setExternalAccountAdded('bluesky','alice.bsky.social',true);
  state.user='bob'; setExternalAccountOwner('bob');
  expect(cloudExternalHandles('bluesky')).toEqual([]);
  await setExternalAccountAdded('misskey','bob@misskey.io',true);
  expect(cloudExternalHandles('misskey')).toEqual(['bob@misskey.io']);
  state.user='alice'; setExternalAccountOwner('alice'); await initialiseExternalAccounts();
  expect(cloudExternalHandles('bluesky')).toEqual(['alice.bsky.social']);
  expect(cloudExternalHandles('misskey')).toEqual([]);
});
it('preserves local migration data on failure and does not report a failed write as added', async () => {
  localStorage.setItem('lime_bluesky_author_handles','["old.bsky.social"]');
  setExternalAccountOwner('alice'); state.fail=true;
  await expect(initialiseExternalAccounts()).rejects.toThrow('offline');
  expect(localStorage.getItem('lime_bluesky_author_handles')).not.toBeNull();
  state.fail=false; await initialiseExternalAccounts(); state.fail=true;
  await expect(setExternalAccountAdded('bluesky','failed.bsky.social',true)).rejects.toThrow('offline');
  expect(cloudExternalHandles('bluesky')).toEqual(['old.bsky.social']);
});
it('rejects signed-out writes', async () => {
  await expect(setExternalAccountAdded('bluesky','cat.bsky.social',true)).rejects.toThrow('ログイン');
  expect(state.writes).toEqual([]);
});

const followUser=(name:string,provider='bluesky')=>({id:provider==='x'?'x-user:'+name:'did:plc:'+name,username:provider==='x'?name+'@twitter.com':name+'.bsky.social',displayName:name,avatarUrl:'',bio:'',createdAt:''});
it('accepts plain IDs and profile links, rejecting other hosts',()=>{
 expect(followImportActor('x','@Some_User')).toBe('some_user@twitter.com');expect(followImportActor('x','https://x.com/Some_User')).toBe('some_user@twitter.com');
 expect(followImportActor('bluesky','@me')).toBe('me.bsky.social');expect(followImportActor('bluesky','https://bsky.app/profile/me.bsky.social')).toBe('me.bsky.social');
 expect(()=>followImportActor('x','https://evil.test/me')).toThrow();expect(()=>followImportActor('bluesky','me /')).toThrow();
});
it('imports every page additively, deduplicates and retains existing/native follows',async()=>{
 setExternalAccountOwner('alice');await initialiseExternalAccounts();await setExternalAccountAdded('bluesky','old.bsky.social',true);state.writes=[];
 source.page.mockResolvedValueOnce({users:[followUser('old'),followUser('one'),followUser('one')],cursor:'next'}).mockResolvedValueOnce({users:[followUser('two')],cursor:null});
 const progress=vi.fn(),profiles=vi.fn();expect(await importPublicFollows('bluesky','me','alice',{onProgress:progress,onProfiles:profiles})).toEqual({added:2,read:4});
 expect(cloudExternalHandles('bluesky')).toEqual(['old.bsky.social','one.bsky.social','two.bsky.social']);expect(state.writes).toHaveLength(2);expect(source.page.mock.calls[1][0].cursor).toBe('next');expect(profiles).toHaveBeenCalledTimes(2);
});
it('imports Twitter independently using public follows and stripped handles',async()=>{
 setExternalAccountOwner('alice');source.profile.mockResolvedValue({username:'me@twitter.com',followingCount:1,isPrivate:false});source.page.mockResolvedValue({users:[followUser('friend','x')],cursor:null});
 expect(await importPublicFollows('x','@me','alice')).toEqual({added:1,read:1});expect(cloudExternalHandles('x')).toEqual(['friend']);expect(source.page.mock.calls[0][0].actor).toBe('me@twitter.com');
});
it('rejects protected sources, unavailable lists and looping cursors instead of reporting success',async()=>{
 setExternalAccountOwner('alice');source.profile.mockResolvedValueOnce({username:'private@twitter.com',isPrivate:true});await expect(importPublicFollows('x','private','alice')).rejects.toThrow();expect(source.page).not.toHaveBeenCalled();
 await expect(importPublicFollows('bluesky','me','alice')).rejects.toThrow();
 source.page.mockResolvedValue({users:[followUser('one')],cursor:'repeat'});await expect(importPublicFollows('bluesky','me','alice')).rejects.toThrow();expect(cloudExternalHandles('bluesky')).toContain('one.bsky.social');
});
it('stops after account switches or cancellation without writing to the next account',async()=>{
 setExternalAccountOwner('alice');source.page.mockImplementationOnce(async()=>{state.user='bob';setExternalAccountOwner('bob');return {users:[followUser('one')],cursor:null};});
 await expect(importPublicFollows('bluesky','me','alice')).rejects.toThrow('切り替わり');expect(state.writes).toEqual([]);
 const controller=new AbortController();controller.abort();await expect(importPublicFollows('bluesky','me','bob',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
});
it('loads registered follows beyond the default 1000-row response limit',async()=>{
 state.rows=Array.from({length:1001},(_,i)=>({user_id:'alice',provider:'bluesky',handle:'user'+i+'.bsky.social'}));setExternalAccountOwner('alice');await initialiseExternalAccounts();expect(cloudExternalHandles('bluesky')).toHaveLength(1001);
});

it('ends on an empty terminal page even if the provider supplies another cursor',async()=>{
 setExternalAccountOwner('alice');source.page.mockResolvedValueOnce({users:[followUser('last')],cursor:'tail'}).mockResolvedValueOnce({users:[],cursor:'empty-terminal'});
 expect(await importPublicFollows('bluesky','me','alice')).toEqual({added:1,read:1});expect(source.page).toHaveBeenCalledTimes(2);
});
it('tags only newly imported follows and removes those tags without deleting manual or existing follows',async()=>{
 setExternalAccountOwner('alice');await setExternalAccountAdded('bluesky','old.bsky.social',true);await setExternalAccountAdded('x','manual',true);
 source.page.mockResolvedValueOnce({users:[followUser('old'),followUser('new')],cursor:null});await importPublicFollows('bluesky','me','alice');
 source.profile.mockResolvedValueOnce({username:'me@twitter.com',followingCount:1});source.page.mockResolvedValueOnce({users:[followUser('other','x')],cursor:null});await importPublicFollows('x','me','alice');
 expect(state.rows.find(row=>row.handle==='old.bsky.social')?.external_profile).toBeUndefined();
 expect(state.rows.find(row=>row.handle==='new.bsky.social')?.external_profile.followImport).toMatchObject({kind:'public-follow-import',source:'bluesky',actor:'me.bsky.social',version:1});
 expect(await importedFollowCount('alice')).toBe(2);
 expect((await removeImportedFollows('alice')).removed).toBe(2);
 expect(state.rows.map(row=>row.handle).sort()).toEqual(['manual','old.bsky.social']);expect(cloudExternalHandles('bluesky')).toEqual(['old.bsky.social']);expect(await importedFollowCount('alice')).toBe(0);
 state.user='bob';setExternalAccountOwner('bob');await expect(removeImportedFollows('alice')).rejects.toThrow('切り替わり');
});
