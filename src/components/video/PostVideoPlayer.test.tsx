vi.mock("@/lib/mediaThumbnail", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/mediaThumbnail")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/lib/mediaThumbnail")>(), resolvePostVideo:(...args:unknown[])=>mocks.resolve(...args), resolvePostVideoPoster:(...args:unknown[])=>mocks.poster(...args)}))(importOriginal)};
});


import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn(),poster:vi.fn()}));

import {PostVideoPlayer} from './PostVideoPlayer';
let running=false;
beforeEach(()=>{localStorage.clear();running=false;vi.clearAllMocks();vi.stubGlobal('IntersectionObserver',class{observe(){}unobserve(){}disconnect(){}});vi.spyOn(HTMLMediaElement.prototype,'paused','get').mockImplementation(()=>!running);vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(async function(this:HTMLMediaElement){await Promise.resolve();running=true;this.dispatchEvent(new Event('play'));});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){running=false;this.dispatchEvent(new Event('pause'));});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('starts a delayed remote video with one click and never reloads its resolved source on React commit',async()=>{
 let finish!:(value:{url:string;local:boolean})=>void;mocks.resolve.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<PostVideoPlayer postId="post" video={{duration:16,width:1920,height:1080}}/>);const media=view.container.querySelector('video')!;const changes:MutationRecord[]=[];const observer=new MutationObserver(records=>changes.push(...records));observer.observe(media,{attributes:true,attributeFilter:['src']});
 fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));expect(mocks.resolve).toHaveBeenCalledTimes(1);
 finish({url:'https://video.example/media/post',local:false});await waitFor(()=>expect(screen.getByRole('button',{name:'一時停止'})).toBeInTheDocument());
 expect(media.play).toHaveBeenCalledTimes(1);expect(media.paused).toBe(false);expect(changes).toHaveLength(1);expect(media.getAttribute('src')).toBe('https://video.example/media/post');observer.disconnect();
 fireEvent.click(screen.getByRole('button',{name:'一時停止'}));expect(media.pause).toHaveBeenCalledTimes(1);
});
it('starts a preview once and reports the actual quality in settings',async()=>{
 render(<PostVideoPlayer previewUrl="blob:preview" video={{duration:16,width:1080,height:1920}}/>);fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));await waitFor(()=>expect(screen.getByRole('button',{name:'一時停止'})).toBeInTheDocument());expect(mocks.resolve).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'再生設定'}));expect(screen.getByText('画質 1080p')).toBeInTheDocument();
});
it('still starts on the first click when the browser rejects sound after a slow download',async()=>{
 mocks.resolve.mockResolvedValue({url:'https://video.example/media/private',local:false});
 const view=render(<PostVideoPlayer postId="private" video={{duration:16,width:1920,height:1080}}/>);
 const media=view.container.querySelector('video')!;media.muted=false;vi.mocked(media.play).mockRejectedValueOnce(new DOMException('User activation expired','NotAllowedError'));
 fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));await waitFor(()=>expect(screen.getByRole('button',{name:'一時停止'})).toBeInTheDocument());expect(mocks.resolve).toHaveBeenCalledTimes(1);expect(media.muted).toBe(true);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('hides focused controls on pointer leave and shows only remaining time and sound while playing',async()=>{
 const view=render(<PostVideoPlayer previewUrl="blob:preview" video={{duration:16,width:1920,height:1080}}/>);
 const root=screen.getByLabelText('投稿動画'),media=view.container.querySelector('video')!;
 expect(screen.queryByRole('button',{name:'音声をオン'})).not.toBeInTheDocument();
 fireEvent.pointerEnter(root);fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));
 await screen.findByRole('button',{name:'一時停止'});
 const sound=screen.getByRole('button',{name:'音声をオン'});sound.focus();fireEvent.click(sound);
 media.currentTime=5;fireEvent.timeUpdate(media);fireEvent.pointerLeave(root);
 expect(screen.queryByRole('slider')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'一時停止'})).not.toBeInTheDocument();
 expect(screen.getByText('0:11')).toBeInTheDocument();expect(screen.getByRole('button',{name:'音声をオフ'})).toHaveClass('post-video-mute');
 fireEvent.pointerEnter(root);expect(screen.getByRole('slider')).toBeInTheDocument();expect(screen.queryByText('0:11')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'一時停止'}));fireEvent.pointerLeave(root);
 expect(screen.getByRole('button',{name:'動画を再生'})).toBeInTheDocument();expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});
