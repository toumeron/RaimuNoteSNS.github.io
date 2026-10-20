import { randomUUID } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { fetchBlueskyFollows, normalizeBlueskyHandle, fetchBlueskyProfile } from "@/lib/bluesky";
import { type User } from "@/types/index";
import { useSyncExternalStore } from "react";

// externalAccounts
type ExternalProvider = 'bluesky' | 'misskey' | 'x';
type ExternalAccount = { provider: ExternalProvider; handle: string };
let owner: string | null = null;
let accounts: ExternalAccount[] = [];
let generation = 0;
let revision = 0;
let loading: Promise<void> | null = null;

function notify() {
  window.dispatchEvent(new Event('lime-bluesky-handles-changed'));
  window.dispatchEvent(new Event('lime-misskey-changed'));
}
function setExternalAccountOwner(id: string | null) {
  if (owner === id) return;
  owner = id; accounts = []; loading = null; generation++; revision++;
  notify();
}
function cloudExternalHandles(provider: ExternalProvider): string[] | null {
  return owner ? accounts.filter(row => row.provider === provider).map(row => row.handle) : null;
}
function legacyAccounts(): ExternalAccount[] {
  const rows: ExternalAccount[] = [];
  for (const provider of ['bluesky', 'misskey'] as const) {
    try {
      const values: unknown = JSON.parse(localStorage.getItem(`lime_${provider}_author_handles`) ?? '[]');
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (typeof value !== 'string') continue;
        const handle = value.trim().replace(/^@+/, '').replace(/\/$/, '').toLowerCase();
        if (!handle || handle.length > 253 || /[\s/]/.test(handle)) continue;
        if (provider === 'misskey' && !/^[^@]+@[^@]+$/.test(handle)) continue;
        if (!rows.some(row => row.provider === provider && row.handle === handle)) rows.push({ provider, handle });
      }
    } catch { /* Invalid legacy data should not prevent loading cloud data. */ }
  }
  return rows;
}
async function refresh(id: string, version: number) {
  const readRevision = revision;
  const next:ExternalAccount[]=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from('external_account_users').select('provider,handle').eq('user_id',id).order('created_at',{ascending:true}).order('handle').range(offset,offset+999);
    if(error)throw error;
    if(owner!==id||generation!==version||revision!==readRevision)return;
    next.push(...((data??[]) as ExternalAccount[]));
    if((data?.length??0)<1000)break;
  }
  if (accounts.length === next.length && accounts.every((row, index) => row.provider === next[index].provider && row.handle === next[index].handle)) return;
  accounts = next;
  notify();
}
async function initialiseExternalAccounts(): Promise<void> {
  if (!owner) throw new Error('ログインしてください');
  if (loading) return loading;
  const id = owner, version = generation, legacy = legacyAccounts();
  const promise = (async () => {
    // A server-side marker makes import one-time across ALL devices. A removed
    // account cannot return because another browser still has an old local list.
    const { error } = await supabase.rpc('import_external_account_users', { legacy });
    if (error) throw error;
    if (owner !== id || generation !== version) return;
    await refresh(id, version);
    if (owner !== id || generation !== version) return;
    for (const provider of ['bluesky', 'misskey']) {
      try { localStorage.removeItem(`lime_${provider}_author_handles`); } catch { /* Optional legacy cleanup. */ }
    }
  })();
  loading = promise;
  try { await promise; }
  catch (error) { if (loading === promise) loading = null; throw error; }
}
async function refreshExternalAccounts() {
  await initialiseExternalAccounts();
  if (owner) await refresh(owner, generation);
}
async function setExternalAccountAdded(provider: ExternalProvider, handle: string, added: boolean, profile?: {id:string;username:string;displayName?:string;avatarUrl?:string;bio?:string;providerVerification?:import('@/types').User['providerVerification']}) {
  const id = owner, version = generation;
  if (!id) throw new Error('ログインしてください');
  await initialiseExternalAccounts();
  if (owner !== id || generation !== version) throw new Error('アカウントが切り替わりました');
  const normal = handle.trim().replace(/^@+/, '').replace(/\/$/, '').toLowerCase();
  if (!normal || normal.length > 253 || /[\s/]/.test(normal)) throw new Error('ユーザー名が正しくありません');
  const result = await supabase.rpc('set_external_follow',{provider,handle:normal,enabled:added,profile:profile??null});
  if (result.error) throw result.error;
  if (owner !== id || generation !== version) return;
  revision++;
  accounts = accounts.filter(row => row.provider !== provider || row.handle !== normal);
  if (added) accounts.push({ provider, handle: normal });
  notify();
}
async function saveExternalProviderHandles(provider: ExternalProvider, handles: string[]): Promise<string[]> {
  await initialiseExternalAccounts();
  const previous = cloudExternalHandles(provider) ?? [];
  const next = [...new Set(handles.map(handle => handle.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean))];
  for (const handle of previous) if (!next.includes(handle)) await setExternalAccountAdded(provider, handle, false);
  for (const handle of next) if (!previous.includes(handle)) await setExternalAccountAdded(provider, handle, true);
  return cloudExternalHandles(provider) ?? [];
}

