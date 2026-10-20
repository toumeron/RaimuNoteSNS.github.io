import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ja";
import { type QueryClient } from "@tanstack/react-query";
import { type CommentWithAuthor, type PostWithAuthor } from "@/types/index";
import { type PostTabFilter, type PostTabSort } from "@/components/ui/avatar";

// utils
// utils
// utils
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function searchPageUrl(raw:string):string {
 const query=raw.trim();
 return query?`/search?${new URLSearchParams({q:query,src:'typed_query'})}`:'/search';
}

/** Map supported social content URLs to the existing LimeNote readers. */
export function socialLinkPath(raw:string):string|null {
 try {
  const url=new URL(raw);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)return null;
  const host=url.hostname.toLowerCase();
  const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const profile=(actor:string)=>`/u/${encodeURIComponent(actor)}`;
  const post=(id:string)=>`/post/${encodeURIComponent(id)}`;
  if(/^(?:(?:www|mobile|m)\.)?(?:twitter\.com|x\.com)$/.test(host)){
   if(parts.length>=3&&parts[1]==='status'&&/^\d{2,20}$/.test(parts[2]))return post(`x:${parts[2]}`);
   if(parts[0]==='i'&&parts[1]==='web'&&parts[2]==='status'&&/^\d{2,20}$/.test(parts[3]??''))return post(`x:${parts[3]}`);
   if(parts[0]==='search'&&url.searchParams.get('q'))return searchPageUrl(`${url.searchParams.get('q')} source:twitter`);
   const reserved=new Set(['home','explore','search','notifications','messages','settings','intent','i','login','signup','compose','share','tos','privacy']);
   if(parts.length===1&&/^[A-Za-z0-9_]{1,15}$/.test(parts[0])&&!reserved.has(parts[0].toLowerCase()))return profile(`${parts[0]}@twitter.com`);
  }
  if(host==='bsky.app'||host==='www.bsky.app'){
   if(parts[0]==='search'&&url.searchParams.get('q'))return searchPageUrl(`${url.searchParams.get('q')} source:bluesky`);
   const actor=parts[1]??'';
   if(parts[0]!=='profile'||!(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(actor)||/^did:(?:plc|web):[a-z0-9.:%-]+$/i.test(actor)))return null;
   if(parts.length===2)return profile(actor);
   if(parts.length===4&&parts[2]==='post'&&/^[A-Za-z0-9]+$/.test(parts[3]))return post(`bsky:at://${actor}/app.bsky.feed.post/${parts[3]}`);
  }
  if(host==='misskey.io'){
   if(parts.length===2&&parts[0]==='notes'&&/^[A-Za-z0-9]+$/.test(parts[1]))return post(`misskey:https://misskey.io/notes/${parts[1]}`);
   if(parts.length===1&&/^@[A-Za-z0-9_-]+(?:@[a-z0-9.-]+)?$/i.test(parts[0]))return profile(parts[0].slice(1).includes('@')?parts[0].slice(1):`${parts[0].slice(1)}@misskey.io`);
  }
 }catch{/* Keep malformed or unsupported URLs as ordinary links. */}
 return null;
}

/** Retrying a rejected permission or missing RPC cannot repair the request. */
export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;
  const failure = error as {status?: number; code?: string; name?: string} | null;
  if (failure?.name === 'AbortError') return false;
  if (failure?.status && failure.status >= 400 && failure.status < 500 && failure.status !== 408) return false;
  if (/^(?:22|23|28|42|PGRST[12])/.test(failure?.code ?? '')) return false;
  return true;
}

const getYouTubeId = (url: string) => {
  // ショート動画 (/shorts/) も含めて判定できる正規表現に更新
  const regExp = /^.*(?:(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)|(?:shorts\/))([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[1].length === 11) ? match[1] : null;
};

const isInstalledPwa = () => typeof window !== 'undefined' && ((navigator as Navigator & {standalone?:boolean}).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true);

const isIosPwa=()=>isInstalledPwa()&&(/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));