it('keeps the initial frame when decoded video metadata has a different aspect ratio',()=>{
 const view=render(<PostVideoPlayer previewUrl="blob:portrait" video={{duration:16,width:1920,height:1080}}/>);
 const media=view.container.querySelector('video')!;
 Object.defineProperties(media,{videoWidth:{value:1080},videoHeight:{value:1920}});
 fireEvent.loadedMetadata(media);
 expect(media.style.aspectRatio).toBe('1920/1080');
 expect(screen.getByLabelText('投稿動画').style.aspectRatio).toBe('1920/1080');
});
it('opens the shared viewer on mobile without inline playback or controls',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(window,'innerWidth')!;
 Object.defineProperty(window,'innerWidth',{value:390,configurable:true});
 const opened=vi.fn();window.addEventListener('lime-open-media-viewer',opened);
 try{
  render(<PostVideoPlayer postId="mobile-post" video={{duration:16,width:1920,height:1080}}/>);
  fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));
  expect(mocks.resolve).not.toHaveBeenCalled();expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();expect(screen.queryByText('0:16')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'音声をオン'})).not.toBeInTheDocument();
  expect(opened).toHaveBeenCalledTimes(1);expect(opened.mock.calls[0][0].detail.video.postId).toBe('mobile-post');
 }finally{Object.defineProperty(window,'innerWidth',descriptor);window.removeEventListener('lime-open-media-viewer',opened);}
});
it('plays an external native-HLS video with one click and never requests Lime storage',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
 const externalVideo={playlist:'https://video.bsky.app/playlist.m3u8',thumbnail:'https://video.bsky.app/thumb.jpg',duration:0,width:1080,height:1920};
 const view=render(<PostVideoPlayer postId="bsky:at://video" video={externalVideo} externalVideo={externalVideo}/>);
 const media=view.container.querySelector('video')!;expect(screen.getByAltText('動画のプレビュー')).toHaveAttribute('src',externalVideo.thumbnail);expect(media.getAttribute('src')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));await screen.findByRole('button',{name:'一時停止'});
 expect(media.getAttribute('src')).toBe(externalVideo.playlist);expect(mocks.resolve).not.toHaveBeenCalled();expect(mocks.poster).not.toHaveBeenCalled();
 Object.defineProperty(media,'duration',{value:138});fireEvent.loadedMetadata(media);expect(screen.getByText('0:00 / 2:18')).toBeInTheDocument();
});

it('reserves portrait dimensions before metadata arrives',()=>{
 const view=render(<PostVideoPlayer previewUrl="blob:portrait" video={{duration:16,width:1080,height:1920}}/>);
 expect(screen.getByLabelText('投稿動画').style.width).toContain('270px');
 const media=view.container.querySelector('video')!;Object.defineProperties(media,{videoWidth:{value:1080},videoHeight:{value:1920}});fireEvent.loadedMetadata(media);
 expect(screen.getByLabelText('投稿動画').style.width).toContain('270px');
});
it('does not apply the inline width constraint during fullscreen playback',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(document,'fullscreenElement');
 const view=render(<PostVideoPlayer previewUrl="blob:portrait" video={{duration:16,width:1080,height:1920}}/>);const root=screen.getByLabelText('投稿動画');
 try{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:root});fireEvent(document,new Event('fullscreenchange'));expect(root.style.width).toBe('');}
 finally{if(descriptor)Object.defineProperty(document,'fullscreenElement',descriptor);else delete (document as any).fullscreenElement;}
});

