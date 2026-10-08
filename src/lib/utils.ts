import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getYouTubeId = (url: string) => {
  // ショート動画 (/shorts/) も含めて判定できる正規表現に更新
  const regExp = /^.*(?:(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)|(?:shorts\/))([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[1].length === 11) ? match[1] : null;
};

export const isInstalledPwa = () => typeof window !== 'undefined' && ((navigator as Navigator & {standalone?:boolean}).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true);

export const isIosPwa=()=>isInstalledPwa()&&(/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));

export const isIpad = () => typeof navigator !== 'undefined' && (/iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Keep federated handles intact in posts, profiles and expanded media.
export function splitMentionText(text:string,hashtags=false):string[] {
  const mention='@[\\w-]+(?:[.@][\\w-]+)*';
  return text.split(new RegExp(`(${mention}${hashtags ? '|#[^\\s#　.,!?:;\'"()\\[\\]{}<>]+' : ''})`,'g'));
}

export function mentionProfileHandle(mention:string,author?:{id?:string;username?:string}):string {
  const handle=mention.replace(/^@/,'');
  if(handle.includes('@') || !author?.id?.startsWith('misskey-user:'))return handle;
  return `${handle}@${author.username?.split('@')[1] || 'misskey.io'}`;
}

// Keep the same three-request budget, reserving one slot for the visible
// timeline so slow supplementary searches cannot occupy every connection.
export type ExternalReadPriority='interactive'|'supplementary';
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
export async function externalRead<T>(read:()=>Promise<T>,signal?:AbortSignal,priority:ExternalReadPriority='supplementary'):Promise<T>{
 await new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const job={priority,start:()=>{signal?.removeEventListener('abort',cancel);activeExternalReads++;if(priority==='supplementary')activeSupplementaryReads++;resolve();}};
  const cancel=()=>{const index=externalReadQueue.indexOf(job);if(index>=0)externalReadQueue.splice(index,1);reject(signal?.reason);};
  externalReadQueue.push(job);signal?.addEventListener('abort',cancel,{once:true});drainExternalReads();
 });
 try{if(signal?.aborted)throw signal.reason;return await read();}
 finally{activeExternalReads--;if(priority==='supplementary')activeSupplementaryReads--;drainExternalReads();}
}

export function accountSearchScore(user: {username:string;displayName:string}, query:string): number {
  const normalize = (text:string) => text.normalize('NFKC').toLocaleLowerCase().replace(/^@+/, '').trim();
  const q = normalize(query), name = normalize(user.displayName), handle = normalize(user.username);
  if (!q) return 0;
  if (name === q || handle === q || handle.split('@')[0] === q) return 100;
  if (name.startsWith(q) || handle.startsWith(q)) return 70;
  if (name.includes(q) || handle.includes(q)) return 40;
  return q.split(/\s+/).every(token => `${name} ${handle}`.includes(token)) ? 20 : 0;
}

export async function externalFetch(url:string,init:RequestInit={},priority:ExternalReadPriority='supplementary'):Promise<Response> {
  return externalRead(async()=>{
    const controller=new AbortController();
    const abort=()=>controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(new DOMException('External read timed out','TimeoutError')),12000);
    try {return await fetch(url,{...init,signal:controller.signal});}
    finally {clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
  },init.signal ?? undefined,priority);
}
