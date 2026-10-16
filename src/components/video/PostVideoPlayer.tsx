import {useViewportWidth} from '@/hooks/useViewportWidth';
import { inlineVideoFrame } from "@/lib/mediaThumbnail";
import { useVideoMutedPreference } from "@/lib/hlsPlayback";
import { resolveExternalMp4 } from "@/lib/mediaThumbnail";
import {attachHls} from '@/lib/hlsPlayback';
import {openMediaViewer} from '@/components/media/openMediaViewer';
import type {PostWithAuthor} from '@/types';
import {useEffect,useRef,useState} from 'react';
import {Loader2,Play,Pause,Volume2,VolumeOff,Settings,PictureInPicture2,Maximize2,Minimize2} from 'lucide-react';
import {resolvePostVideo,resolvePostVideoPoster} from '@/lib/postVideoStorage';
import type {PostVideo} from '@/lib/postVideo';
import './post-video.css';
const clock=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60)}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
export function PostVideoPlayer({video,postId,previewUrl,post,externalVideo,embedded=false}:{embedded?:boolean;externalVideo?:import('@/types').ExternalVideo;post?:PostWithAuthor;video:Pick<PostVideo,'duration'|'width'|'height'>;postId?:string;previewUrl?:string}){
 const mobile=useViewportWidth(768);
 const compact=mobile&&!embedded;
 const root=useRef<HTMLDivElement>(null),element=useRef<HTMLVideoElement>(null),timer=useRef<ReturnType<typeof setTimeout>>();
 useEffect(()=>{if(compact){element.current?.pause();if(externalVideo){pending.current?.abort();source.current=undefined;element.current?.removeAttribute('src');element.current?.load();}}},[compact,externalVideo?.playlist]);
 const source=useRef(previewUrl),busy=useRef(false),inside=useRef(false),keyboard=useRef(false);
 const [preferredMuted,saveMuted]=useVideoMutedPreference();
 const [forcedMuted,setForcedMuted]=useState(false);
 const muted=preferredMuted||forcedMuted;
 const setMuted=(value:boolean)=>{setForcedMuted(false);if(element.current)element.current.muted=value;saveMuted(value);};
 useEffect(()=>{setForcedMuted(false);if(element.current)element.current.muted=preferredMuted;},[preferredMuted]);
 const [rate,setRate]=useState(1);
 const [duration,setDuration]=useState(video.duration);
 const [ratio,setRatio]=useState(`${video.width}/${video.height}`);
 const [poster,setPoster]=useState<string>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[playing,setPlaying]=useState(false),[started,setStarted]=useState(false),[time,setTime]=useState(0),[controls,setControls]=useState(true),[settings,setSettings]=useState(false),[full,setFull]=useState(false);
 useEffect(()=>{source.current=previewUrl;busy.current=false;setError('');setStarted(false);setLoading(false);setTime(0);setPlaying(false);setControls(true);setSettings(false);setRate(1);setDuration(video.duration);setRatio(`${video.width}/${video.height}`);setForcedMuted(false);},[previewUrl,postId,video.width,video.height,externalVideo?.playlist]);
 useEffect(()=>{if(externalVideo){setPoster(externalVideo.thumbnail);return;}if(!postId||!root.current)return;let local:string|undefined;const controller=new AbortController();setPoster(undefined);
  const observer=new IntersectionObserver(entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();void resolvePostVideoPoster(postId,controller.signal).then(url=>{if(controller.signal.aborted)URL.revokeObjectURL(url);else{local=url;setPoster(url);}}).catch(()=>{});},{rootMargin:'160px'});observer.observe(root.current);
  return()=>{controller.abort();observer.disconnect();if(local)URL.revokeObjectURL(local);};
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
    if(externalVideo){if(externalVideo.format==='mp4'){const url=await resolveExternalMp4(externalVideo.playlist,controller.signal);if(controller.signal.aborted){URL.revokeObjectURL(url);return;}resolved.current=url;media.src=url;}else await attachHls(media,externalVideo.playlist,controller.signal,message=>{source.current=undefined;setError(message);});if(controller.signal.aborted)return;source.current=externalVideo.playlist;}else{
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
 return <div ref={root} style={{...(!full?inlineVideoFrame(frameWidth,frameHeight,mobile,embedded):{}),...(embedded?{backgroundColor:'black'}:{})}} className="post-video-player mt-3 overflow-hidden rounded-2xl border border-border/60 bg-muted" onClick={e=>e.stopPropagation()} onPointerEnter={()=>{inside.current=true;reveal();}} onPointerMove={reveal} onPointerDown={()=>{keyboard.current=false;}} onPointerLeave={()=>{inside.current=false;clearTimeout(timer.current);setSettings(false);setControls(false);}} onFocusCapture={()=>{if(keyboard.current)reveal();}} onKeyDownCapture={()=>{keyboard.current=true;reveal();}} onKeyDown={e=>{if(e.target!==root.current)return;if(e.key===' '){e.preventDefault();void toggle();}}} tabIndex={0} aria-label="投稿動画">
  <video key={`${postId??'preview'}:${previewUrl??''}`} ref={element} src={previewUrl} poster={externalVideo?undefined:poster} style={{aspectRatio:displayRatio,objectFit:embedded&&started?'contain':'cover'}} onLoadedMetadata={e=>{const media=e.currentTarget;if(Number.isFinite(media.duration))setDuration(media.duration);if(media.videoWidth>0&&media.videoHeight>0)setRatio(`${media.videoWidth}/${media.videoHeight}`);}} playsInline muted={muted} preload="metadata" onClick={()=>void toggle()} onPlay={()=>{setPlaying(true);setStarted(true);reveal();}} onPause={()=>{setPlaying(false);setControls(inside.current||keyboard.current);}} onEnded={()=>{setPlaying(false);setControls(inside.current||keyboard.current);}} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onError={()=>{if(source.current)setError('動画を読み込めませんでした');}}/>
  {externalVideo?.thumbnail&&(compact||!started)&&<img src={externalVideo.thumbnail} alt={externalVideo.alt??'動画のプレビュー'} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onClick={()=>void toggle()}/>}
  {(compact||!started||(!playing&&!controls))&&<button type="button" className="post-video-start" aria-label="動画を再生" onClick={()=>void toggle()}>{loading?<span className="post-video-loading"><Loader2 className="animate-spin"/></span>:<Play fill="currentColor"/>}</button>}
  {(!mobile||embedded)&&duration>0&&(!started||!controls)&&<span className="post-video-duration">{clock(started?duration-time:duration)}</span>}
  {!compact&&started&&playing&&!controls&&<button type="button" className="post-video-mute" aria-label={muted?'音声をオン':'音声をオフ'} onClick={()=>setMuted(!muted)}>{muted?<VolumeOff/>:<Volume2/>}</button>}
  {!compact&&started&&<div className={`post-video-controls ${controls?'is-visible':''}`} aria-hidden={!controls} {...(!controls?{inert:''}:{})}>
   <input className="post-video-seek" type="range" min="0" max={duration} step="0.1" value={Math.min(time,duration)} aria-label="再生位置" onChange={e=>{if(element.current)element.current.currentTime=Number(e.target.value);setTime(Number(e.target.value));reveal();}} style={{'--progress':`${(duration?time/duration*100:0)}%`} as React.CSSProperties}/>
   <div className="post-video-toolbar"><button type="button" aria-label={playing?'一時停止':'再生'} onClick={()=>void toggle()}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><span className="post-video-time">{clock(time)} / {clock(duration)}</span><button type="button" aria-label={muted?'音声をオン':'音声をオフ'} onClick={()=>setMuted(!muted)}>{muted?<VolumeOff/>:<Volume2/>}</button><button type="button" aria-label="再生設定" aria-expanded={settings} onClick={()=>setSettings(!settings)}><Settings/></button>{typeof document!=='undefined'&&document.pictureInPictureEnabled&&<button type="button" aria-label="ピクチャーインピクチャー" onClick={()=>{void element.current?.requestPictureInPicture().catch(()=>setError('この動画では小窓再生を利用できません'));}}><PictureInPicture2/></button>}<button type="button" aria-label={full?'全画面を終了':'全画面表示'} onClick={()=>void fullscreen()}>{full?<Minimize2/>:<Maximize2/>}</button></div>
   {settings&&<div className="post-video-settings"><span>画質 {Math.min(video.width,video.height)}p</span><label>再生速度<select aria-label="再生速度" value={rate} onChange={e=>{setRate(Number(e.target.value));if(element.current)element.current.playbackRate=Number(e.target.value);}}>{[.5,1,1.25,1.5,2].map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></label></div>}
  </div>}
  {error&&<div className="post-video-error" role="alert">{error}<button type="button" onClick={()=>void toggle()}>再試行</button></div>}
 </div>;
}