const isIpad = () => typeof navigator !== 'undefined' && (/iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Keep federated handles intact in posts, profiles and expanded media.
function splitMentionText(text:string,hashtags=false):string[] {
  const mention='@[\\w-]+(?:[.@][\\w-]+)*';
  return text.split(new RegExp(`(https?://[^\\s]+|${mention}${hashtags ? '|#[^\\s#　.,!?:;\'"()\\[\\]{}<>]+' : ''})`,'g'));
}

function mentionProfileHandle(mention:string,author?:{id?:string;username?:string}):string {
  const handle=mention.replace(/^@/,'');
  if(handle.includes('@'))return handle;
  if(author?.id?.startsWith('x-user:'))return `${handle}@twitter.com`;
  if(!author?.id?.startsWith('misskey-user:'))return handle;
  return `${handle}@${author.username?.split('@')[1] || 'misskey.io'}`;
}

// Keep the same three-request budget, reserving one slot for the visible
// timeline so slow supplementary searches cannot occupy every connection.
type ExternalReadPriority='interactive'|'supplementary';
let activeExternalReads=0,activeSupplementaryReads=0;
const externalReadQueue:{start:()=>void;priority:ExternalReadPriority}[]=[];
function drainExternalReads(){
 while(activeExternalReads<3){
  let index=externalReadQueue.findIndex(job=>job.priority==='interactive');
  if(index<0&&activeSupplementaryReads<2)index=externalReadQueue.findIndex(job=>job.priority==='supplementary');
  if(index<0)return;
  externalReadQueue.splice(index,1)[0].start();
 }
}
async function externalRead<T>(read:()=>Promise<T>,signal?:AbortSignal,priority:ExternalReadPriority='supplementary'):Promise<T>{
 await new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const job={priority,start:()=>{signal?.removeEventListener('abort',cancel);activeExternalReads++;if(priority==='supplementary')activeSupplementaryReads++;resolve();}};
  const cancel=()=>{const index=externalReadQueue.indexOf(job);if(index>=0)externalReadQueue.splice(index,1);reject(signal?.reason);};
  externalReadQueue.push(job);signal?.addEventListener('abort',cancel,{once:true});drainExternalReads();
 });
 try{if(signal?.aborted)throw signal.reason;return await read();}
 finally{activeExternalReads--;if(priority==='supplementary')activeSupplementaryReads--;drainExternalReads();}
}

function accountSearchScore(user: {username:string;displayName:string}, query:string): number {
  const normalize = (text:string) => text.normalize('NFKC').toLocaleLowerCase().replace(/^@+/, '').trim();
  const q = normalize(query), name = normalize(user.displayName), handle = normalize(user.username);
  if (!q) return 0;
  if (name === q || handle === q || handle.split('@')[0] === q) return 100;
  if (name.startsWith(q) || handle.startsWith(q)) return 70;
  if (name.includes(q) || handle.includes(q)) return 40;
  return q.split(/\s+/).every(token => `${name} ${handle}`.includes(token)) ? 20 : 0;
}

async function externalFetch(url:string,init:RequestInit={},priority:ExternalReadPriority='supplementary'):Promise<Response> {
  return externalRead(async()=>{
    // Keep cancellation attached through response-body consumption; fetch()
    // resolves at headers, before json()/blob() has finished downloading.
    const timeout=AbortSignal.timeout(12000);
    let signal:AbortSignal;
    if(typeof AbortSignal.any==='function')signal=AbortSignal.any(init.signal?[init.signal,timeout]:[timeout]);
    else{
      const controller=new AbortController();
      const abort=()=>{controller.abort(init.signal?.aborted?init.signal.reason:timeout.reason);init.signal?.removeEventListener('abort',abort);timeout.removeEventListener('abort',abort);};
      init.signal?.addEventListener('abort',abort,{once:true});timeout.addEventListener('abort',abort,{once:true});
      if(init.signal?.aborted)abort();signal=controller.signal;
    }
    return fetch(url,{...init,signal});
  },init.signal ?? undefined,priority);
}

// format
dayjs.extend(relativeTime);
dayjs.locale('ja');

const formatRelative = (iso: string) => dayjs(iso).fromNow();
const formatDate = (iso: string) => dayjs(iso).format('YYYY/MM/DD HH:mm');

