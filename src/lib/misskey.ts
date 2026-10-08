import { cloudExternalHandles, saveExternalProviderHandles } from './externalAccounts';
import type { BlueskyMappedPost, BlueskyProfile } from './bluesky';
import {supabase} from './supabase';
import {externalRead, accountSearchScore} from './utils';

// All requests, credentials and IDs are scoped to the selected server.
export const MISSKEY_ORIGIN = 'https://misskey.io';
export const MISSKEY_ENABLED_KEY = 'lime_misskey_enabled';
export const MISSKEY_HANDLES_KEY = 'lime_misskey_author_handles';
export const isMisskeyId = (id?: string | null) => Boolean(id?.startsWith('misskey:') || id?.startsWith('misskey-user:'));
export const isMisskeyActor = (actor: string) => isMisskeyId(actor) || actor === 'misskey.io' || /^[^@\s/]+@[^@\s/]+$/.test(actor) || actor.startsWith(`${MISSKEY_ORIGIN}/@`);
export function misskeyEnabled() { return true; }
export function configuredMisskeyHandles(respectEnabled=true): string[] {
  if (respectEnabled && !misskeyEnabled()) return [];
  const cloud = cloudExternalHandles('misskey');
  if (cloud !== null) return cloud;
  try { return [...new Set<string>(JSON.parse(localStorage.getItem(MISSKEY_HANDLES_KEY) || '[]').filter((v:unknown) => typeof v === 'string' && /^[^@\s/]+@[^@\s/]+$/.test(v)))]; } catch { return []; }
}
export async function changeMisskeySetting(key:string, value:unknown) {
  if (key === MISSKEY_HANDLES_KEY) {
    await saveExternalProviderHandles('misskey', Array.isArray(value) ? value : []);
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event('lime-misskey-changed'));
}
// Misskey is an account reader, not an additional login provider.
type MisskeyUser = {id:string;username:string;host?:string|null;name?:string|null;avatarUrl?:string;bannerUrl?:string;description?:string;createdAt?:string;followersCount?:number;followingCount?:number;notesCount?:number;isBot?:boolean;isFollowing?:boolean};
export type MisskeyNote = {id:string;createdAt:string;text?:string|null;cw?:string|null;visibility:string;user:MisskeyUser;files?:{type:string;url:string;thumbnailUrl?:string;isSensitive?:boolean;comment?:string|null}[];reactions?:Record<string,number>;myReaction?:string|null;repliesCount?:number;renoteCount?:number;renote?:MisskeyNote;reply?:MisskeyNote};
let relayRequired=false;
export async function misskeyRequest<T>(endpoint:string, body:Record<string,unknown>={}, signal?:AbortSignal, required=false):Promise<T> {
  if (required) throw new Error('Misskeyの操作は元のサイトで行ってください');
  const {i: _unusedCredential, ...params}=body;
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Misskey request timed out','TimeoutError')),10000);
  try {
  const {data:{session}}=await supabase.auth.getSession();
  const readRelay=async()=>{
    const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'misskey',endpoint,params},signal:controller.signal}),controller.signal);
    if(result.error||!result.data||!('data' in result.data))throw new Error('Misskeyの取得に失敗しました');
    return result.data.data as T;
  };
  // Signed-in readers use the existing authenticated relay before attempting
  // browser requests that can fail CORS. Public, signed-out reads remain direct.
  if(session)return await readRelay();
  let response:Response;
  try {if(relayRequired)throw new TypeError('Direct reader unavailable');response=await externalRead(()=>fetch(`${MISSKEY_ORIGIN}/api/${endpoint}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:controller.signal}),controller.signal);}
  catch(error){
    if(!(error instanceof TypeError)||signal?.aborted||controller.signal.aborted)throw error;
    relayRequired=true;
    return await readRelay();
  }
  if (!response.ok) {
    const result=await response.json().catch(()=>null);
    throw new Error(`Misskey: ${result?.error?.message || response.status}`);
  }
  return response.status===204 ? undefined as T : await response.json() as T;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);} 
}
export function mapMisskeyUser(user:MisskeyUser):BlueskyProfile {
  if(!user?.id || !user.username)throw new Error("Misskeyのアカウント情報が無効です");
  return {id:`misskey-user:${user.id}`,username:`${user.username}@${user.host || 'misskey.io'}`,displayName:user.name || user.username,avatarUrl:user.avatarUrl || '',coverUrl:user.bannerUrl || '',bio:user.description || '',createdAt:user.createdAt || '',isOfficial:false,followersCount:user.followersCount || 0,followingCount:user.followingCount || 0,postsCount:user.notesCount || 0};
}
export function mapMisskeyNote(note:MisskeyNote,includeQuote=true):BlueskyMappedPost | null {
  if (note.visibility!=='public') return null;
  // Pure renotes are not a second copy of the same note. Quote notes retain their own ID.
  if (!note.text && !note.files?.length && note.renote) return null;
  const url=`${MISSKEY_ORIGIN}/notes/${note.id}`;
  const quoted=includeQuote && note.renote ? mapMisskeyNote(note.renote,false) : null;
  const imageAltTexts=(note.files??[]).filter(file=>file.type.startsWith('image/')).map(file=>file.comment??'');
  return {...(quoted ? {isQuote:true,parentId:quoted.id,parentPost:{...quoted,repostsCount:0,repostedByMe:false,author:{coverUrl:'',...quoted.author}}} : {}),id:`misskey:${url}`,userId:`misskey-user:${note.user.id}`,content:[note.cw,note.text].filter(Boolean).join('\n\n'),imageUrls:(note.files || []).filter(file=>file.type.startsWith('image/')).map(file=>file.url),imageAltTexts,createdAt:note.createdAt,visibility:'public',likedByMe:Boolean(note.myReaction),likesCount:Object.values(note.reactions || {}).reduce((a,b)=>a+b,0),commentsCount:note.repliesCount || 0,isBot:Boolean(note.user.isBot),cid:note.id,author:mapMisskeyUser(note.user),source:'misskey',blueskyUrl:url,blueskyUri:url};
}
const noteId = (id:string) => {
  const match=id.match(/^(?:misskey:)?https:\/\/misskey\.io\/notes\/([a-zA-Z0-9]+)$/);
  if (!match) throw new Error('Misskeyの投稿IDが無効です');
  return match[1];
};
const profileCache=new Map<string,{profile:BlueskyProfile;expires:number}>();
export async function misskeyProfile(actor:string,signal?:AbortSignal) {
  const normalized=actor.replace(`${MISSKEY_ORIGIN}/@`,'').replace(/^@/,'');
  const cached=profileCache.get(normalized.toLowerCase());
  if(cached && cached.expires>Date.now())return cached.profile;
  const [username,host]=normalized.split('@');
  const body=actor.startsWith('misskey-user:') ? {userId:actor.slice('misskey-user:'.length)} : {username,host:!host || host==='misskey.io' ? null:host};
  const row=await misskeyRequest<MisskeyUser|null>('users/show',body,signal);
  if(!row)throw new Error('Misskeyのアカウントが見つかりません');
  const profile=mapMisskeyUser(row);
  const entry={profile,expires:Date.now()+300000};
  profileCache.set(normalized.toLowerCase(),entry);profileCache.set(profile.username.toLowerCase(),entry);profileCache.set(profile.id,entry);
  if(profileCache.size>100)profileCache.delete(profileCache.keys().next().value!);
  return profile;
}
export async function misskeyFeed(options:{actor?:string;cursor?:string|null;limit?:number;filter?:string;signal?:AbortSignal}={}) {
  const limit=Math.min(100,Math.max(1,options.limit || 30));
  const actor=options.actor || 'misskey.io';
  const body:Record<string,unknown>={limit,...(options.cursor ? {untilId:options.cursor} : {})};
  if(options.filter==='posts_with_media')body.withFiles=true;
  if (actor!=='misskey.io') body.userId=(await misskeyProfile(actor,options.signal)).id.slice('misskey-user:'.length);
  const rows=await misskeyRequest<MisskeyNote[]>(actor==='misskey.io' ? 'notes/local-timeline' : 'users/notes',body,options.signal);
  return {posts:rows.filter(note=>(options.filter || 'posts_no_replies')!=='posts_no_replies' || !note.reply).map(note=>mapMisskeyNote(note)).filter((post):post is BlueskyMappedPost=>Boolean(post)),cursor:rows.length===limit ? rows.at(-1)!.id : null};
}
export async function misskeyThread(id:string,signal?:AbortSignal) {
  const body={noteId:noteId(id)};
  const [note,replies]=await Promise.all([misskeyRequest<MisskeyNote>('notes/show',body,signal),misskeyRequest<MisskeyNote[]>('notes/children',{...body,limit:100},signal).catch(error=>{if(signal?.aborted)throw error;return [];})]);
  return {post:mapMisskeyNote(note),replies:replies.map(note=>mapMisskeyNote(note)).filter((post):post is BlueskyMappedPost=>Boolean(post))};
}
const searchCache=new Map<string,{result:{posts:BlueskyMappedPost[];users:BlueskyProfile[]};expires:number}>();
/** Fetch only topic notes; discovery does not need a parallel account search. */
export async function fetchMisskeyTopicPosts(options:{query:string;cursor?:string|null;limit?:number;signal?:AbortSignal}) {
 const limit=Math.min(30,Math.max(1,options.limit??20));
 const notes=await misskeyRequest<MisskeyNote[]>('notes/search',{query:options.query,limit,...(options.cursor?{untilId:options.cursor}:{})},options.signal);
 return {posts:notes.map(note=>mapMisskeyNote(note)).filter((post):post is BlueskyMappedPost=>Boolean(post)),cursor:notes.length===limit?notes.at(-1)!.id:null};
}
export async function searchMisskey(query:string,includePosts=true,signal?:AbortSignal) {
  const normalized=query.trim().replace(`${MISSKEY_ORIGIN}/@`,'').replace(/^@+/, '');
  if(!normalized)return {posts:[],users:[]};
  const key=`${includePosts}:${normalized.toLocaleLowerCase()}`;
  const cached=searchCache.get(key) || (!includePosts ? searchCache.get(`true:${normalized.toLocaleLowerCase()}`):undefined);
  if(cached && cached.expires>Date.now())return cached.result;
  const nameQuery=normalized.replace(/@misskey\.io$/i,'');
  // Display-name search is ordered by activity at the server. Rank the broader
  // candidate list locally so an exact name is not lost behind active accounts.
  const cachedUsers=searchCache.get(`false:${normalized.toLocaleLowerCase()}`);
  const accountJobs:Promise<BlueskyProfile[]>[]=[cachedUsers && cachedUsers.expires>Date.now() ? Promise.resolve(cachedUsers.result.users):misskeyRequest<MisskeyUser[]>('users/search',{query:nameQuery,limit:100,origin:'local'},signal).then(rows=>rows.filter(user=>!user.host || user.host==='misskey.io').map(mapMisskeyUser))];
  if((!cachedUsers || cachedUsers.expires<=Date.now()) && /^[a-zA-Z0-9_.-]+(?:@[^@\s]+)?$/.test(normalized)) {
    accountJobs.push(misskeyProfile(normalized.includes('@') ? normalized : `${normalized}@misskey.io`,signal).then(user=>[user]));
  }
  const accounts=Promise.allSettled(accountJobs).then(results=>{
    if(results.every(result=>result.status==='rejected'))throw (results[0] as PromiseRejectedResult).reason;
    return results.flatMap(result=>result.status==='fulfilled' ? result.value:[]);
  });
  const [notes,users]=await Promise.allSettled([includePosts ? misskeyRequest<MisskeyNote[]>('notes/search',{query:query.trim().replace(/^#/, ''),limit:30},signal) : Promise.resolve([] as MisskeyNote[]),accounts]);
  if(signal?.aborted)throw signal.reason;
  if(notes.status==='rejected' && users.status==='rejected')throw notes.reason;
  const ranked=users.status==='fulfilled' ? [...new Map(users.value.map(user=>[user.id,user])).values()].sort((a,b)=>accountSearchScore(b,normalized)-accountSearchScore(a,normalized)):[];
  const result={posts:(notes.status==='fulfilled' ? notes.value:[]).map(note=>mapMisskeyNote(note)).filter((post):post is BlueskyMappedPost=>Boolean(post)),users:ranked.slice(0,25)};
  if(users.status==='fulfilled' && notes.status==='fulfilled') {
    searchCache.set(key,{result,expires:Date.now()+60000});
    if(searchCache.size>30)searchCache.delete(searchCache.keys().next().value!);
  }
  return result;
}
export async function misskeyFollowList(actor:string,following:boolean,cursor?:string|null,limit=30,signal?:AbortSignal) {
  const profile=await misskeyProfile(actor,signal);
  const rows=await misskeyRequest<{id:string;followee?:MisskeyUser;follower?:MisskeyUser}[]>(following ? 'users/following':'users/followers',{userId:profile.id.slice('misskey-user:'.length),limit,...(cursor ? {untilId:cursor} : {})},signal);
  return {users:rows.flatMap(row=>{const user=following ? row.followee:row.follower;return user ? [mapMisskeyUser(user)]:[];}),cursor:rows.length===limit ? rows.at(-1)!.id:null};
}
export async function misskeyViewer(id:string,signal?:AbortSignal) {
  const note=await misskeyRequest<MisskeyNote>('notes/show',{noteId:noteId(id)},signal);
  return {cid:note.id,likeUri:note.myReaction ? `misskey-reaction:${note.id}` : null};
}
export async function likeMisskey(id:string) {const target=noteId(id);await misskeyRequest('notes/reactions/create',{noteId:target,reaction:'❤️'},undefined,true);return `misskey-reaction:${target}`;}
export async function unlikeMisskey(id:string) {await misskeyRequest('notes/reactions/delete',{noteId:id.slice('misskey-reaction:'.length)},undefined,true);}
export async function misskeyFollowState(id:string,signal?:AbortSignal) {
  const user=await misskeyRequest<MisskeyUser>('users/show',{userId:id.slice('misskey-user:'.length)},signal);
  return {followUri:user.isFollowing ? `misskey-follow:${user.id}`:null};
}
export async function followMisskey(id:string) {const userId=id.slice('misskey-user:'.length);await misskeyRequest('following/create',{userId},undefined,true);return `misskey-follow:${userId}`;}
export async function unfollowMisskey(id:string) {await misskeyRequest('following/delete',{userId:id.slice('misskey-follow:'.length)},undefined,true);}
