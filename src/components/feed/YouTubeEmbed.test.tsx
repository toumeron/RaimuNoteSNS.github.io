import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,Routes,Route,Link} from 'react-router-dom';
import {YouTubeEmbed} from './PostCard';
import {BackgroundMediaRoot} from '@/App';
import {timelineRenderSegments} from '@/pages/Feed';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();delete window.__limeYouTubePlaybackDiagnostics;});
function delivery(frame:HTMLIFrameElement,info:Record<string,unknown>,origin='https://www.youtube.com'){
 act(()=>window.dispatchEvent(new MessageEvent('message',{origin,source:frame.contentWindow,data:JSON.stringify({event:'infoDelivery',info})})));
}
function message(frame:HTMLIFrameElement,state:number){delivery(frame,{playerState:state});}
function scene(){
 const view=render(<BackgroundMediaRoot><MemoryRouter><Routes>
  <Route path="/" element={<><div data-testid="video-post"><YouTubeEmbed videoId="abcdefghijk"/></div><Link to="/other">別ページ</Link></>}/>
  <Route path="/other" element={<p>移動先</p>}/>
 </Routes></MemoryRouter></BackgroundMediaRoot>);
 return {view,frame:screen.getByTitle('YouTube video player') as HTMLIFrameElement};
}
it('keeps the normal iframe inside its post without floating, scaling, or changing sound on scroll',()=>{
 const {frame}=scene(),src=frame.src,parent=frame.parentElement;message(frame,1);
 const send=vi.spyOn(frame.contentWindow!,'postMessage');
 fireEvent.scroll(window);fireEvent.resize(window);fireEvent(window,new Event('focus'));
 expect(screen.getByTestId('video-post').contains(frame)).toBe(true);
 expect(frame.parentElement).toBe(parent);expect(frame.src).toBe(src);
 expect(frame.style.transform).toBe('');expect(frame.style.pointerEvents).toBe('');
 expect(document.querySelector('[data-mini],.lime-youtube-player')).toBeNull();
 expect(screen.queryByRole('button')).toBeNull();expect(send).not.toHaveBeenCalled();
 expect(new URL(src).searchParams.get('controls')).toBe('1');
});
it('removes the player and cancels pending recovery when its page is left',()=>{
 vi.useFakeTimers();const {frame}=scene();message(frame,1);delivery(frame,{playerState:3,currentTime:18});
 const send=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.click(screen.getByText('別ページ'));
 act(()=>vi.advanceTimersByTime(20000));expect(screen.queryByTitle('YouTube video player')).toBeNull();expect(send).not.toHaveBeenCalled();
});
it('ignores unrelated origins and bubbles real playback activity from its post only once',()=>{
 const play=vi.fn();const view=render(<div onClick={()=>{}}><YouTubeEmbed videoId="abcdefghijk"/></div>);
 view.container.addEventListener('lime-background-media-play',play);
 const frame=screen.getByTitle('YouTube video player') as HTMLIFrameElement;
 delivery(frame,{playerState:1},'https://other.example');expect(play).not.toHaveBeenCalled();
 message(frame,1);message(frame,1);expect(play).toHaveBeenCalledOnce();
 expect((play.mock.calls[0][0] as CustomEvent).detail.element).toBe(frame);
});
it('pauses only the previous YouTube player when another one starts',()=>{
 render(<><YouTubeEmbed videoId="abcdefghijk"/><YouTubeEmbed videoId="lmnopqrstuv"/></>);
 const [first,second]=screen.getAllByTitle('YouTube video player') as HTMLIFrameElement[];
 message(first,1);const send=vi.spyOn(first.contentWindow!,'postMessage');message(second,1);
 expect(send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'command',func:'pauseVideo',args:[]}),'https://www.youtube.com');
});
it('starts a fresh playback state for a changed video source',()=>{
 const view=render(<YouTubeEmbed videoId="abcdefghijk"/>);const first=screen.getByTitle('YouTube video player') as HTMLIFrameElement;message(first,1);
 const play=vi.fn();window.addEventListener('lime-background-media-play',play);
 try{view.rerender(<YouTubeEmbed videoId="lmnopqrstuv"/>);const next=screen.getByTitle('YouTube video player') as HTMLIFrameElement;
 expect(next).not.toBe(first);message(next,1);expect(play).toHaveBeenCalledOnce();
 }finally{window.removeEventListener('lime-background-media-play',play);}
});
it('stops handshake retries once the player responds',()=>{
 vi.useFakeTimers();const {frame}=scene();const send=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.load(frame);
 delivery(frame,{playerState:1,muted:false,volume:67});act(()=>vi.advanceTimersByTime(2000));
 expect(send).toHaveBeenCalledOnce();expect(window.__limeYouTubePlaybackDiagnostics?.at(-1)).toMatchObject({state:1,muted:false,volume:67,mini:false});
});
it('reloads a stalled inline stream at the last position once, without replacing its iframe or changing sound',()=>{
 vi.useFakeTimers();const {frame}=scene();const src=frame.src;message(frame,1);
 const send=vi.spyOn(frame.contentWindow!,'postMessage');delivery(frame,{playerState:3,currentTime:12.75,muted:false,volume:100});
 act(()=>vi.advanceTimersByTime(3000));delivery(frame,{playerState:3,currentTime:12.75});act(()=>vi.advanceTimersByTime(1000));
 expect(send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'command',func:'loadVideoById',args:[{videoId:'abcdefghijk',startSeconds:12.75}]}),'https://www.youtube.com');
 message(frame,1);act(()=>vi.advanceTimersByTime(1500));message(frame,3);act(()=>vi.advanceTimersByTime(60000));expect(send).toHaveBeenCalledOnce();
 expect(screen.getByTitle('YouTube video player')).toBe(frame);expect(frame.src).toBe(src);
});
it.each([0,2])('does not override a user pause or end of playback (state %s)',state=>{
 vi.useFakeTimers();const {frame}=scene();message(frame,1);delivery(frame,{playerState:3,currentTime:10});
 const send=vi.spyOn(frame.contentWindow!,'postMessage');message(frame,state);act(()=>vi.advanceTimersByTime(10000));expect(send).not.toHaveBeenCalled();
});
it('does not reload during healthy playback or after autoplay was blocked',()=>{
 vi.useFakeTimers();const {frame}=scene();const send=vi.spyOn(frame.contentWindow!,'postMessage');
 delivery(frame,{playerState:1,currentTime:10});act(()=>vi.advanceTimersByTime(10000));expect(send).not.toHaveBeenCalled();
 delivery(frame,{playerState:3,currentTime:10});act(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://www.youtube.com',source:frame.contentWindow,data:JSON.stringify({event:'onAutoplayBlocked'})})));
 act(()=>vi.advanceTimersByTime(10000));expect(send).not.toHaveBeenCalled();
});
it('leaves YouTube audio and OS playback settings untouched',()=>{
 const audio={type:'auto'},session={metadata:null,playbackState:'none',setActionHandler:vi.fn()};
 const assignAudio=vi.fn(),assignMetadata=vi.fn(),assignState=vi.fn();
 Object.defineProperty(audio,'type',{get:()=>'auto',set:assignAudio});Object.defineProperty(session,'metadata',{get:()=>null,set:assignMetadata});Object.defineProperty(session,'playbackState',{get:()=>'none',set:assignState});
 vi.stubGlobal('navigator',Object.create(navigator,{audioSession:{value:audio},mediaSession:{value:session}}));vi.stubGlobal('MediaMetadata',class{});
 const {frame,view}=scene();
 for(let cycle=0;cycle<12;cycle++){message(frame,1);fireEvent(window,new Event('focus'));message(frame,2);}
 view.unmount();expect(assignAudio).not.toHaveBeenCalled();expect(assignMetadata).not.toHaveBeenCalled();expect(assignState).not.toHaveBeenCalled();expect(session.setActionHandler).not.toHaveBeenCalled();
});
it('pins only the playing post outside the virtual window and preserves the original iframe on scroll',()=>{
 expect(timelineRenderSegments(40,45,100,75)).toEqual([{kind:'spacer',start:0,end:40},{kind:'posts',start:40,end:45},{kind:'spacer',start:45,end:75},{kind:'posts',start:75,end:76},{kind:'spacer',start:76,end:100}]);
 expect(timelineRenderSegments(40,45,100,0)).toEqual([{kind:'posts',start:0,end:1},{kind:'spacer',start:1,end:40},{kind:'posts',start:40,end:45},{kind:'spacer',start:45,end:100}]);
 function Rows({start,end}:{start:number;end:number}){return <>{timelineRenderSegments(start,end,100,0).flatMap(segment=>segment.kind==='spacer'?[<div key={`spacer-${segment.start}-${segment.end}`} style={{height:(segment.end-segment.start)*100}}/>]:Array.from({length:segment.end-segment.start},(_,i)=>{const index=segment.start+i;return <div key={`post-${index}`}>{index===0?<YouTubeEmbed videoId="abcdefghijk"/>:<span>投稿{index}</span>}</div>;}))}</>;}
 const view=render(<Rows start={0} end={5}/>);const frame=screen.getByTitle('YouTube video player');
 view.rerender(<Rows start={40} end={45}/>);expect(screen.getByTitle('YouTube video player')).toBe(frame);expect(view.container.querySelectorAll('span')).toHaveLength(5);
 view.rerender(<Rows start={0} end={5}/>);expect(screen.getByTitle('YouTube video player')).toBe(frame);
});
it('pauses YouTube when an audible native video starts, without forcing a volume change',()=>{
 const {frame}=scene();message(frame,1);const send=vi.spyOn(frame.contentWindow!,'postMessage');
 act(()=>window.dispatchEvent(new CustomEvent('lime-background-media-play',{detail:{kind:'html-media',element:document.createElement('video'),audible:true}})));
 expect(send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'command',func:'pauseVideo',args:[]}),'https://www.youtube.com');
});
