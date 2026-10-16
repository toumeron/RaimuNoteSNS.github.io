import {act,cleanup,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({read:vi.fn(()=>null as {did:string;handle:string;accessJwt:string;refreshJwt:string}|null)}));
vi.mock('@/lib/bluesky',()=>({BSKY_SESSION_STORAGE_KEY:'lime_bluesky_session',getStoredBlueskySession:fixture.read}));
vi.mock('@/lib/fxTwitter',()=>({isXId:(id?:string)=>!!id?.startsWith('x:')}));
vi.mock('@/lib/misskey',()=>({isMisskeyId:(id?:string)=>!!id?.startsWith('misskey:')}));
import {useBlueskySession} from './useBlueskySession';
import { useTimelinePortalTheme } from "@/hooks/useViewportWidth";
import { useMinuteTick } from "@/hooks/useViewportWidth";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();localStorage.clear();fixture.read.mockReset().mockReturnValue(null);});
it('200 posts share session listeners and refresh once per event; unchanged sessions do not rerender cards',()=>{
 const add=vi.spyOn(window,'addEventListener'),remove=vi.spyOn(window,'removeEventListener');let renders=0;
 function Card(){renders++;return <span>{useBlueskySession('bsky:post')?.handle??'signed-out'}</span>;}
 const view=render(<>{Array.from({length:200},(_,i)=><Card key={i}/>)}</>);
 expect(add.mock.calls.filter(([type])=>type==='lime-bluesky-session-changed')).toHaveLength(1);
 expect(add.mock.calls.filter(([type])=>type==='storage')).toHaveLength(1);
 expect(fixture.read.mock.calls.length).toBeLessThanOrEqual(2);
 const session={did:'did:example',handle:'artist',accessJwt:'access',refreshJwt:'refresh'};
 act(()=>window.dispatchEvent(new CustomEvent('lime-bluesky-session-changed',{detail:{session}})));
 expect(view.getAllByText('artist')).toHaveLength(200);const previous=renders;
 act(()=>window.dispatchEvent(new CustomEvent('lime-bluesky-session-changed',{detail:{session:{...session}}})));
 expect(renders).toBe(previous);
 act(()=>window.dispatchEvent(new CustomEvent('lime-bluesky-session-changed',{detail:{session:null}})));
 expect(view.getAllByText('signed-out')).toHaveLength(200);
 fixture.read.mockReturnValue(session);act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null})));
 expect(view.getAllByText('artist')).toHaveLength(200);
 view.unmount();expect(remove.mock.calls.filter(([type])=>type==='lime-bluesky-session-changed')).toHaveLength(1);
});
it('Twitter and Misskey cards do not read or subscribe to a Bluesky session',()=>{
 const add=vi.spyOn(window,'addEventListener');
 function Card({id}:{id:string}){return <span>{useBlueskySession(id)?.handle??'none'}</span>;}
 const view=render(<><Card id="x:1"/><Card id="misskey:2"/></>);
 expect(fixture.read).not.toHaveBeenCalled();expect(add.mock.calls.filter(([type])=>type==='lime-bluesky-session-changed')).toHaveLength(0);
 view.rerender(<Card id="bsky:3"/>);expect(fixture.read).toHaveBeenCalled();
});
it('200 themed cards share a channel, preserve theme updates, and release it after unmount',()=>{
 const close=vi.fn(),channels:any[]=[];
 vi.stubGlobal('BroadcastChannel',class{onmessage:any;close=close;constructor(){channels.push(this);}});
 const add=vi.spyOn(window,'addEventListener');localStorage.setItem('lime_timeline_visual_theme','light');
 function Card(){return <span>{useTimelinePortalTheme(true)}</span>;}
 const view=render(<>{Array.from({length:200},(_,i)=><Card key={i}/>)}</>);
 expect(channels).toHaveLength(1);expect(view.getAllByText('light')).toHaveLength(200);
 expect(add.mock.calls.filter(([type])=>type==='timeline-visual-theme-changed')).toHaveLength(1);
 act(()=>window.dispatchEvent(new CustomEvent('timeline-visual-theme-changed',{detail:{theme:'dark'}})));
 expect(view.getAllByText('dark')).toHaveLength(200);
 act(()=>channels[0].onmessage({data:{theme:'light'}}));expect(view.getAllByText('light')).toHaveLength(200);
 view.unmount();expect(close).toHaveBeenCalledTimes(1);
});
it('200 relative-time consumers share one clock and suspend it while the PWA is hidden',()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const intervals=vi.spyOn(globalThis,'setInterval');let renders=0;
 function Card(){useMinuteTick();renders++;return null;}
 const view=render(<>{Array.from({length:200},(_,i)=><Card key={i}/>)}</>);
 expect(intervals).toHaveBeenCalledTimes(1);const initial=renders;
 act(()=>vi.advanceTimersByTime(60000));expect(renders).toBe(initial+200);
 vi.spyOn(document,'hidden','get').mockReturnValue(true);act(()=>document.dispatchEvent(new Event('visibilitychange')));
 const hidden=renders;act(()=>vi.advanceTimersByTime(600000));expect(renders).toBe(hidden);
 vi.spyOn(document,'hidden','get').mockReturnValue(false);act(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(renders).toBe(hidden+200);view.unmount();expect(vi.getTimerCount()).toBe(0);
});
