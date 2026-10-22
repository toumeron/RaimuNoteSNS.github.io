import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPwa } from "@/App";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fetchExternalEvents } from "../../supabase/functions/check-external-notifications/sources.ts";

describe("registerPwa", () => {
describe("registerPwa", () => {
describe('PWA startup and automatic updates',()=>{
 beforeEach(()=>{vi.stubEnv('DEV',false);vi.useFakeTimers();vi.spyOn(document,'readyState','get').mockReturnValue('complete');vi.stubGlobal('requestIdleCallback',undefined);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');});
 afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
 function fixture(controlled=true){
  const sw=Object.assign(new EventTarget(),{controller:controlled?{}:null,register:vi.fn()});
  const registration=Object.assign(new EventTarget(),{installing:null,waiting:null,update:vi.fn().mockResolvedValue(undefined)});
  sw.register.mockResolvedValue(registration);vi.stubGlobal('navigator',{serviceWorker:sw});return {sw,registration};
 }
 async function start(){await vi.advanceTimersByTimeAsync(1000);}
 it('checks on launch and resume, throttles duplicate resume events and reloads once',async()=>{
  const {sw,registration}=fixture();const reload=vi.fn();const cancel=registerPwa({reload});await start();expect(registration.update).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('focus'));expect(registration.update).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(60000);window.dispatchEvent(new Event('focus'));await Promise.resolve();expect(registration.update).toHaveBeenCalledTimes(2);
  sw.dispatchEvent(new Event('controllerchange'));sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).toHaveBeenCalledTimes(1);cancel();
 });
 it('does not reload when the first installed worker claims a new page',async()=>{
  const {sw}=fixture(false);const reload=vi.fn();const cancel=registerPwa({reload});await start();sw.controller={};sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).not.toHaveBeenCalled();cancel();
 });
 it('acknowledges update messages so the worker will not navigate the page twice',async()=>{
  const {sw}=fixture();const reload=vi.fn(),postMessage=vi.fn();const cancel=registerPwa({reload});await start();sw.dispatchEvent(new MessageEvent('message',{data:{type:'LIME_PWA_UPDATE',token:'new'},source:{postMessage} as any}));await vi.advanceTimersByTimeAsync(300);expect(postMessage).toHaveBeenCalledWith({type:'LIME_PWA_UPDATE_ACK',token:'new'});expect(reload).toHaveBeenCalledTimes(1);cancel();
 });
 it('activates an update which is waiting and removes listeners on cancellation',async()=>{
  const {sw,registration}=fixture();const postMessage=vi.fn();registration.waiting={postMessage} as any;const reload=vi.fn();const cancel=registerPwa({reload});await start();expect(postMessage).toHaveBeenCalledWith({type:'SKIP_WAITING'});cancel();sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).not.toHaveBeenCalled();
 });
 it('waits for page load and idle time before registering',()=>{
  const {sw}=fixture();vi.spyOn(document,'readyState','get').mockReturnValue('loading');let cb:IdleRequestCallback;vi.stubGlobal('requestIdleCallback',vi.fn(callback=>{cb=callback;return 1;}));vi.stubGlobal('cancelIdleCallback',vi.fn());const cancel=registerPwa();window.dispatchEvent(new Event('load'));expect(sw.register).not.toHaveBeenCalled();cb!({didTimeout:false,timeRemaining:()=>50});expect(sw.register).toHaveBeenCalledWith('/RaimuNoteSNS.github.io/sw.js',{scope:'/RaimuNoteSNS.github.io/',updateViaCache:'none'});cancel();
 });
 it('uses the development worker without production reload listeners',async()=>{
  vi.stubEnv('DEV',true);const {sw}=fixture();const reload=vi.fn();const cancel=registerPwa({reload});await start();expect(sw.register).toHaveBeenCalledWith('/RaimuNoteSNS.github.io/dev-sw.js?dev-sw',expect.anything());sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).not.toHaveBeenCalled();cancel();
 });
 it('cancels pending registration',async()=>{const {sw}=fixture();const cancel=registerPwa();cancel();await start();expect(sw.register).not.toHaveBeenCalled();});
});
});

