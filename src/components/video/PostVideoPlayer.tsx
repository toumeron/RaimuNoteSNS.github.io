import { useViewportWidth, observeElementVisibility } from "@/hooks/useViewportWidth";
import { initialMediaSize, inlineVideoFrame, type PostVideo } from "@/lib/mediaThumbnail";
import { openMediaViewer, type MediaViewerSelection } from "@/lib/mediaThumbnail";
import { type PostWithAuthor } from "@/types/index";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Play, Pause, Volume2, VolumeOff, Settings, PictureInPicture2, Maximize2, Minimize2 } from "lucide-react";
import { resolvePostVideo, resolvePostVideoPoster } from "@/lib/mediaThumbnail";

import { createPortal } from "react-dom";
import {pwaHlsBuffers} from "@/lib/utils";

// hlsPlayback
/** Attach an HLS stream only when playback is requested; abort releases buffers and requests. */
async function attachHls(media: HTMLVideoElement, url: string, signal: AbortSignal, onError: (message: string) => void, forceEngine=false) {
 const check = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
 check();
 // Safari's native pipeline avoids an extra JS decoder/buffer and supports OS playback controls.
 if(!forceEngine&&media.canPlayType('application/vnd.apple.mpegurl')){media.src=url;return;}
 const {default: Hls, FetchLoader} = await import('hls.js');
 check();
 if (!Hls.isSupported()) {
  if (!forceEngine&&media.canPlayType('application/vnd.apple.mpegurl')) { media.src = url; return; }
  throw new Error('このブラウザーでは動画を再生できません');
 }
 const hls = new Hls({maxBufferLength: 20, maxMaxBufferLength: 30,...pwaHlsBuffers(), loader: FetchLoader, fetchSetup: (context, init) => new Request(context.url, {...init, referrerPolicy:'no-referrer'})});
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

type PlaybackMetadata={title?:string;artist?:string;artwork?:string};
let activePlayback:HTMLMediaElement|null=null;
let restoreAudioSession:(()=>void)|undefined;
/** Keep audible MP4/HLS playback registered with the OS; never pause on page visibility changes. */
export function bindBackgroundPlayback(media:HTMLMediaElement,metadata:PlaybackMetadata={}){
 const session=navigator.mediaSession;
 const position=()=>{
  if(activePlayback!==media||!session||!Number.isFinite(media.duration)||media.duration<=0)return;
  try{session.setPositionState?.({duration:media.duration,playbackRate:media.playbackRate,position:Math.max(0,Math.min(media.currentTime,media.duration))});}catch{/* Older Safari may omit seeking support. */}
 };
 const restore=()=>{restoreAudioSession?.();restoreAudioSession=undefined;};
 const claim=()=>{
  if(media.muted||media.volume===0||media.paused)return;
  if(activePlayback!==media){
   const previous=activePlayback;activePlayback=media;previous?.pause();restore();
  }
  if(!restoreAudioSession){
   const audio=(navigator as Navigator&{audioSession?:{type:string}}).audioSession;
   if(audio&&audio.type!=='play-and-record'){
    const previousType=audio.type;
    try{audio.type='playback';restoreAudioSession=()=>{if(audio.type==='playback')audio.type=previousType;};}catch{/* Optional Audio Session API. */}
   }
  }
  if(!session)return;
  try{
   if(typeof MediaMetadata!=='undefined')session.metadata=new MediaMetadata({title:metadata.title||'LimeNoteの動画',artist:metadata.artist||'LimeNote',...(metadata.artwork?{artwork:[{src:metadata.artwork}]}:{})});
   session.playbackState='playing';
   const actions:Partial<Record<MediaSessionAction,MediaSessionActionHandler>>={play:()=>{void media.play().catch(()=>{});},pause:()=>media.pause(),stop:()=>{media.pause();media.currentTime=0;},seekbackward:detail=>{media.currentTime=Math.max(0,media.currentTime-(detail.seekOffset??10));position();},seekforward:detail=>{media.currentTime=Math.min(Number.isFinite(media.duration)?media.duration:Infinity,media.currentTime+(detail.seekOffset??10));position();},seekto:detail=>{if(detail.seekTime!==undefined){media.currentTime=Math.max(0,Math.min(Number.isFinite(media.duration)?media.duration:Infinity,detail.seekTime));position();}}};
   for(const [action,handler]of Object.entries(actions))try{session.setActionHandler(action as MediaSessionAction,handler!);}catch{/* Not every control is exposed on every OS. */}
   position();
  }catch{/* Playback itself must work even without system controls. */}
 };
 const paused=()=>{if(activePlayback===media){if(session)session.playbackState='paused';restore();}};
 const volume=()=>{if(media.muted||media.volume===0)paused();else claim();};
 media.addEventListener('play',claim);media.addEventListener('pause',paused);media.addEventListener('ended',paused);media.addEventListener('volumechange',volume);media.addEventListener('seeked',position);media.addEventListener('ratechange',position);
 claim();
 return()=>{
  media.removeEventListener('play',claim);media.removeEventListener('pause',paused);media.removeEventListener('ended',paused);media.removeEventListener('volumechange',volume);media.removeEventListener('seeked',position);media.removeEventListener('ratechange',position);
  if(activePlayback===media){activePlayback=null;restore();if(session){session.playbackState='none';session.metadata=null;for(const action of ['play','pause','stop','seekbackward','seekforward','seekto']as MediaSessionAction[])try{session.setActionHandler(action,null);}catch{}}}
 };
}
export function supportsVideoPip(media:HTMLVideoElement|null){
 const video=media as (HTMLVideoElement&{webkitSupportsPresentationMode?:(mode:string)=>boolean})|null;
 return !!document.pictureInPictureEnabled||!!video?.webkitSupportsPresentationMode?.('picture-in-picture');
}
export async function requestVideoPip(media:HTMLVideoElement|null){
 if(!media)return;
 if(document.pictureInPictureEnabled&&media.requestPictureInPicture){await media.requestPictureInPicture();return;}
 const native=media as HTMLVideoElement&{webkitSetPresentationMode?:(mode:string)=>void};
 if(native.webkitSetPresentationMode){native.webkitSetPresentationMode('picture-in-picture');return;}
 throw new Error('小窓再生を利用できません');
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

// PostVideoPlayer
const clock=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60)}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
function PostVideoPlayer({video,postId,previewUrl,post,externalVideo,embedded=false}:{embedded?:boolean;externalVideo?:import('@/types').ExternalVideo;post?:PostWithAuthor;video:Pick<PostVideo,'duration'|'width'|'height'>;postId?:string;previewUrl?:string}){
 const mobile=useViewportWidth(768);
 const compact=mobile&&!embedded;
 const root=useRef<HTMLDivElement>(null),element=useRef<HTMLVideoElement>(null),timer=useRef<ReturnType<typeof setTimeout>>();
 useEffect(()=>{if(compact){element.current?.pause();if(externalVideo){pending.current?.abort();source.current=undefined;element.current?.removeAttribute('src');element.current?.load();}}},[compact,externalVideo?.playlist]);
 useEffect(()=>{const media=element.current;if(media)return bindBackgroundPlayback(media,{title:post?.content.slice(0,100),artist:post?.author.displayName,artwork:externalVideo?.thumbnail});},[postId,previewUrl,externalVideo?.playlist]);
 const source=useRef(previewUrl),busy=useRef(false),inside=useRef(false),keyboard=useRef(false);
 const [preferredMuted,saveMuted]=useVideoMutedPreference();
 const [forcedMuted,setForcedMuted]=useState(false);
 const muted=preferredMuted||forcedMuted;
 const setMuted=(value:boolean)=>{setForcedMuted(false);if(element.current)element.current.muted=value;saveMuted(value);};
 useEffect(()=>{setForcedMuted(false);if(element.current)element.current.muted=preferredMuted;},[preferredMuted]);
 const [rate,setRate]=useState(1);
 const [duration,setDuration]=useState(video.duration);
 const frame=initialMediaSize(video);
 const ratio=`${frame.width}/${frame.height}`;
 const [poster,setPoster]=useState<string>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[playing,setPlaying]=useState(false),[started,setStarted]=useState(false),[time,setTime]=useState(0),[controls,setControls]=useState(true),[settings,setSettings]=useState(false),[full,setFull]=useState(false);
 useEffect(()=>{source.current=previewUrl;busy.current=false;setError('');setStarted(false);setLoading(false);setTime(0);setPlaying(false);setControls(true);setSettings(false);setRate(1);setDuration(video.duration);setForcedMuted(false);},[previewUrl,postId,video.width,video.height,externalVideo?.playlist]);
 useEffect(()=>{if(externalVideo){setPoster(externalVideo.thumbnail);return;}if(!postId||!root.current)return;let local:string|undefined;const controller=new AbortController();setPoster(undefined);
  let stop=()=>{};stop=observeElementVisibility(root.current,visible=>{if(!visible)return;stop();void resolvePostVideoPoster(postId,controller.signal).then(url=>{if(controller.signal.aborted)URL.revokeObjectURL(url);else{local=url;setPoster(url);}}).catch(()=>{});},'160px');
  return()=>{controller.abort();stop();if(local)URL.revokeObjectURL(local);};
 },[postId,externalVideo?.playlist,externalVideo?.thumbnail]);
 useEffect(()=>{if(settings)clearTimeout(timer.current);},[settings]);
 const resolved=useRef<string>();const pending=useRef<AbortController>();
 useEffect(()=>()=>{pending.current?.abort();if(resolved.current)URL.revokeObjectURL(resolved.current);clearTimeout(timer.current);},[postId,previewUrl,externalVideo?.playlist]);
 useEffect(()=>{const change=()=>setFull(document.fullscreenElement===root.current);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change);},[]);
 const reveal=()=>{setControls(true);clearTimeout(timer.current);if(settings)return;timer.current=setTimeout(()=>{if(element.current&&!element.current.paused&&!(keyboard.current&&root.current?.contains(document.activeElement))){setControls(false);setSettings(false);}},2500);};
 const toggle=async()=>{
  if(compact){element.current?.pause();openMediaViewer({url:previewUrl??`video:${postId}`,post,postId,video:{video,postId,previewUrl,externalVideo}});return;}
  if(busy.current)return;
  const media=element.current;if(!media)return;
  busy.current=true;setError('');reveal();
  let controller:AbortController|undefined;
  try{
   if(!source.current&&postId){
    setLoading(true);controller=new AbortController();pending.current=controller;
    if(externalVideo){if(externalVideo.format==='mp4'){media.src=externalVideo.playlist;}else await attachHls(media,externalVideo.playlist,controller.signal,message=>{source.current=undefined;setError(message);});if(controller.signal.aborted)return;source.current=externalVideo.playlist;}else{
    const result=await resolvePostVideo(postId,controller.signal);
    if(controller.signal.aborted||element.current!==media){if(result.local)URL.revokeObjectURL(result.url);return;}
    if(result.local)resolved.current=result.url;
    source.current=result.url;
    // Assign once: a React src update here reloads the video and aborts the first play().
    media.src=result.url;
    }
   }
   if(media.paused){
    try{await media.play();}
    catch(error){
     // A long private download can outlive the browser's sound activation window.
     if((error as Error).name!=='NotAllowedError'||media.muted)throw error;
     media.muted=true;setForcedMuted(true);await media.play();
    }
   }else media.pause();
  }catch(e){if((e as Error).name!=='AbortError'&&element.current===media)setError((e as Error).message||'動画を再生できませんでした');}
  finally{if(element.current===media){busy.current=false;setLoading(false);}}
 };
 const fullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.current?.requestFullscreen)await root.current.requestFullscreen();else (element.current as HTMLVideoElement&{webkitEnterFullscreen?:()=>void})?.webkitEnterFullscreen?.();}catch{setError('全画面表示を利用できません');}};
 const [frameWidth,frameHeight]=ratio.split('/').map(Number);
 const displayRatio=embedded&&!full&&frameHeight>frameWidth?'16/9':ratio;
 return <div ref={root} style={{...(!full?inlineVideoFrame(frameWidth,frameHeight,mobile,embedded):{}),aspectRatio:displayRatio}} className="post-video-player mt-3 overflow-hidden rounded-2xl border border-border/60 bg-background" onClick={e=>e.stopPropagation()} onPointerEnter={()=>{inside.current=true;reveal();}} onPointerMove={reveal} onPointerDown={()=>{keyboard.current=false;}} onPointerLeave={()=>{inside.current=false;clearTimeout(timer.current);setSettings(false);setControls(false);}} onFocusCapture={()=>{if(keyboard.current)reveal();}} onKeyDownCapture={()=>{keyboard.current=true;reveal();}} onKeyDown={e=>{if(e.target!==root.current)return;if(e.key===' '){e.preventDefault();void toggle();}}} tabIndex={0} aria-label="投稿動画">
  <video key={`${postId??'preview'}:${previewUrl??''}`} ref={element} src={previewUrl} poster={externalVideo?undefined:poster} style={{aspectRatio:displayRatio,position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain'}} onLoadedMetadata={e=>{const media=e.currentTarget;if(Number.isFinite(media.duration))setDuration(media.duration);}} playsInline muted={muted} preload="metadata" onClick={()=>void toggle()} onPlay={()=>{setPlaying(true);setStarted(true);reveal();}} onPause={()=>{setPlaying(false);setControls(inside.current||keyboard.current);}} onEnded={()=>{setPlaying(false);setControls(inside.current||keyboard.current);}} onTimeUpdate={e=>{if(!document.hidden){const time=e.currentTarget.currentTime;setTime(previous=>Math.abs(previous-time)>=.25?time:previous);}}} onError={()=>{if(source.current)setError('動画を読み込めませんでした');}}/>
  {externalVideo?.thumbnail&&(compact||!started)&&<img key={externalVideo.thumbnail} style={{opacity:0}} onLoad={event=>{event.currentTarget.style.opacity='1';}} src={externalVideo.thumbnail} alt={externalVideo.alt??'動画のプレビュー'} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onClick={()=>void toggle()}/>}
  {(compact||!started||(!playing&&!controls))&&<button type="button" className="post-video-start" aria-label="動画を再生" onClick={()=>void toggle()}>{loading?<span className="post-video-loading"><Loader2 className="animate-spin"/></span>:<Play fill="currentColor"/>}</button>}
  {(!mobile||embedded)&&duration>0&&(!started||!controls)&&<span className="post-video-duration">{clock(started?duration-time:duration)}</span>}
  {!compact&&started&&playing&&!controls&&<button type="button" className="post-video-mute" aria-label={muted?'音声をオン':'音声をオフ'} onClick={()=>setMuted(!muted)}>{muted?<VolumeOff/>:<Volume2/>}</button>}
  {!compact&&started&&<div className={`post-video-controls ${controls?'is-visible':''}`} aria-hidden={!controls} {...(!controls?{inert:''}:{})}>
   <input className="post-video-seek" type="range" min="0" max={duration} step="0.1" value={Math.min(time,duration)} aria-label="再生位置" onChange={e=>{if(element.current)element.current.currentTime=Number(e.target.value);setTime(Number(e.target.value));reveal();}} style={{'--progress':`${(duration?time/duration*100:0)}%`} as React.CSSProperties}/>
   <div className="post-video-toolbar"><button type="button" aria-label={playing?'一時停止':'再生'} onClick={()=>void toggle()}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><span className="post-video-time">{clock(time)} / {clock(duration)}</span><button type="button" aria-label={muted?'音声をオン':'音声をオフ'} onClick={()=>setMuted(!muted)}>{muted?<VolumeOff/>:<Volume2/>}</button><button type="button" aria-label="再生設定" aria-expanded={settings} onClick={()=>setSettings(!settings)}><Settings/></button>{supportsVideoPip(element.current)&&<button type="button" aria-label="ピクチャーインピクチャー" onClick={()=>{void requestVideoPip(element.current).catch(()=>setError('この動画では小窓再生を利用できません'));}}><PictureInPicture2/></button>}<button type="button" aria-label={full?'全画面を終了':'全画面表示'} onClick={()=>void fullscreen()}>{full?<Minimize2/>:<Maximize2/>}</button></div>
   {settings&&<div className="post-video-settings"><span>画質 {Math.min(video.width,video.height)}p</span><label>再生速度<select aria-label="再生速度" value={rate} onChange={e=>{setRate(Number(e.target.value));if(element.current)element.current.playbackRate=Number(e.target.value);}}>{[.5,1,1.25,1.5,2].map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></label></div>}
  </div>}
  {error&&<div className="post-video-error" role="alert">{error}<button type="button" onClick={()=>void toggle()}>再試行</button></div>}
 </div>;
}

// PostVideoThumbnail
function PostVideoThumbnail({postId,duration,thumbnail,external}:{postId:string;duration:number;thumbnail?:string;external?:boolean}){
 const element=useRef<HTMLDivElement>(null),[url,setUrl]=useState<string>();
 useEffect(()=>{if(external){setUrl(thumbnail);return;}let local:string|undefined;const abort=new AbortController();setUrl(undefined);const target=element.current;let stop=()=>{};if(target)stop=observeElementVisibility(target,visible=>{if(!visible)return;stop();void resolvePostVideoPoster(postId,abort.signal).then(url=>{if(abort.signal.aborted)URL.revokeObjectURL(url);else{local=url;setUrl(url);}}).catch(()=>{});},'160px');return()=>{abort.abort();stop();if(local)URL.revokeObjectURL(local);};},[postId,thumbnail,external]);
 return <div ref={element} className="relative h-full w-full bg-black">{url&&<img referrerPolicy="no-referrer" src={url} loading="lazy" decoding="async" alt="動画のプレビュー" className="h-full w-full object-cover"/>}{duration>0&&<span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-1 text-sm leading-none text-white tabular-nums">{Math.floor(Math.max(0,duration)/60)}:{Math.floor(Math.max(0,duration)%60).toString().padStart(2,'0')}</span>}</div>;
}

// VideoLightboxPlayer
const VideoLightboxPlayerClock=(value:number)=>`${Math.floor(Math.max(0,value)/60)}:${Math.floor(Math.max(0,value)%60).toString().padStart(2,'0')}`;

/** Keep the active video and one paused next video ready; each owns and releases its source. */
function VideoLightboxPlayer({selection,host,muted,onMutedChange,rate,onRateChange,onSource,suspended=false,zoom=1,pan={x:0,y:0},onTap}:{
 suspended?:boolean;selection:NonNullable<MediaViewerSelection['video']>;host:HTMLElement|null;zoom?:number;pan?:{x:number;y:number};onTap?:(toggle:()=>void)=>void;
 muted:boolean;onMutedChange:(muted:boolean)=>void;rate:number;onRateChange:(rate:number)=>void;onSource:(url:string)=>void;
}){
 const media=useRef<HTMLVideoElement>(null),settings=useRef({muted,rate,onMutedChange,onSource,suspended});
 settings.current={muted,rate,onMutedChange,onSource,suspended};
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(selection.video.duration);
 useEffect(()=>{const element=media.current;if(element)return bindBackgroundPlayback(element);},[selection.postId,selection.previewUrl,selection.externalVideo?.playlist]);
 const [soundBlocked,setSoundBlocked]=useState(false);
 const [fallbackSource,setFallbackSource]=useState<string|null>(null),[engineSource,setEngineSource]=useState<string|null>(null);
 const external=selection.externalVideo;
 const usingFallback=!!external&&fallbackSource===external.playlist;
 const playbackSource=usingFallback?external.fallback:external;
 const forceEngine=!!playbackSource&&engineSource===playbackSource.playlist;
 const playbackFailed=(cause?:unknown)=>{
  if((cause as Error|undefined)?.name==='AbortError')return;
  if(external?.fallback&&!usingFallback){setFallbackSource(external.playlist);return;}
  if(playbackSource&&playbackSource.format!=='mp4'&&!/\.mp4(?:[?#]|$)/i.test(playbackSource.playlist)&&!forceEngine&&media.current?.canPlayType('application/vnd.apple.mpegurl')){setEngineSource(playbackSource.playlist);return;}
  setError('動画を読み込めませんでした。別の動画へスワイプするか、再試行してください');
 };
 const sourceReady=useRef(false),resolvedPlaybackSource=useRef(''),sourceAbort=useRef<AbortController|null>(null);
 const playbackFailedRef=useRef(playbackFailed);playbackFailedRef.current=playbackFailed;
 const actualMuted=muted||soundBlocked;
 const startPlayback=async(element:HTMLVideoElement)=>{
  const signal=sourceAbort.current?.signal;
  try{await element.play();}
  catch(error){
   if(signal?.aborted||settings.current.suspended||media.current!==element)return;
   if((error as Error).name!=='NotAllowedError'||element.muted)throw error;
   element.muted=true;setSoundBlocked(true);await element.play();
  }
 };
 useEffect(()=>{
  const element=media.current;if(!element)return;
  const abort=new AbortController();sourceAbort.current=abort;let local:string|undefined;
  sourceReady.current=false;
  setLoading(true);setError('');setTime(0);setPlaying(false);setSoundBlocked(false);
  void(async()=>{
   try{
    const result=playbackSource?{url:playbackSource.playlist,local:false}:selection.previewUrl?{url:selection.previewUrl,local:false}:await resolvePostVideo(selection.postId!,abort.signal);
    if(abort.signal.aborted){if(result.local)URL.revokeObjectURL(result.url);return;}
    if(result.local)local=result.url;
    if(playbackSource?.format==='mp4'||/\.mp4(?:[?#]|$)/i.test(result.url)){element.src=result.url;}else if(playbackSource)await attachHls(element,result.url,abort.signal,()=>{if(!abort.signal.aborted)playbackFailedRef.current();},forceEngine);else element.src=result.url;
    if(abort.signal.aborted)return;sourceReady.current=true;resolvedPlaybackSource.current=local??result.url;if(!settings.current.suspended)settings.current.onSource(resolvedPlaybackSource.current);element.muted=settings.current.muted;element.playbackRate=settings.current.rate;
    if(!settings.current.suspended)await startPlayback(element);
    if(abort.signal.aborted||settings.current.suspended)element.pause();
   }catch(e){if(!abort.signal.aborted)playbackFailedRef.current(e);}
   finally{if(!abort.signal.aborted)setLoading(false);}
  })();
  return()=>{abort.abort();element.pause();element.removeAttribute('src');element.load();if(local)URL.revokeObjectURL(local);};
 },[selection.postId,selection.previewUrl,selection.externalVideo?.playlist,usingFallback,forceEngine,attempt]);
 useEffect(()=>{setSoundBlocked(false);if(media.current)media.current.muted=muted;},[muted]);
 useEffect(()=>{if(media.current)media.current.playbackRate=rate;},[rate]);
 useEffect(()=>{const element=media.current;if(!element)return;if(suspended)element.pause();else if(sourceReady.current&&!loading&&!error){settings.current.onSource(resolvedPlaybackSource.current);if(element.paused){const signal=sourceAbort.current?.signal;void startPlayback(element).catch(error=>{if(!signal?.aborted)playbackFailedRef.current(error);});}}},[suspended,loading,error]);
 const toggle=()=>{const element=media.current;if(!element||loading||suspended)return;if(element.paused)void element.play().catch(e=>{if((e as Error).name!=='AbortError'&&media.current===element)setError('再生できませんでした');});else element.pause();};
 const transport=<div className="lime-video-transport">
  <input aria-label="動画の再生位置" type="range" min="0" max={duration} step="0.1" value={Math.min(time,duration)} onChange={e=>{const next=Number(e.target.value);if(media.current)media.current.currentTime=next;setTime(next);}} style={{'--progress':`${duration?time/duration*100:0}%`} as React.CSSProperties}/>
  <div className="lime-video-transport-row">
   <button aria-label={playing?'動画を一時停止':'動画を再生'} onClick={toggle}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button>
   <span className="lime-video-remaining">-{VideoLightboxPlayerClock(duration-time)}</span>
   <button className="lime-video-rate" aria-label="再生速度" onClick={()=>{const rates=[1,1.5,2,.5];onRateChange(rates[(rates.indexOf(rate)+1)%rates.length]);}}>{rate}x</button>
   <button aria-label={actualMuted?'動画の音声をオン':'動画の音声をオフ'} onClick={()=>{setSoundBlocked(false);if(media.current)media.current.muted=!actualMuted;onMutedChange(!actualMuted);}}>{actualMuted?<VolumeOff/>:<Volume2/>}</button>
   {supportsVideoPip(media.current)&&<button aria-label="動画を小窓で再生" onClick={()=>{void requestVideoPip(media.current).catch(()=>setError('小窓再生を利用できません'));}}><PictureInPicture2/></button>}
  </div>
 </div>;
 return <>
  <video ref={media} poster={selection.externalVideo?.thumbnail} playsInline loop muted={actualMuted} preload="auto" style={{transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}} onClick={()=>onTap?onTap(toggle):toggle()} onPlay={()=>{setPlaying(true);setError('');}} onPause={()=>setPlaying(false)} onTimeUpdate={event=>{if(!document.hidden){const time=event.currentTarget.currentTime;setTime(previous=>Math.abs(previous-time)>=.25?time:previous);}}} onLoadedMetadata={event=>{if(Number.isFinite(event.currentTarget.duration))setDuration(event.currentTarget.duration);}} onError={()=>{if(media.current?.getAttribute('src'))playbackFailed();}}/>
  {loading&&<span className="lime-video-loading" role="status" aria-label="動画を読み込み中"><Loader2 className="animate-spin"/></span>}
  {!playing&&!loading&&!error&&<button className="lime-video-overlay-play" aria-label="動画を再生" onClick={toggle}><Play fill="currentColor"/></button>}
  {error&&<div className="lime-video-error" role="alert">{error}<button onClick={()=>{setFallbackSource(null);setEngineSource(null);setAttempt(value=>value+1);}}>再試行</button></div>}
  {host&&createPortal(transport,host)}
 </>;
}

export { PostVideoPlayer };
export { PostVideoThumbnail };
export { VideoLightboxPlayer };
export { attachHls };
export { readVideoMuted };
export { setVideoMuted };
export { useVideoMutedPreference };
