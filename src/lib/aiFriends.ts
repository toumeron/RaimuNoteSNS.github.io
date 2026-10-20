import { randomUUID } from "@/lib/utils";
import { useSyncExternalStore, useCallback, useEffect, useState } from "react";
import { notifySuspendedAction } from "@/lib/accountSuspension";
import { readChatImage, writeChatImage } from "@/lib/offlineBookmarks";
import { boundedResponseBlob } from "@/lib/privateMediaFetch";

// aiFriends
type AssistantItem = {
  id: string
  slug: string | null
  name: string
  description: string
  systemPrompt: string
  starter: string
  /** 電話に出たときの第一声 */
  greeting: string
  category: string
  builtin: boolean
  gender?: 'female' | 'male'
  lang?: 'ja-JP' | 'en-US'
  pitch?: number
  rate?: number
  coverUrl?: string
  birthday?: string
  favorite?: boolean
}

type Preset = {
  slug: string;
  name: string;
  category: string;
  description: string;
  starter: string;
  greeting: string;
  systemPrompt: string;
  gender: "female" | "male";
  lang?: "ja-JP" | "en-US";
  pitch?: number;
  rate?: number;
};

/** 「機能」ではなく「人」として話せるキャラクター。会話の共通ルールは buildContents 側で付与します */
const PRESETS: Preset[] = [
  {
    slug: "nakkar7",
    name: "なか",
    category: "友達",
    gender: "female",
    description: "かわいいイラストレーター〜！",
    starter: "こんにちは",
    greeting: "猫です。",
    systemPrompt:
      "あなたの名前は「なか」でファンへの丁寧なお礼を中心に穏やかで親しみやすいトーンで投稿し、仕事熱心でファンを大切にしつつ控えめに日常を過ごす優しい性格のイラストレーター。",
  },

    {
    slug: "km170",
    name: "担々麺",
    category: "友達",
    gender: "female",
    description: "猫ちゃん",
    starter: "こんにちは",
    greeting: "猫です。",
    systemPrompt:
      "あなたの名前は「たんたんめん」でお寿司ともふもふを愛し、引きこもり気味の自由気ままでユーモラスな内向的性格のイラストレーター。",
  },

];

const AI_FRIENDS_CHANGED = 'lime-ai-friends-changed';
const key = (uid: string | null | undefined, name: string) => `limeai:${uid || 'guest'}:${name}`;
function read<T>(uid: string | null | undefined, name: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key(uid,name)) || 'null') ?? fallback } catch { return fallback } }
function readList<T>(uid: string | null | undefined, name: string): T[] { const data=read<unknown>(uid,name,[]);return Array.isArray(data)?data:[] }
function write(uid: string | null | undefined, name: string, value: unknown) { localStorage.setItem(key(uid,name),JSON.stringify(value));window.dispatchEvent(new Event(AI_FRIENDS_CHANGED)); }
type AssistantDraft = {
  id?: string
  coverUrl?: string
  birthday?: string
  favorite?: boolean
  name: string
  description: string
  systemPrompt: string
  starter: string
  greeting: string
  gender: 'female' | 'male'
}

function loadCustomAssistants(uid?: string | null): AssistantItem[] {
  return readList<AssistantItem>(uid, 'assistants')
}

function saveCustomAssistant(uid: string | null | undefined, draft: AssistantDraft): AssistantItem[] {
  const list = loadCustomAssistants(uid)
  if (draft.id) {
    const existing = list.find(a => a.id === draft.id) ?? BUILTIN_ASSISTANTS.find(a => a.id === draft.id)
    if (!existing) throw new Error('フレンドが見つかりません')
    const edited = { ...existing, ...draft, id: existing.id }
    const next = list.some(a => a.id === draft.id) ? list.map(a => a.id === draft.id ? edited : a) : [...list, edited]
    write(uid, 'assistants', next)
    return next
  }
  const item: AssistantItem = {
    id: `custom:${randomUUID()}`,
    slug: null,
    name: draft.name,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    starter: draft.starter,
    greeting: draft.greeting,
    category: 'カスタム',
    builtin: false,
    gender: draft.gender,
    coverUrl: draft.coverUrl,
    birthday: draft.birthday,
    favorite: draft.favorite,
  }
  const next = [...list, item]
  write(uid, 'assistants', next)
  return next
}