function importRequest<T>(job:PromiseLike<T>,signal?:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(callback:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);callback();};
  const abort=()=>finish(()=>reject(signal?.reason??new DOMException('Aborted','AbortError')));
  const timer=setTimeout(()=>finish(()=>reject(new Error('取得がタイムアウトしました'))),15000);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  Promise.resolve(job).then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
 });
}
export type FollowImportProvider='x'|'bluesky';
export function followImportActor(provider:FollowImportProvider,input:string){
 let value=input.trim();
 if(provider==='x'){
   if(/^https?:/i.test(value)){const url=new URL(value);if(!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)||!/^\/[a-zA-Z0-9_]{1,15}\/?$/.test(url.pathname))throw new Error('');value=url.pathname.slice(1).replace(/\/$/,'');}
   value=value.replace(/^@+/,'').replace(/@(?:twitter|x)\.com$/i,'');
   if(!/^[a-zA-Z0-9_]{1,15}$/.test(value))throw new Error('');
   return `${value.toLowerCase()}@twitter.com`;
 }
 if(/^https?:/i.test(value)){const url=new URL(value);if(url.hostname!=='bsky.app'||!/^\/profile\/[^/]+\/?$/.test(url.pathname))throw new Error('BlueskyのIDを確認してください');}
 value=normalizeBlueskyHandle(value);
 if(!value.includes('.')&&!value.startsWith('did:'))value+='.bsky.social';
 if(!/^(?:did:(?:plc|web):[^\s/?#]+|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})$/i.test(value))throw new Error('BlueskyのIDを確認してください');
 return value;
}
/** Explicit, additive import. One public read and one owner-scoped bulk write per page. */
export async function importPublicFollows(provider:FollowImportProvider,input:string,userId:string,options:{signal?:AbortSignal;onProgress?:(added:number)=>void;onProfiles?:(users:User[])=>void}={}){
 const actor=followImportActor(provider,input),version=generation,batchId=randomUUID(),importedAt=new Date().toISOString();
 const check=()=>{options.signal?.throwIfAborted();if(owner!==userId||generation!==version)throw new Error('アカウントが切り替わりました');};
 check();await importRequest(initialiseExternalAccounts(),options.signal);check();
 const profile=await fetchBlueskyProfile(actor,options.signal);check();
 if(!profile)throw new Error(provider==='x'?'':'アカウントが見つかりません');
 if(profile.isPrivate)throw new Error('');
 let cursor:string|null=null,added=0,read=0;const cursors=new Set<string|null>();
 const seen=new Set(cloudExternalHandles(provider)??[]),readIds=new Set<string>();
 do{
  check();if(cursors.has(cursor))throw new Error('');cursors.add(cursor);
  const page=await fetchBlueskyFollows({actor:profile.username,cursor,limit:100,signal:options.signal});check();
  const unseen=page.users.filter(user=>!readIds.has(user.id));
  if(page.users.length&&!unseen.length&&page.cursor)throw new Error('');
  page.users.forEach(user=>readIds.add(user.id));
  read+=page.users.length;
  if(!page.users.length&&!cursor&&profile.followingCount>0)throw new Error('');
  const users=page.users.filter(user=>provider==='x'?user.id.startsWith('x-user:'):user.id.startsWith('did:'));
  const unique=new Map(users.map(user=>[provider==='x'?user.username.replace(/@(?:twitter|x)\.com$/i,'').toLowerCase():user.username.toLowerCase(),user]));
  const rows=[...unique].filter(([handle])=>!seen.has(handle)&&!!handle&&handle!=='handle.invalid').map(([handle,user])=>({follower_id:userId,external_provider:provider,external_handle:handle,external_profile:{id:user.id,username:user.username,displayName:user.displayName,avatarUrl:user.avatarUrl,bio:user.bio,providerVerification:user.providerVerification,followImport:{kind:'public-follow-import',version:1,batchId,source:provider,actor:profile.username,importedAt}}}));
  if(rows.length){
   const query=supabase.from('follows').upsert(rows,{onConflict:'follower_id,follow_key',ignoreDuplicates:true}).select('external_handle');
   const timeout=AbortSignal.timeout(15000);
   const signal=typeof AbortSignal.any==='function'?AbortSignal.any(options.signal?[options.signal,timeout]:[timeout]):options.signal??timeout;
   const {data,error}=await query.abortSignal(signal);
   if(error)throw error;check();
   added+=(data??[]).length;revision++;
   const localHandles=new Set(accounts.filter(account=>account.provider===provider).map(account=>account.handle));
   for(const row of rows){seen.add(row.external_handle);if(!localHandles.has(row.external_handle)){accounts.push({provider,handle:row.external_handle});localHandles.add(row.external_handle);}}
   options.onProfiles?.(users as User[]);notify();
  }
  options.onProgress?.(added);
  const next=page.users.length?page.cursor??null:null;
  if(next&&cursors.has(next))throw new Error('');
  cursor=next;
 }while(cursor);
 return {added,read};
}

/** Provenance is stored inside the existing external_profile JSON. Duplicate
 * manual follows are never updated/tagged by the additive importer. */
export async function importedFollowCount(userId:string,signal?:AbortSignal){
 let query=supabase.from('follows').select('*',{count:'exact',head:true}).eq('follower_id',userId).in('external_provider',['x','bluesky']).eq('external_profile->followImport->>kind','public-follow-import');
 if(signal)query=query.abortSignal(signal);
 const {count,error}=await query;if(error)throw error;return count??0;
}
export async function removeImportedFollows(userId:string,signal?:AbortSignal){
 const version=generation;
 if(owner!==userId)throw new Error('アカウントが切り替わりました');
 signal?.throwIfAborted();
 let query=supabase.from('follows').delete({count:'exact'}).eq('follower_id',userId).in('external_provider',['x','bluesky']).eq('external_profile->followImport->>kind','public-follow-import');
 if(signal)query=query.abortSignal(signal);
 const {count,error}=await query;if(error)throw error;
 if(owner!==userId||generation!==version)throw new Error('アカウントが切り替わりました');
 let refreshFailed=false;try{await importRequest(refresh(userId,version),signal);}catch{refreshFailed=true;}
 return {removed:count??0,refreshFailed};
}

// externalProfileMetadata
const profiles=new Map<string,{expires:number;promise:Promise<User|null>}>();
/** Public metadata only. Coalesce repeated authors and bound requests/cache. */
function externalProfileMetadata(actor:string):Promise<User|null>{
 const cached=profiles.get(actor);if(cached&&cached.expires>Date.now())return cached.promise;
 const promise=fetchBlueskyProfile(actor,AbortSignal.timeout(4000)).then(profile=>profile as User|null).catch(()=>null);
 profiles.set(actor,{expires:Date.now()+300000,promise});
 if(profiles.size>100)profiles.delete(profiles.keys().next().value!);
 return promise;
}
async function completeExternalPostAuthors<T extends {id:string;userId:string;author:any}>(posts:T[],signal?:AbortSignal):Promise<T[]>{
 const output=[...posts];let index=0;
 await Promise.all(Array.from({length:Math.min(3,posts.length)},async()=>{
  while(index<posts.length&&!signal?.aborted){const slot=index++,post=posts[slot];
   if(!/^(bsky:|misskey:)/.test(post.id)||post.author?.avatarUrl&&post.author?.displayName)continue;
   const actor=post.author?.username||post.userId;if(!actor)continue;
   const profile=await externalProfileMetadata(actor);
   if(profile&&(profile.avatarUrl&&profile.avatarUrl!==post.author?.avatarUrl||profile.displayName&&profile.displayName!==post.author?.displayName))output[slot]={...post,author:{...post.author,...profile,display_name:profile.displayName,avatar_url:profile.avatarUrl}};
  }
 }));return output;
}

// sharedAccountDisplay
const project = new URL(import.meta.env.VITE_SUPABASE_URL).hostname;
const SHARED_DISPLAY_KEY = `lime_shared_display:${project}:v1`;
const EVENT = 'lime-shared-display-changed';
let fallback = false;
function readSharedDisplay() {
  try { return localStorage.getItem(SHARED_DISPLAY_KEY) === 'true'; } catch { return fallback; }
}
function setSharedDisplay(enabled: boolean) {
  fallback = enabled;
  try { localStorage.setItem(SHARED_DISPLAY_KEY, String(enabled)); } catch { /* Session fallback. */ }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === SHARED_DISPLAY_KEY || event.key === null) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', storage); };
}
const useSharedDisplay = () => useSyncExternalStore(subscribe, readSharedDisplay, () => false);

export { setExternalAccountOwner };
export { cloudExternalHandles };
export { initialiseExternalAccounts };
export { refreshExternalAccounts };
export { setExternalAccountAdded };
export { saveExternalProviderHandles };
export type { ExternalProvider };
export { externalProfileMetadata };
export { completeExternalPostAuthors };
export { readSharedDisplay };
export { setSharedDisplay };
export { SHARED_DISPLAY_KEY };
export { useSharedDisplay };
