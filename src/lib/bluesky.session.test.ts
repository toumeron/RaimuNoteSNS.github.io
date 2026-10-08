import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {refreshBlueskySession,getStoredBlueskySession,authorizedBlueskyFetch,logoutFromBluesky} from './bluesky';
import {ACTIVE_ACCOUNT_KEY} from './savedAccounts';
const session={did:'did:plc:test',handle:'test.bsky.social',accessJwt:'access',refreshJwt:'refresh'};
const rotated={...session,accessJwt:'rotated-access',refreshJwt:'rotated-refresh'};
beforeEach(()=>{localStorage.clear();localStorage.setItem(ACTIVE_ACCOUNT_KEY,'owner');localStorage.setItem('lime_bluesky_session',JSON.stringify(session));});
afterEach(()=>vi.unstubAllGlobals());
it.each([429,500,502,503])('does not delete login on a temporary %s response',async status=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Unavailable'}),{status})));
 await expect(refreshBlueskySession()).rejects.toThrow();expect(getStoredBlueskySession()).toEqual(session);
});
it('keeps login on network loss',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('network failed');}));await expect(refreshBlueskySession()).rejects.toThrow();expect(getStoredBlueskySession()).toEqual(session);});
it.each(['ExpiredToken','InvalidToken'])('clears only a genuinely rejected refresh token: %s',async error=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error}),{status:400})));await expect(refreshBlueskySession()).rejects.toThrow();expect(getStoredBlueskySession()).toBeNull();});
it('shares one refresh across parallel requests and stores the rotated session',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 const request=vi.fn(async()=>{await pending;return new Response(JSON.stringify(rotated));});vi.stubGlobal('fetch',request);
 const a=refreshBlueskySession(),b=refreshBlueskySession();release();expect(await a).toEqual(rotated);expect(await b).toEqual(rotated);expect(request).toHaveBeenCalledTimes(1);expect(getStoredBlueskySession()).toEqual(rotated);
});
it('does not restore credentials after logout while refresh is in flight',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.includes('refreshSession')){await pending;return new Response(JSON.stringify(rotated));}return new Response('{}');}));
 const refresh=refreshBlueskySession();await logoutFromBluesky();release();expect(await refresh).toBeNull();expect(getStoredBlueskySession()).toBeNull();
});
it('does not publish another LimeNote account’s credentials after an account switch',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 vi.stubGlobal('fetch',vi.fn(async()=>{await pending;return new Response(JSON.stringify(rotated));}));
 const refresh=refreshBlueskySession();localStorage.setItem(ACTIVE_ACCOUNT_KEY,'other');release();expect(await refresh).toBeNull();expect(getStoredBlueskySession()).toEqual(session);
});
it('retries an authenticated operation with rotated access credentials',async()=>{
 const request=vi.fn(async(url:string,init:RequestInit)=>url.includes('refreshSession')?new Response(JSON.stringify(rotated)):init.headers&& (init.headers as any).Authorization==='Bearer access'?new Response(JSON.stringify({error:'ExpiredToken'}),{status:400}):new Response('{}'));
 vi.stubGlobal('fetch',request);expect((await authorizedBlueskyFetch('test')).ok).toBe(true);expect(getStoredBlueskySession()).toEqual(rotated);
});