function deleteCustomAssistant(uid: string | null | undefined, id: string): AssistantItem[] {
  const next = loadCustomAssistants(uid).filter((a) => a.id !== id)
  write(uid, 'assistants', next)
  return next
}

/* ---------- キャラクターのアイコン画像 (ブラウザ内に保存) ---------- */
type AvatarMap = Record<string, string>

const loadAvatars = (uid?: string | null) => read<AvatarMap>(uid, 'avatars', {})

/** 保存に成功したら true(容量超過などで失敗したら false) */
function saveAvatars(uid: string | null | undefined, map: AvatarMap): boolean {
  try {
    localStorage.setItem(key(uid, 'avatars'), JSON.stringify(map))
    window.dispatchEvent(new Event(AI_FRIENDS_CHANGED))
    return true
  } catch {
    return false
  }
}

const AVATAR_COLORS: [string, string][] = [
  ['#ffb3c7', '#ff7a9c'],
  ['#a8d8f4', '#4fb3e8'],
  ['#c5b8f5', '#8b6fe0'],
  ['#ffd59a', '#ff9f43'],
  ['#9fe0c2', '#38b17f'],
  ['#f6b7a4', '#e5745a'],
]

/** 初期アイコン(人のシルエット)。キャラクターIDごとに色が決まる */
function defaultAvatarUrl(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [c1, c2] = AVATAR_COLORS[h % AVATAR_COLORS.length]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
    `<rect width="128" height="128" fill="url(#g)"/>` +
    `<circle cx="64" cy="50" r="22" fill="#fff" fill-opacity=".92"/>` +
    `<path d="M20 128c0-27 19-44 44-44s44 17 44 44z" fill="#fff" fill-opacity=".92"/>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const avatarOf = (a: { id: string }, avatars: AvatarMap) => avatars[a.id] || defaultAvatarUrl(a.id)

const BUILTIN_ASSISTANTS: AssistantItem[] = PRESETS.map((p) => ({
  id: `builtin:${p.slug}`,
  slug: p.slug,
  name: p.name,
  description: p.description,
  systemPrompt: p.systemPrompt,
  starter: p.starter,
  greeting: p.greeting,
  category: p.category,
  builtin: true,
  gender: p.gender,
  lang: p.lang,
  pitch: p.pitch,
  rate: p.rate,
}))

const listAssistants = (uid?: string | null): AssistantItem[] => {
 const saved=loadCustomAssistants(uid);
 return [...BUILTIN_ASSISTANTS.map(item=>saved.find(override=>override.id===item.id)??item),...saved.filter(item=>!BUILTIN_ASSISTANTS.some(builtin=>builtin.id===item.id))];
}

const findAssistant = (uid: string | null | undefined, id: string | null | undefined) =>
  id ? listAssistants(uid).find((a) => a.id === id) ?? null : null

const AI_CHAT_HISTORY_CHANGED = 'lime-ai-chat-history-changed';

const AI_CHAT_DELETED = 'lime-ai-chat-deleted';

// groupFriendCall
type FriendCallUtterance = { name: string; content: string };
const GROUP_CALL_LISTEN = '[LISTEN]';
const GROUP_CALL_INSTRUCTION = '\nこれは複数の友達とユーザーによるグループ音声通話です。会話記録の話者名を区別し、先にユーザーと他の友達の発言を最後まで聞いてから、自分として発言してください。自分への呼びかけ、質問への回答、自分ならではの意見がある場合にだけ、自然な口調で1〜2文、120文字以内で話してください。他の人の回答の繰り返し、不要な相づち、全員への一律の返答は不要です。今は聞くだけでよい場合は [LISTEN] だけを返してください。他の参加者やユーザーの発言を代弁しないでください。';

/** Only one request and one spoken reply at a time; each next friend hears completed turns. */
async function runGroupFriendTurn({ participants, history, userName, text, signal, ask, speak }: {
  participants: AssistantItem[]; history: FriendCallUtterance[]; userName: string; text: string; signal: AbortSignal;
  ask: (friend: AssistantItem, history: FriendCallUtterance[], signal: AbortSignal) => Promise<string>;
  speak: (friend: AssistantItem, reply: string, signal: AbortSignal) => Promise<void>;
}) {
  if (signal.aborted) return;
  history.push({ name: userName, content: text });
  for (const friend of participants) {
    if (signal.aborted) return;
    const reply = (await ask(friend, history.slice(-20).map(turn => ({ ...turn })), signal)).trim();
    if (signal.aborted) return;
    if (!reply || reply === GROUP_CALL_LISTEN) continue;
    await speak(friend, reply, signal);
    if (signal.aborted) return;
    history.push({ name: friend.name, content: reply });
    if (history.length > 40) history.splice(0, history.length - 40);
  }
}

// companionPreferences
type CompanionPreferences = {enabled:boolean;modelId:string;size:number;side:'left'|'right';x:number|null;y:number|null;viewportWidth?:number;viewportHeight?:number};
const DEFAULT_COMPANION:CompanionPreferences={enabled:false,modelId:'default',size:220,side:'right',x:null,y:null};
const event='lime-companion-change';
function companionKey(userId:string){return `lime-companion:${userId}`;}
function readCompanion(userId:string):CompanionPreferences{
 try{const raw=JSON.parse(localStorage.getItem(companionKey(userId))||'null');if(!raw)return DEFAULT_COMPANION;
 return {enabled:raw.enabled===true,modelId:typeof raw.modelId==='string'?raw.modelId:'default',size:Math.max(120,Math.min(360,Number(raw.size)||220)),side:raw.side==='left'?'left':'right',x:Number.isFinite(raw.x)?raw.x:null,y:Number.isFinite(raw.y)?raw.y:null,viewportWidth:Number(raw.viewportWidth)>0?Number(raw.viewportWidth):undefined,viewportHeight:Number(raw.viewportHeight)>0?Number(raw.viewportHeight):undefined};
 }catch{return DEFAULT_COMPANION;}
}
function updateCompanion(userId:string,patch:Partial<CompanionPreferences>){
 localStorage.setItem(companionKey(userId),JSON.stringify({...readCompanion(userId),...patch}));window.dispatchEvent(new Event(event));
}
function subscribe(callback:()=>void){window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};}
function snapshot(userId:string){try{return localStorage.getItem(companionKey(userId));}catch{return null;}}
function useCompanion(userId:string){const raw=useSyncExternalStore(subscribe,()=>snapshot(userId),()=>null);return raw?readCompanion(userId):DEFAULT_COMPANION;}

// chatBackground
const DATABASE='lime-chat-backgrounds',STORE='backgrounds';
const keyFor=(userId:string,chatId:string)=>JSON.stringify([userId,chatId]);
type StoredBackground={bytes:ArrayBuffer;type:string};
async function store<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DATABASE,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),r=operation(tx.objectStore(STORE));let result:T;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>{db.close();resolve(result)};tx.onabort=()=>{db.close();reject(tx.error??r.error??new Error('背景を保存できませんでした'))};tx.onerror=()=>{db.close();reject(tx.error??r.error)}});
}
function useChatBackground(userId?:string,chatId?:string){
 const key=userId&&chatId?keyFor(userId,chatId):'';const [revision,setRevision]=useState(0);const [state,setState]=useState({key:'',url:''});const [error,setError]=useState('');
 useEffect(()=>{let cancelled=false,url='';setError('');if(!key){setState({key:'',url:''});return;}
 void store<StoredBackground|undefined>('readonly',s=>s.get(key)).then(value=>{if(cancelled)return;if(value?.bytes instanceof ArrayBuffer)url=URL.createObjectURL(new Blob([value.bytes],{type:value.type}));setState({key,url});}).catch(()=>{if(!cancelled)setError('保存した背景を読み込めませんでした。');});
 return()=>{cancelled=true;if(url)URL.revokeObjectURL(url)};
 },[key,revision]);
 const save=useCallback(async(blob:Blob|null)=>{if(!key)throw new Error('会話を選択してください');const value=blob?{bytes:await blob.arrayBuffer(),type:blob.type}:null;await store('readwrite',s=>value?s.put(value,key):s.delete(key));setRevision(value=>value+1);},[key]);
 return {url:state.key===key?state.url:'',save,error};
}
async function prepareChatBackground(file:File):Promise<Blob>{
 if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type)||file.size>10485760)throw new Error('画像はPNG・JPEG・WebP・GIF・AVIF形式、10MB以内にしてください');
 const url=URL.createObjectURL(file);
 try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('背景画像を読み込めませんでした');ctx.drawImage(img,0,0,canvas.width,canvas.height);return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('背景画像を読み込めませんでした')),'image/webp',.85));}
 finally{URL.revokeObjectURL(url)}
}

// chatModelFallback
type ChatModel = 'fast' | 'advanced';
type Event = Record<string, any>;
class ChatRequestError extends Error {
  constructor(message: string, readonly retryable = true) { super(message); }
}
/** Buffer friend replies so a failed partial reply is never delivered or duplicated. */
async function streamChatWithFallback({ model, retry, signal, request, onEvent }: {
  model: ChatModel; retry: boolean; signal?: AbortSignal;
  request: (model: ChatModel) => Promise<Response>; onEvent: (event: Event) => void;
}) {
  // Provider failover is server-owned; never restart this conversation on another Groq model.
  const models: ChatModel[] = [model];
  for (let attempt = 0; attempt < models.length; attempt++) {
    const events: Event[] = [];
    let action = false;
    try {
      signal?.throwIfAborted();
      const response = await request(models[attempt]);
      if (!response.ok && response.status === 403) {
        const body = await response.clone().json().catch(() => null);
        if (body?.code === 'ACCOUNT_SUSPENDED') {notifySuspendedAction();throw new ChatRequestError(body.error, false);}
      }
      if (!response.ok) throw new ChatRequestError(`会話を取得できませんでした (${response.status})`, response.status === 429 || response.status >= 500);
      if (!response.body) throw new ChatRequestError('会話の応答が空でした');
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let buffer = '', doneMarker = false;
      const consume = (line: string) => {
        if (!line.trim().startsWith('data:')) return;
        const data = line.trim().slice(5).trim();
        if (data === '[DONE]') { doneMarker = true; return; }
        let event: Event; try { event = JSON.parse(data); } catch { return; }
        action ||= event.type === 'agent_action_request' || event.type === 'agent_action_result';
        if (retry && event.type === 'edge_error') throw new ChatRequestError(event.publicMessage || '会話モデルでエラーが発生しました');
        if (retry) events.push(event); else onEvent(event);
      };
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        while (true) {
          signal?.throwIfAborted();
          const { value, done } = await reader.read();
          signal?.throwIfAborted();
          if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const line of lines) consume(line);
        }
      } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (retry) {
        const text = events.map(event => event.choices?.[0]?.delta?.content || '').join('').trim();
        // The current server's fatal-error handler also emits this as ordinary text.
        if (!doneMarker || !text || text === '一時的なエラーが発生しました。もう一度お試しください。') throw new ChatRequestError('会話モデルの応答が完了しませんでした');
      }
    } catch (error) {
      if (signal?.aborted || (error as Error).name === 'AbortError' || action || attempt === models.length - 1 || error instanceof ChatRequestError && !error.retryable) throw error;
      continue;
    }
    // Application callbacks are outside the retry block; side effects are not retried.
    if (retry) for (const event of events) onEvent(event);
    return;
  }
}

// chatImageCache
const pending=new Map<string,Promise<Blob>>();
const MAX_BYTES=10*1024*1024;
const eligible=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&(['upload.wikimedia.org','thumb.wikimedia.org','res.cloudinary.com'].includes(u.hostname)||u.hostname.endsWith('.supabase.co'));}catch{return false}};
/** Cache only successful image responses, separately for each signed-in account. */
async function loadChatImage(url:string,account:string):Promise<Blob>{
 const key=JSON.stringify([account,url]);const existing=pending.get(key);if(existing)return existing;
 const request=(async()=>{
  try{const saved=await readChatImage(account,url);if(saved)return saved;}catch{/* Storage can be disabled; the image still works online. */}
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  if(!response.ok||!/^image\//i.test(response.headers.get('content-type')??''))throw Error('Image unavailable');
  const blob=await boundedResponseBlob(response,MAX_BYTES);
  try{await writeChatImage(account,url,blob);}catch{/* A full cache must not prevent display. */}
  return blob;
 })();pending.set(key,request);try{return await request;}finally{pending.delete(key)}
}
function useCachedChatImage(url:string,account='public'){
 const canCache=eligible(url)&&typeof indexedDB!=='undefined';const [state,setState]=useState({key:'',src:''});const key=JSON.stringify([account,url]);
 useEffect(()=>{if(!canCache)return;let cancelled=false,local='';void loadChatImage(url,account).then(blob=>{if(cancelled)return;local=URL.createObjectURL(blob);setState({key,src:local});}).catch(()=>{if(!cancelled)setState({key,src:url})});return()=>{cancelled=true;if(local)URL.revokeObjectURL(local)}},[url,account,key,canCache]);
 return canCache?(state.key===key?state.src:''):url;
}

// chatPostLink
/** Resolve only links to this app; arbitrary sites with /post paths stay links. */
function findChatPostLink(content:string):{id:string;url:string}|null{
 for(const raw of content.match(/https?:\/\/[^\s]+/gi)??[]){
  try{
   const url=new URL(raw.replace(/[)\]}>。、，．！？!?]+$/g,''));
   if(!['localhost','127.0.0.1','toumeron.github.io'].includes(url.hostname))continue;
   const match=url.pathname.replace(/\/+$/,'').match(/^(?:\/RaimuNoteSNS\.github\.io)?\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
   if(match)return {id:match[1],url:url.href};
  }catch{/* Incomplete links remain ordinary message text. */}
 }
 return null;
}

export { loadCustomAssistants };
export { saveCustomAssistant };
export { deleteCustomAssistant };
export { saveAvatars };
export { defaultAvatarUrl };
export type { AssistantItem };
export { AI_FRIENDS_CHANGED };
export type { AssistantDraft };
export type { AvatarMap };
export { loadAvatars };
export { avatarOf };
export { listAssistants };
export { findAssistant };
export { AI_CHAT_HISTORY_CHANGED };
export { AI_CHAT_DELETED };
export { runGroupFriendTurn };
export type { FriendCallUtterance };
export { GROUP_CALL_LISTEN };
export { GROUP_CALL_INSTRUCTION };
export { companionKey };
export { readCompanion };
export { updateCompanion };
export { useCompanion };
export type { CompanionPreferences };
export { DEFAULT_COMPANION };
export { useChatBackground };
export { prepareChatBackground };
export { streamChatWithFallback };
export type { ChatModel };
export { loadChatImage };
export { useCachedChatImage };
export { findChatPostLink };