it.each([390,1024])('plays quoted portrait videos inline in a landscape crop at %spx',async width=>{
 const descriptor=Object.getOwnPropertyDescriptor(window,'innerWidth')!;
 Object.defineProperty(window,'innerWidth',{value:width,configurable:true});
 const opened=vi.fn();window.addEventListener('lime-open-media-viewer',opened);
 try{
  const view=render(<PostVideoPlayer embedded previewUrl="blob:quote" postId="quoted-video" video={{duration:27,width:1080,height:1920}}/>);
  const media=view.container.querySelector('video')!;
  expect(screen.getByLabelText('投稿動画').style.width).toBe('100%');expect(media.style.aspectRatio).toBe('16/9');expect(media.style.objectFit).toBe('contain');expect(screen.getByText('0:27')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));
  await screen.findByRole('button',{name:'一時停止'});
  expect(media.style.aspectRatio).toBe('16/9');expect(media.style.objectFit).toBe('contain');expect(screen.getByLabelText('投稿動画').style.aspectRatio).toBe('16/9');
  expect(opened).not.toHaveBeenCalled();expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  expect(mocks.resolve).not.toHaveBeenCalled();expect(view.container.querySelector('.post-video-controls')).not.toBeNull();
 }finally{Object.defineProperty(window,'innerWidth',descriptor);window.removeEventListener('lime-open-media-viewer',opened);}
});
it('keeps quoted fullscreen video uncropped',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(document,'fullscreenElement');
 const view=render(<PostVideoPlayer embedded previewUrl="blob:quote" video={{duration:27,width:1080,height:1920}}/>);
 const root=screen.getByLabelText('投稿動画'),media=view.container.querySelector('video')!;
 try{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:root});fireEvent(document,new Event('fullscreenchange'));expect(root.style.width).toBe('');expect(media.style.aspectRatio).toBe('1080/1920');}
 finally{if(descriptor)Object.defineProperty(document,'fullscreenElement',descriptor);else delete (document as any).fullscreenElement;}
});

it('uses native HLS without loading the JavaScript engine when the browser supports it',async()=>{
 const {attachHls}=await import('./PostVideoPlayer');const media=document.createElement('video');
 vi.spyOn(media,'canPlayType').mockReturnValue('probably');
 await attachHls(media,'https://video.example/playlist.m3u8',new AbortController().signal,vi.fn());
 expect(media.src).toBe('https://video.example/playlist.m3u8');
 const abort=new AbortController();abort.abort();await expect(attachHls(media,'https://video.example/other.m3u8',abort.signal,vi.fn())).rejects.toHaveProperty('name','AbortError');
 expect(media.src).toBe('https://video.example/playlist.m3u8');
});
it('registers audible playback and lock-screen controls without pausing when the PWA is hidden',async()=>{
 const {bindBackgroundPlayback}=await import('./PostVideoPlayer');
 const actions=new Map<string,Function|null>(),audio={type:'auto'},session={metadata:null as unknown,playbackState:'none',setActionHandler:vi.fn((action:string,handler:Function|null)=>actions.set(action,handler)),setPositionState:vi.fn()};
 Object.defineProperty(navigator,'audioSession',{configurable:true,value:audio});Object.defineProperty(navigator,'mediaSession',{configurable:true,value:session});vi.stubGlobal('MediaMetadata',class{constructor(readonly data:unknown){}});
 const media=document.createElement('video');let paused=false;
 Object.defineProperty(media,'paused',{configurable:true,get:()=>paused});Object.defineProperty(media,'duration',{value:60});
 media.pause=vi.fn(()=>{paused=true;media.dispatchEvent(new Event('pause'));});media.play=vi.fn(async()=>{paused=false;media.dispatchEvent(new Event('play'));});media.currentTime=20;
 const dispose=bindBackgroundPlayback(media,{title:'投稿動画',artist:'作者'});
 try{
  expect(audio.type).toBe('playback');expect(session.playbackState).toBe('playing');expect(session.metadata).toBeTruthy();
  document.dispatchEvent(new Event('visibilitychange'));expect(media.pause).not.toHaveBeenCalled();
  actions.get('seekforward')!({seekOffset:5});expect(media.currentTime).toBe(25);
  actions.get('seekbackward')!({seekOffset:100});expect(media.currentTime).toBe(0);
  actions.get('seekto')!({seekTime:100});expect(media.currentTime).toBe(60);
  actions.get('pause')!();expect(paused).toBe(true);expect(audio.type).toBe('auto');
  await actions.get('play')!();expect(paused).toBe(false);expect(audio.type).toBe('playback');
 }finally{dispose();delete (navigator as any).audioSession;delete (navigator as any).mediaSession;}
 expect(session.playbackState).toBe('none');expect(audio.type).toBe('auto');expect([...actions.values()].every(handler=>handler===null)).toBe(true);
});
it('does not steal audio focus for muted playback or replace a microphone session',async()=>{
 const {bindBackgroundPlayback}=await import('./PostVideoPlayer');const audio={type:'play-and-record'},session={metadata:null,playbackState:'none',setActionHandler:vi.fn(),setPositionState:vi.fn()};
 Object.defineProperty(navigator,'audioSession',{configurable:true,value:audio});Object.defineProperty(navigator,'mediaSession',{configurable:true,value:session});
 const media=document.createElement('video');Object.defineProperty(media,'paused',{get:()=>false});media.muted=true;
 const dispose=bindBackgroundPlayback(media);
 try{expect(session.setActionHandler).not.toHaveBeenCalled();expect(audio.type).toBe('play-and-record');media.muted=false;media.dispatchEvent(new Event('volumechange'));expect(audio.type).toBe('play-and-record');}
 finally{dispose();delete (navigator as any).audioSession;delete (navigator as any).mediaSession;}
});
it('supports Safari presentation-mode PiP when the standard API is unavailable',async()=>{
 const {supportsVideoPip,requestVideoPip}=await import('./PostVideoPlayer');
 const media=document.createElement('video')as HTMLVideoElement&{webkitSupportsPresentationMode:(mode:string)=>boolean;webkitSetPresentationMode:ReturnType<typeof vi.fn>};
 media.webkitSupportsPresentationMode=mode=>mode==='picture-in-picture';media.webkitSetPresentationMode=vi.fn();
 expect(supportsVideoPip(media)).toBe(true);await requestVideoPip(media);expect(media.webkitSetPresentationMode).toHaveBeenCalledWith('picture-in-picture');
});

