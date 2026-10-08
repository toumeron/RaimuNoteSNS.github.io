// Execute the actual worker with a simulated browser event lifecycle.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {afterEach,expect,it,vi} from 'vitest';
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