// displayUsername
/** Presentation only: stored handles and profile routes retain their provider suffix. */
function displayUsername(username:string|null|undefined):string{
 return (username??'').replace(/@(?:twitter|x)\.com$/i,'');
}

// clientName
/** Device platform available to the web client; do not guess a hardware model. */
function getClientName(userAgent = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints): string {
  let device = 'Web';
  if (/iPhone/i.test(userAgent)) device = 'iPhone';
  else if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) device = 'iPad';
  else if (/Android/i.test(userAgent)) device = 'Android';
  else if (/Windows/i.test(userAgent)) device = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(userAgent)) device = 'Mac';
  else if (/Linux/i.test(userAgent)) device = 'Linux';
  return `LimeNote for ${device}`;
}

// randomUUID
/** Generate record/channel IDs, including on LAN HTTP where randomUUID is absent. */
function randomUUID(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Compatibility for old runtimes; these IDs are not credentials or tokens.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// mobileDrawerGesture
// Feed-tab swipes and drawer swipes must reserve the same edge area.
const MOBILE_DRAWER_EDGE_ZONE = 96;

function isMobileDrawerBlocked(): boolean {
  return [...document.querySelectorAll<HTMLElement>(
    '[data-lime-maps], .lime-map-dialog, .lime-media-lightbox, [role="dialog"][aria-modal="true"]:not([data-lime-mobile-sidebar])'
  )].some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

// stickers
type CustomSticker = {id: string; name: string; public_id: string; format: string};
const stickerToken = (name: string) => `[[stamp:${encodeURIComponent(name)}]]`;
const appendSticker = (text: string, name: string | null) => [serializeDraftEmojis(text).trim(), name ? stickerToken(name) : ''].filter(Boolean).join(' ');
function splitStickers(text: string): {text: string; name?: string; inline?: boolean}[] {
  const result: {text: string; name?: string; inline?: boolean}[] = []; let end = 0;
  for (const match of text.matchAll(/\[\[(stamp|emoji):([^\]\s]+)\]\]/g)) {
    let name: string; try {name=decodeURIComponent(match[2]);} catch {continue;}
    if (!name || name.length > 100) continue;
    if (match.index! > end) result.push({text:text.slice(end,match.index)});
    result.push({text:match[0],name,...(match[1]==="emoji"?{inline:true}:{})}); end=match.index!+match[0].length;
  }
  if (end < text.length) result.push({text:text.slice(end)});
  return result;
}
const hasStickers = (text: string) => splitStickers(text).some(p=>p.name);
function stickerUrl(sticker: CustomSticker): string | null {
  if (!/^[\w/-]+$/.test(sticker.public_id) || !/^(png|jpg|jpeg|gif|webp|avif)$/i.test(sticker.format)) return null;
  const id=sticker.public_id.startsWith('custom_emojis/')?sticker.public_id:`custom_emojis/${sticker.public_id}`;
  return `https://res.cloudinary.com/dveiikhhw/image/upload/${id}.${sticker.format}`;
}

const stickersAreInline = (text: string) => splitStickers(text).some(part => !part.name && !!part.text.trim());

const draftEmojis = new Map<string,string>();
function draftEmojiCharacter(name:string):string {
  for(const [character,existing] of draftEmojis) if(existing===name)return character;
  const character=String.fromCharCode(0xE000+draftEmojis.size);
  draftEmojis.set(character,name);
  return character;
}
const draftEmojiName = (character:string) => draftEmojis.get(character);
const hasDraftEmojis = (text:string) => [...text].some(character=>draftEmojis.has(character));
const serializeDraftEmojis = (text:string) => [...text].map(character=>draftEmojiName(character)?`[[emoji:${encodeURIComponent(draftEmojiName(character)!)}]]`:character).join('');
function insertDraftEmoji(input:HTMLTextAreaElement|HTMLInputElement|null,text:string,name:string,onChange:(text:string)=>void) {
  const start=input?.selectionStart??text.length,end=input?.selectionEnd??start;
  const next=text.slice(0,start)+draftEmojiCharacter(name)+text.slice(end);
  onChange(next);
  requestAnimationFrame(()=>{if(input?.value!==next)return;input.focus();input.setSelectionRange(start+1,start+1);});
}

// postPresentation
// postPresentation
type PreviewPost={content?:string;imageUrls?:readonly string[];video?:unknown;externalVideo?:unknown;linkPreview?:{image?:string}};
function hasAttachedPostVideo(post:unknown):boolean{
 const media=post as {video?:unknown;externalVideo?:unknown}|null|undefined;return !!(media?.video||media?.externalVideo);
}
/** A link-card thumbnail is not an attached photo. */
function canShowPostLinkPreview(post:PreviewPost,embedded=false):boolean{
 return !embedded&&!post.video&&!post.externalVideo&&!(post.imageUrls??[]).some(url=>url!==post.linkPreview?.image)&&!/(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg)(?:[?#][^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s]+)/i.test(post.content??'');
}
const QUOTE_TEXT_LIMIT=140;
function quotePreviewText(content:string):string{
 const characters=Array.from(content);return characters.length>QUOTE_TEXT_LIMIT?characters.slice(0,QUOTE_TEXT_LIMIT).join('').trimEnd()+'…':content;
}

// spaceLinks
const SPACE_LINK = /https?:\/\/[^\s<>]+\/spaces\/([\w-]+)(?:\?[^\s<>]*)?/g;
function spaceLinkIn(content: string): { id: string; text: string } | null {
  for (const match of content.matchAll(SPACE_LINK)) {
    try {
      const url = new URL(match[0]);
      if ((url.hostname === 'toumeron.github.io' && url.pathname.startsWith('/RaimuNoteSNS.github.io/spaces/')) || (url.origin === window.location.origin && url.pathname.startsWith(`${import.meta.env.BASE_URL}spaces/`))) return { id: match[1], text: content.replace(match[0], '').trim() };
    } catch { /* Ignore malformed links. */ }
  }
  return null;
}
const spacePublicLink = (id: string) => `https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/${encodeURIComponent(id)}`;

// polls
type PollOption={label:string;image?:string;votes:number};
type Poll={options:PollOption[];endsAt:string};
type PollDraft={options:{label:string;image?:string}[];durationMinutes:number};
function validatePollDraft(poll:PollDraft):string|null {
 if(poll.options.length<2||poll.options.length>4)return '回答は2〜4個にしてください';
 if(poll.options.some(option=>!option.label.trim()||Array.from(option.label.trim()).length>25))return '回答は1〜25文字で入力してください';
 if(!Number.isInteger(poll.durationMinutes)||poll.durationMinutes<1||poll.durationMinutes>10080)return '投票期間は1分〜7日で設定してください';
 return null;
}
function pollRemaining(endsAt:string,now=Date.now()):string {
 const minutes=Math.ceil((Date.parse(endsAt)-now)/60000);
 return minutes<=0?'投票終了':minutes>=1440?`残り${Math.ceil(minutes/1440)}日`:minutes>=60?`残り${Math.ceil(minutes/60)}時間`:`残り${minutes}分`;
}
function pollPercent(votes:number,total:number):number {return total?Math.round(votes*100/total):0;}

// likeCountCache
const CHILD_KEYS = ['pages', 'posts', 'post', 'parentPost', 'parent_post', 'comments', 'comment', 'replies'] as const;

// Preserve cache shape and references for rows unaffected by this update.
function updateCount(value: unknown, targetId: string, count: number): unknown {
  if (Array.isArray(value)) {
    const next = value.map(item => updateCount(item, targetId, count));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  let next = row;
  if (row.id === targetId && (row.likesCount !== count || row.likes_count !== count)) {
    next = { ...row, likesCount: count, likes_count: count };
  }
  for (const key of CHILD_KEYS) {
    if (!(key in row)) continue;
    const child = updateCount(row[key], targetId, count);
    if (child !== row[key]) {
      if (next === row) next = { ...row };
      next[key] = child;
    }
  }
  return next;
}

function updateLikeCountCache(client: QueryClient, type: 'post' | 'comment', targetId: string, count: number) {
  const prefixes = type === 'post' ? ['feed', 'post', 'posts'] : ['comments', 'comment'];
  client.setQueriesData({
    predicate: query => prefixes.includes(String(query.queryKey[0])),
  }, data => updateCount(data, targetId, count));
}

// commentThread
function commentThreadUrl(postId: string, commentId: string) {
  return `/post/${encodeURIComponent(postId)}?reply=${encodeURIComponent(commentId)}`;
}

// Iterative traversal supports arbitrary depth without a recursive render or
// one HTTP request per ancestor. Reject malformed/cyclic chains safely.
function getCommentAncestors(comments: CommentWithAuthor[], commentId: string) {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const chain: CommentWithAuthor[] = [];
  const seen = new Set<string>();
  let current = byId.get(commentId);
  if (!current) return null;
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    chain.push(current);
    if (!current.parentCommentId) break;
    current = byId.get(current.parentCommentId);
    if (!current) return null;
  }
  return chain.reverse();
}

// Use the already loaded thread: reveal paths to the original author's replies
// without fetching each branch separately or exposing unrelated descendants.
function getAuthorReplyConversations(comments: CommentWithAuthor[], authorId?: string, parentCommentId: string | null = null, expandedReplies: ReadonlySet<string> = new Set()) {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const children = new Map<string | null, CommentWithAuthor[]>();
  for (const comment of byId.values()) {
    const parent = comment.parentCommentId ?? null;
    const siblings = children.get(parent) ?? [];
    siblings.push(comment);
    children.set(parent, siblings);
  }
  const paths = new Set<string>();
  if (authorId) for (const comment of byId.values()) {
    if (comment.userId !== authorId) continue;
    let current: CommentWithAuthor | undefined = comment;
    while (current && current.id !== parentCommentId && !paths.has(current.id)) {
      paths.add(current.id);
      current = current.parentCommentId ? byId.get(current.parentCommentId) : undefined;
    }
  }
  const newest = (a: CommentWithAuthor, b: CommentWithAuthor) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
  const answeredByAuthor = (comment: CommentWithAuthor) => (children.get(comment.id) ?? []).some(reply => paths.has(reply.id));
  const roots = [...(children.get(parentCommentId) ?? [])].sort((a, b) => Number(answeredByAuthor(b)) - Number(answeredByAuthor(a)) || newest(a, b));
  return roots.map(root => {
    const items: CommentWithAuthor[] = [], seen = new Set<string>();
    const stack = [root];
    const hasAuthorReply = answeredByAuthor(root);
    const hiddenReplyIds = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      items.push(current);
      // Inline previews only contain paths leading to an author reply.
      // Expanding cannot broaden this to unrelated third-party descendants.
      const replies = (children.get(current.id) ?? []).filter(reply => paths.has(reply.id));
      const expanded = expandedReplies.has(current.id);
      const ordered = [...replies].sort(newest).reverse();
      const continuation = current.id === root.id || current.userId !== authorId ? ordered[0] : undefined;
      const visible = (reply: CommentWithAuthor) => expanded || reply.id === continuation?.id;
      if (hasAuthorReply && replies.length && !replies.some(visible)) hiddenReplyIds.add(current.id);
      // Oldest first inside a conversation so the answer follows its question.
      stack.push(...replies.filter(visible).sort(newest));
    }
    // Each visible branch carries its own ancestry. A sibling starts another
    // conversation, rather than appearing below an unrelated answer.
    const visibleIds = new Set(items.map(comment => comment.id));
    const hasVisibleChildren = (comment: CommentWithAuthor) => (children.get(comment.id) ?? []).some(child => visibleIds.has(child.id));
    const ancestry = (comment: CommentWithAuthor) => {
      const path: CommentWithAuthor[] = [], visited = new Set<string>();
      let current: CommentWithAuthor | undefined = comment;
      while (current && visibleIds.has(current.id) && !visited.has(current.id)) {
        visited.add(current.id);
        path.push(current);
        if (current.id === root.id) break;
        current = current.parentCommentId ? byId.get(current.parentCommentId) : undefined;
      }
      return path.reverse();
    };
    const branches = items.filter(comment => !hasVisibleChildren(comment)).map(comment => ({
      items: ancestry(comment), moreFor: hiddenReplyIds.has(comment.id) ? comment : null,
    }));
    const threadIds = new Set(hasAuthorReply ? items.filter(comment => paths.has(comment.id)).map(comment => comment.id) : []);
    return { root, items, branches, threadIds, hiddenReplyIds, hasHiddenReplies: hiddenReplyIds.size > 0 };
  });
}

// profileReplyThreads
interface Reply { id: string; postId: string; createdAt: string; parentCommentId?: string | null }
/** Preserve the selected reply's feed position and its complete ancestor path. */
function buildProfileReplyThreads<C extends Reply, P, R>(comments: C[], posts: Map<string, P>, parents: Map<string, C>, postReactions: Map<string, R[]>, _commentReactions: Map<string, R[]>) {
  const byId = new Map([...parents, ...comments.map(comment => [comment.id, comment] as const)]);
  return comments.filter(comment => posts.has(comment.postId)).map(comment => {
    const chain: C[] = [];
    const seen = new Set<string>();
    let current: C | undefined = comment;
    let complete = true;
    while (current) {
      if (seen.has(current.id) || current.postId !== comment.postId) { complete = false; break; }
      seen.add(current.id); chain.push(current);
      if (!current.parentCommentId) break;
      current = byId.get(current.parentCommentId);
      if (!current) complete = false;
    }
    return {
      id: comment.id, createdAt: comment.createdAt, comment,
      comments: complete ? chain.reverse() : [comment],
      parentPost: complete ? posts.get(comment.postId) ?? null : null,
      parentReactions: complete ? postReactions.get(comment.postId) ?? [] : [],
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Keep the author-feed order, and reuse the native profile's parent/reply thread renderer. */
function externalProfileReplyThread(post: PostWithAuthor) {
  const parent = post.externalReplyParent ?? null;
  const comment = {
    ...post, postId: post.externalReplyToId ?? post.id, externalPost: post,
    replyToUsername: post.externalReplyToUsername ?? parent?.author.username, reactions: [],
  };
  return { id: post.id, createdAt: post.createdAt, comment, comments: [comment], parentPost: parent, parentReactions: [] };
}

/** Original posts and repost activity are separate profile entries. */
function profilePostIdentity(post: {id: string; profileRepostedBy?: string; profileRepostedAt?: string}): string {
  return post.profileRepostedBy
    ? `repost:${post.profileRepostedBy}:${post.id}:${post.profileRepostedAt || ''}`
    : `post:${post.id}`;
}

/** Quotes are authored posts; only reply/repost activity is excluded. */
function selectProfilePosts<T>(items: T[], filter: PostTabFilter, sort: PostTabSort, profileId?: string): T[] {
  const postOf = (item: any) => item.post ?? item.reply?.comment ?? item;
  const selected = items.filter((item: any) => {
    const post = postOf(item);
    if (filter === 'all') return true;
    const activity = post.externalPost ?? post;
    if (item.reply || post.replyId || post.externalReplyToId || post.profileRepostedBy || post.externalRepostedBy || activity.profileRepostedBy || activity.externalRepostedBy) return false;
    // Cached provider records can lack repost attribution. A twitter profile's
    // authored-post filter must still reject another account's posts.
    return !profileId?.startsWith('x-user:') || (activity.userId ?? activity.user_id ?? activity.author?.id) === profileId;
  });
  const time = (item: any) => Date.parse(item.sortAt ?? postOf(item).createdAt ?? postOf(item).created_at ?? '') || 0;
  const likes = (item: any) => Number(postOf(item).likesCount ?? postOf(item).likes_count ?? 0);
  const identity = (item: any) => `${postOf(item).id ?? ''}:${postOf(item).profileRepostedBy ?? ''}:${postOf(item).profileRepostedAt ?? ''}`;
  return selected.sort((a, b) => (sort === 'popular' ? likes(b) - likes(a) : 0) || time(b) - time(a) || (sort === 'latest' ? identity(b).localeCompare(identity(a)) : identity(a).localeCompare(identity(b))));
}

/** A complete ranking input: never publish a partially scanned chronological feed. */
async function collectProfilePages<T, C>(load: (cursor: C | null) => Promise<{ posts: T[]; cursor: C | null }>, signal?: AbortSignal): Promise<T[]> {
  const posts: T[] = [];
  const seen = new Set<C>();
  let cursor: C | null = null;
  do {
    signal?.throwIfAborted();
    const page = await load(cursor);
    signal?.throwIfAborted();
    posts.push(...page.posts);
    cursor = page.cursor;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error('投稿の取得カーソルが進みませんでした');
      seen.add(cursor);
    }
  } while (cursor !== null);
  return posts;
}

/** A repost and the original share one media tile; page boundaries may repeat both. */
function uniqueProfileMediaPosts<T extends {id:string;source?:string;userId?:string;profileRepostedBy?:string;externalRepostedBy?:unknown}>(posts:T[],profileId?:string):T[]{
 const seen=new Set<string>();
 return posts.filter(post=>{if(post.source==='x'&&(post.profileRepostedBy||post.externalRepostedBy||profileId&&post.userId!==profileId))return false;if(seen.has(post.id))return false;seen.add(post.id);return true;});
}

// twitterReplyPaging
type TwitterReplyPagingReply={id:string;externalReplyToId?:string};
type Page={post?:{id:string}|null;replies:TwitterReplyPagingReply[];cursor?:string|null;totalReplies?:number};
/** A cursor alone does not prove that any unseen replies remain. */
function nextTwitterReplyCursor(page:Page,pages:Page[],pageParam?:string|null,pageParams:(string|null)[]=[]):string|undefined{
 const cursor=page.cursor;if(!cursor||cursor===pageParam||pageParams.includes(cursor)||!page.replies.length)return;
 const earlier=new Set(pages.slice(0,-1).flatMap(row=>row.replies.map(reply=>reply.id)));
 if(!page.replies.some(reply=>!earlier.has(reply.id)))return;
 const total=pages.find(row=>typeof row.totalReplies==='number')?.totalReplies;
 if(total===0)return;
 const parent=pages.find(row=>row.post)?.post?.id;
 if(total!==undefined&&total>0&&parent){
  const direct=new Set(pages.flatMap(row=>row.replies.filter(reply=>!reply.externalReplyToId||reply.externalReplyToId===parent).map(reply=>reply.id)));
  if(direct.size>=total)return;
 }
 return cursor;
}

// twitterReplyText
/** Twitter prepends reply recipients to the text. They already have a separate
 * reply-to label; keep deliberate mentions elsewhere in the message intact. */
function twitterReplyText(content:string,isReply:boolean):string{
 return isReply?content.replace(/^(?:\s*@[A-Za-z0-9_]{1,15}(?=\s|$)\s*)+/,''):content;
}

export { cn };
export { splitMentionText };
export { mentionProfileHandle };
export { externalRead };
export { accountSearchScore };
export { externalFetch };
export { getYouTubeId };
export { isInstalledPwa };
export { isIosPwa };
export { isIpad };
export type { ExternalReadPriority };
export { formatRelative };
export { formatDate };
export { displayUsername };
export { getClientName };
export { randomUUID };
export { isMobileDrawerBlocked };
export { MOBILE_DRAWER_EDGE_ZONE };
export { splitStickers };
export { stickerUrl };
export { draftEmojiCharacter };
export { insertDraftEmoji };
export type { CustomSticker };
export { stickerToken };
export { appendSticker };
export { hasStickers };
export { stickersAreInline };
export { draftEmojiName };
export { hasDraftEmojis };
export { serializeDraftEmojis };
export { hasAttachedPostVideo };
export { canShowPostLinkPreview };
export { quotePreviewText };
export { QUOTE_TEXT_LIMIT };
export { spaceLinkIn };
export { spacePublicLink };
export { validatePollDraft };
export { pollRemaining };
export { pollPercent };
export type { PollOption };
export type { Poll };
export type { PollDraft };
export { updateLikeCountCache };
export { commentThreadUrl };
export { getCommentAncestors };
export { getAuthorReplyConversations };
export { buildProfileReplyThreads };
export { externalProfileReplyThread };
export { profilePostIdentity };
export { selectProfilePosts };
export { collectProfilePages };
export { uniqueProfileMediaPosts };
export { nextTwitterReplyCursor };
export { twitterReplyText };
