import {isXId} from '@/lib/fxTwitter';
import {isMisskeyId} from '@/lib/misskey';
import {useSyncExternalStore} from 'react';
import {BSKY_SESSION_STORAGE_KEY,getStoredBlueskySession,type BlueskySession} from '@/lib/bluesky';
import { noBrowserSubscription, sharedBrowserStore } from "@/lib/observePostElements";
const store=sharedBrowserStore(getStoredBlueskySession,update=>{
 const sync=()=>update(getStoredBlueskySession());
 const changed=(event:Event)=>{
  const detail=(event as CustomEvent<{session?:BlueskySession|null}>).detail;
  update(detail&&'session' in detail?detail.session??null:getStoredBlueskySession());
 };
 const storage=(event:StorageEvent)=>{if(event.key===BSKY_SESSION_STORAGE_KEY||event.key===null)sync();};
 window.addEventListener('lime-bluesky-session-changed',changed);
 window.addEventListener('lime-misskey-changed',sync);
 window.addEventListener('storage',storage);
 return()=>{window.removeEventListener('lime-bluesky-session-changed',changed);window.removeEventListener('lime-misskey-changed',sync);window.removeEventListener('storage',storage);};
},(a,b)=>a===b||JSON.stringify(a)===JSON.stringify(b));
const noSession=()=>null;
/** Share login/logout/token refresh events. Twitter and Misskey never subscribe. */
export function useBlueskySession(targetId?:string):BlueskySession|null{
 const enabled=!isMisskeyId(targetId)&&!isXId(targetId);
 return useSyncExternalStore(enabled?store.subscribe:noBrowserSubscription,enabled?store.getSnapshot:noSession,noSession);
}