it('streams public external MP4 directly instead of downloading a whole video into memory before playback',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const view=render(<PostVideoPlayer postId="external-mp4" video={{duration:16,width:1920,height:1080}} externalVideo={{playlist:'https://video.twimg.com/movie.mp4',format:'mp4',duration:16,width:1920,height:1080}}/>);
 fireEvent.click(screen.getByRole('button',{name:'動画を再生'}));await waitFor(()=>expect(screen.getByRole('button',{name:'一時停止'})).toBeInTheDocument());
 expect(view.container.querySelector('video')).toHaveAttribute('src','https://video.twimg.com/movie.mp4');expect(fetcher).not.toHaveBeenCalled();expect(mocks.resolve).not.toHaveBeenCalled();
});

it('keeps the chosen volume across players and pauses when another audible provider starts',async()=>{
 const {bindBackgroundPlayback}=await import('./PostVideoPlayer');
 localStorage.setItem('lime-video-volume','.25');
 const media=document.createElement('video');let paused=false;
 Object.defineProperty(media,'paused',{get:()=>paused});
 media.pause=vi.fn(()=>{paused=true;media.dispatchEvent(new Event('pause'))});
 const dispose=bindBackgroundPlayback(media);
 try{
  expect(media.volume).toBe(.25);
  media.volume=.15;media.dispatchEvent(new Event('volumechange'));
  expect(localStorage.getItem('lime-video-volume')).toBe('0.15');
  window.dispatchEvent(new CustomEvent('lime-background-media-play',{detail:{kind:'youtube',element:{},audible:false}}));
  expect(media.pause).not.toHaveBeenCalled();
  window.dispatchEvent(new CustomEvent('lime-background-media-play',{detail:{kind:'youtube',element:{},audible:true}}));
  expect(media.pause).toHaveBeenCalledOnce();
 }finally{dispose()}
 const next=document.createElement('video');const release=bindBackgroundPlayback(next);
 expect(next.volume).toBe(.15);release();
});
it('uses the latest volume even for an already mounted player and transfers audio focus without resetting the route',async()=>{
 const {bindBackgroundPlayback}=await import('./PostVideoPlayer');
 const changes:string[]=[];let mode='auto';const audio={get type(){return mode},set type(value:string){mode=value;changes.push(value)}};
 Object.defineProperty(navigator,'audioSession',{configurable:true,value:audio});
 const first=document.createElement('video'),second=document.createElement('video');let firstPaused=false,secondPaused=true;
 Object.defineProperty(first,'paused',{get:()=>firstPaused});Object.defineProperty(second,'paused',{get:()=>secondPaused});
 first.pause=vi.fn(()=>{firstPaused=true;first.dispatchEvent(new Event('pause'))});
 const closeFirst=bindBackgroundPlayback(first),closeSecond=bindBackgroundPlayback(second);
 try{
  first.volume=.2;first.dispatchEvent(new Event('volumechange'));
  secondPaused=false;second.dispatchEvent(new Event('play'));
  expect(second.volume).toBe(.2);expect(first.pause).toHaveBeenCalledOnce();expect(changes).toEqual(['playback']);
 }finally{closeFirst();closeSecond();delete (navigator as any).audioSession}
 expect(changes).toEqual(['playback','auto']);
});
