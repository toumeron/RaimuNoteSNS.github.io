import {resolveExternalMp4} from '@/lib/externalVideoSource';
import {attachHls} from '@/lib/hlsPlayback';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Loader2,Pause,Play,Volume2,VolumeOff,PictureInPicture2} from 'lucide-react';
import {resolvePostVideo} from '@/lib/postVideoStorage';
import type {MediaViewerSelection} from './openMediaViewer';
const clock=(value:number)=>`${Math.floor(Math.max(0,value)/60)}:${Math.floor(Math.max(0,value)%60).toString().padStart(2,'0')}`;

/** The active slide owns its source, request, and playback; adjacent videos never download. */
export function VideoLightboxPlayer({selection,host,muted,onMutedChange,rate,onRateChange,onSource,zoom=1,pan={x:0,y:0},onTap}:{
 selection:NonNullable<MediaViewerSelection['video']>;host:HTMLElement|null;zoom?:number;pan?:{x:number;y:number};onTap?:(toggle:()=>void)=>void;
 muted:boolean;onMutedChange:(muted:boolean)=>void;rate:number;onRateChange:(rate:number)=>void;onSource:(url:string)=>void;
}){
 const media=useRef<HTMLVideoElement>(null),settings=useRef({muted,rate,onMutedChange,onSource});
 settings.current={muted,rate,onMutedChange,onSource};
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(selection.video.duration);
 useEffect(()=>{
  const element=media.current;if(!element)return;
  const abort=new AbortController();let local:string|undefined;
  setLoading(true);setError('');setTime(0);setPlaying(false);
  void(async()=>{
   try{
    const result=selection.externalVideo?{url:selection.externalVideo.playlist,local:false}:selection.previewUrl?{url:selection.previewUrl,local:false}:await resolvePostVideo(selection.postId!,abort.signal);
    if(abort.signal.aborted){if(result.local)URL.revokeObjectURL(result.url);return;}
    if(result.local)local=result.url;
    if(selection.externalVideo?.format==='mp4'){local=await resolveExternalMp4(result.url,abort.signal);if(abort.signal.aborted)return;element.src=local;}else if(selection.externalVideo)await attachHls(element,result.url,abort.signal,setError);else element.src=result.url;
    if(abort.signal.aborted)return;settings.current.onSource(local??result.url);element.muted=settings.current.muted;element.playbackRate=settings.current.rate;
    try{await element.play();}catch(e){if((e as Error).name!=='NotAllowedError'||element.muted)throw e;element.muted=true;settings.current.onMutedChange(true);await element.play();}
    if(abort.signal.aborted)element.pause();
   }catch(e){if(!abort.signal.aborted)setError((e as Error).message||'動画を再生できませんでした');}
   finally{if(!abort.signal.aborted)setLoading(false);}
  })();
  return()=>{abort.abort();element.pause();element.removeAttribute('src');element.load();if(local)URL.revokeObjectURL(local);};
 },[selection.postId,selection.previewUrl,selection.externalVideo?.playlist,attempt]);
 useEffect(()=>{if(media.current)media.current.muted=muted;},[muted]);
 useEffect(()=>{if(media.current)media.current.playbackRate=rate;},[rate]);
 const toggle=()=>{const element=media.current;if(!element||loading)return;if(element.paused)void element.play().catch(()=>setError('再生できませんでした'));else element.pause();};
 const transport=<div className="lime-video-transport">
  <input aria-label="動画の再生位置" type="range" min="0" max={duration} step="0.1" value={Math.min(time,duration)} onChange={e=>{const next=Number(e.target.value);if(media.current)media.current.currentTime=next;setTime(next);}} style={{'--progress':`${duration?time/duration*100:0}%`} as React.CSSProperties}/>
  <div className="lime-video-transport-row">
   <button aria-label={playing?'動画を一時停止':'動画を再生'} onClick={toggle}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button>
   <span className="lime-video-remaining">-{clock(duration-time)}</span>
   <button className="lime-video-rate" aria-label="再生速度" onClick={()=>{const rates=[1,1.5,2,.5];onRateChange(rates[(rates.indexOf(rate)+1)%rates.length]);}}>{rate}x</button>
   <button aria-label={muted?'動画の音声をオン':'動画の音声をオフ'} onClick={()=>onMutedChange(!muted)}>{muted?<VolumeOff/>:<Volume2/>}</button>
   {document.pictureInPictureEnabled&&<button aria-label="動画を小窓で再生" onClick={()=>{void media.current?.requestPictureInPicture().catch(()=>setError('小窓再生を利用できません'));}}><PictureInPicture2/></button>}
  </div>
 </div>;
 return <>
  <video ref={media} poster={selection.externalVideo?.thumbnail} playsInline loop muted={muted} preload="metadata" style={{transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}} onClick={()=>onTap?onTap(toggle):toggle()} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={event=>setTime(event.currentTarget.currentTime)} onLoadedMetadata={event=>{if(Number.isFinite(event.currentTarget.duration))setDuration(event.currentTarget.duration);}} onError={()=>{if(media.current?.getAttribute('src'))setError('動画を読み込めませんでした');}}/>
  {loading&&<span className="lime-video-loading" role="status" aria-label="動画を読み込み中"><Loader2 className="animate-spin"/></span>}
  {!playing&&!loading&&!error&&<button className="lime-video-overlay-play" aria-label="動画を再生" onClick={toggle}><Play fill="currentColor"/></button>}
  {error&&<div className="lime-video-error" role="alert">{error}<button onClick={()=>setAttempt(value=>value+1)}>再試行</button></div>}
  {host&&createPortal(transport,host)}
 </>;
}
