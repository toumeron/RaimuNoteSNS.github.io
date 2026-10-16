import { useSyncExternalStore } from "react";

// hlsPlayback
/** Attach an HLS stream only when playback is requested; abort releases buffers and requests. */
async function attachHls(media: HTMLVideoElement, url: string, signal: AbortSignal, onError: (message: string) => void) {
 const check = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
 check();
 const {default: Hls, FetchLoader} = await import('hls.js');
 check();
 if (!Hls.isSupported()) {
  if (media.canPlayType('application/vnd.apple.mpegurl')) { media.src = url; return; }
  throw new Error('このブラウザーでは動画を再生できません');
 }
 const hls = new Hls({maxBufferLength: 20, maxMaxBufferLength: 30, loader: FetchLoader, fetchSetup: (context, init) => new Request(context.url, {...init, referrerPolicy:'no-referrer'})});
 const destroy = () => hls.destroy();
 signal.addEventListener('abort', destroy, {once:true});
 await new Promise<void>((resolve,reject) => {
  const abort = () => reject(new DOMException('Aborted','AbortError'));
  const finish = () => { signal.removeEventListener('abort',abort); resolve(); };
  signal.addEventListener('abort',abort,{once:true});
  hls.on(Hls.Events.MANIFEST_PARSED,finish);
  hls.on(Hls.Events.ERROR,(_event,data) => {
   if (!data.fatal || signal.aborted) return;
   signal.removeEventListener('abort',abort);
   destroy();
   const message='動画を読み込めませんでした'; onError(message); reject(new Error(message));
  });
  hls.attachMedia(media);
  hls.loadSource(url);
 });
}

// videoSoundPreference
const key='lime-video-muted';
const event='lime:video-sound-change';
let fallback=true;
function readVideoMuted():boolean{
 try{const value=localStorage.getItem(key);return value===null?true:value!=='false';}catch{return fallback;}
}
function setVideoMuted(muted:boolean):void{
 fallback=muted;
 try{localStorage.setItem(key,String(muted));}catch{/* Retain the choice in this session if storage is disabled. */}
 if(typeof window!=='undefined')window.dispatchEvent(new Event(event));
}
function subscribe(change:()=>void){
 const storage=(e:StorageEvent)=>{if(e.key===key||e.key===null)change();};
 window.addEventListener(event,change);window.addEventListener('storage',storage);
 return()=>{window.removeEventListener(event,change);window.removeEventListener('storage',storage);};
}
function useVideoMutedPreference(){
 return [useSyncExternalStore(subscribe,readVideoMuted,()=>true),setVideoMuted] as const;
}

export { attachHls };
export { readVideoMuted };
export { setVideoMuted };
export { useVideoMutedPreference };