describe("pushWorker", () => {
afterEach(()=>vi.useRealTimers());
function worker(){
 const listeners:Record<string,(event:any)=>void>={};const notices:any[]=[];const set=vi.fn(),clear=vi.fn();
 const self={location:{origin:'https://lime.example'},navigator:{setAppBadge:set,clearAppBadge:clear},registration:{getNotifications:async()=>notices,showNotification:async(title:string,options:any)=>{const item={title,tag:options.tag,data:options.data,close:vi.fn()};notices.push(item);}},clients:{matchAll:async()=>[],openWindow:vi.fn()},addEventListener:(name:string,callback:any)=>{listeners[name]=callback;}};
 vm.runInNewContext(readFileSync('public/push-sw.js','utf8'),{self,URL,Date,setTimeout,console,Promise});
 return{listeners,notices,self,set,clear};
}
it('expires OS notifications after thirty seconds without marking history read',async()=>{vi.useFakeTimers();const w=worker();let work:Promise<unknown>=Promise.resolve();w.listeners.push({data:{json:()=>({title:'New',tag:'notice',unread_count:2,data:{notificationId:'notice'}})},waitUntil:(promise:Promise<unknown>)=>{work=promise;}});await vi.advanceTimersByTimeAsync(0);expect(w.notices).toHaveLength(1);expect(w.notices[0].close).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(30000);await work;expect(w.notices[0].close).toHaveBeenCalled();expect(w.set).toHaveBeenCalledWith(2);expect(w.clear).not.toHaveBeenCalled();});
it('read messages close only the requested notices and update the badge immediately',async()=>{const w=worker();const closeA=vi.fn(),closeB=vi.fn();w.notices.push({tag:'a',data:{notificationId:'a'},close:closeA},{tag:'b',data:{notificationId:'b'},close:closeB});let work:Promise<unknown>=Promise.resolve();w.listeners.message({data:{type:'LIME_NOTIFICATIONS_READ',ids:['a'],count:1},waitUntil:(promise:Promise<unknown>)=>{work=promise;}});await work;expect(closeA).toHaveBeenCalled();expect(closeB).not.toHaveBeenCalled();expect(w.set).toHaveBeenCalledWith(1);});
it('clicking an OS notification passes its id to a newly opened app so it can be marked read',async()=>{const w=worker();let work:Promise<unknown>=Promise.resolve();w.listeners.notificationclick({notification:{close:vi.fn(),data:{url:'/RaimuNoteSNS.github.io/post/post',notificationId:'notice'}},waitUntil:(promise:Promise<unknown>)=>{work=promise;}});await work;expect(w.self.clients.openWindow).toHaveBeenCalledWith('https://lime.example/RaimuNoteSNS.github.io/post/post?notification=notice');});
it('clicking a DM or message request notification opens the conversation',async()=>{const w=worker();let work:Promise<unknown>=Promise.resolve();w.listeners.notificationclick({notification:{close:vi.fn(),data:{url:'/RaimuNoteSNS.github.io/messages/conversation',notificationId:'dm-notice'}},waitUntil:(promise:Promise<unknown>)=>{work=promise;}});await work;expect(w.self.clients.openWindow).toHaveBeenCalledWith('https://lime.example/RaimuNoteSNS.github.io/messages/conversation?notification=dm-notice');});
});
});

describe("externalNotificationSources", () => {
afterEach(()=>vi.unstubAllGlobals());
const target={id:'subscription',provider:'bluesky' as const,external_actor:'alice.bsky.social',created_at:'2026-10-08T10:00:00Z'};
it('omits historical posts, reposts and replies; carries images and stable external ids',async()=>{
 const post=(key:string,date:string)=>({uri:`at://did:plc:alice/app.bsky.feed.post/${key}`,indexedAt:date,author:{handle:'alice.bsky.social',displayName:'Alice'},record:{text:key,createdAt:date},embed:{images:[{thumb:'https://image.example/thumb'}]}});
 const fetch=vi.fn().mockResolvedValue(Response.json({feed:[{post:post('new','2026-10-08T11:00:00Z')},{post:post('repost','2026-10-08T11:00:00Z'),reason:{$type:"app.bsky.feed.defs#reasonRepost"}},{post:{...post('reply','2026-10-08T11:00:00Z'),record:{reply:{},text:'reply'}}},{post:post('old','2026-10-01T11:00:00Z')}]}));vi.stubGlobal('fetch',fetch);
 const rows=await fetchExternalEvents(target);expect(rows.map(row=>row.content)).toEqual(['new']);expect(rows[0].id).toBe('bsky:at://did:plc:alice/app.bsky.feed.post/new');expect(rows[0].images).toEqual(['https://image.example/thumb']);
});
it('paginates and skips events already observed without changing the provider host',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({feed:[],cursor:'next'})).mockResolvedValueOnce(Response.json({feed:[{post:{uri:'at://seen',indexedAt:'2026-10-08T11:00:00Z',record:{text:'seen'}}}]}));vi.stubGlobal('fetch',fetch);
 expect(await fetchExternalEvents({...target,external_cursor:{seen:['bsky:at://seen']}})).toEqual([]);expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toContain('cursor=next');
});
it('Misskey uses only the fixed public API and excludes nonpublic notes and replies',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({id:'actor',name:'Alice',avatarUrl:'avatar'})).mockResolvedValueOnce(Response.json([{id:'new',url:'https://remote.example/notes/remote-id',createdAt:'2026-10-08T11:00:00Z',visibility:'public',text:'note',files:[]},{id:'private',createdAt:'2026-10-08T11:00:00Z',visibility:'followers',text:'secret'},{id:'reply',createdAt:'2026-10-08T11:00:00Z',visibility:'public',replyId:'parent',text:'reply'}]));vi.stubGlobal('fetch',fetch);
 const result=await fetchExternalEvents({...target,provider:'misskey',external_actor:'alice@127.0.0.1'});expect(result.map(row=>row.id)).toEqual(['misskey:https://misskey.io/notes/new']);expect(fetch.mock.calls.every(([url])=>String(url).startsWith('https://misskey.io/api/'))).toBe(true);
});
it('does not replace the cursor after a provider failure',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})));await expect(fetchExternalEvents(target)).rejects.toThrow('503');});

it('does not stop at a pinned old post or a previously seen post mixed with new ones',async()=>{
 const item=(key:string,date:string)=>({post:{uri:'at://'+key,indexedAt:date,record:{text:key}}});
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({feed:[{...item('pin','2020-01-01'),reason:{$type:'app.bsky.feed.defs#reasonPin'}},item('seen','2026-10-08T11:00:00Z'),item('new','2026-10-08T11:00:00Z')],cursor:'second'})).mockResolvedValueOnce(Response.json({feed:[item('next','2026-10-08T10:30:00Z')]}));vi.stubGlobal('fetch',fetch);
 const rows=await fetchExternalEvents({...target,external_cursor:{seen:['bsky:at://seen']}});expect(rows.map(row=>row.content)).toEqual(['next','new']);expect(fetch).toHaveBeenCalledTimes(2);
});
});
