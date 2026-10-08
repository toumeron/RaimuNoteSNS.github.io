import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: 'alice', rows: [] as {user_id:string;provider:string;handle:string;created_at?:string}[],
  imported: new Set<string>(), fail: false, writes: [] as Record<string, unknown>[],
}));
vi.mock('./supabase', () => ({ supabase: {
  rpc: async (_name: string, { legacy }: {legacy:{provider:string;handle:string}[]}) => {
    if (state.fail) return {error:new Error('offline')};
    if (!state.imported.has(state.user)) {
      state.imported.add(state.user);
      for (const row of legacy) state.rows.push({...row,user_id:state.user});
    }
    return {error:null};
  },
  from: () => {
    let operation = 'read'; const filters: Record<string,string> = {};
    const q = {
      select: () => q, order: () => q,
      eq: (key:string,value:string) => {filters[key]=value;return q;},
      delete: () => {operation='delete';return q;},
      upsert: async (row:{user_id:string;provider:string;handle:string}) => {
        if(state.fail)return {error:new Error('offline')};
        if(row.user_id!==state.user)return {error:new Error('forbidden')};
        state.writes.push(row);
        if(!state.rows.some(existing=>existing.user_id===row.user_id&&existing.provider===row.provider&&existing.handle===row.handle))state.rows.push(row);
        return {error:null};
      },
      then: (resolve:(result:unknown)=>unknown) => {
        if(state.fail)return Promise.resolve(resolve({error:new Error('offline')}));
        const matches = (row:Record<string,string>) => row.user_id===state.user&&Object.entries(filters).every(([key,value])=>row[key]===value);
        if(operation==='delete')state.rows=state.rows.filter(row=>!matches(row));
        return Promise.resolve(resolve({data:state.rows.filter(matches).map(({provider,handle})=>({provider,handle})),error:null}));
      },
    };return q;
  },
} }));
import { cloudExternalHandles, initialiseExternalAccounts, refreshExternalAccounts, setExternalAccountAdded, setExternalAccountOwner } from './externalAccounts';
beforeEach(() => {
  setExternalAccountOwner(null); localStorage.clear();
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
