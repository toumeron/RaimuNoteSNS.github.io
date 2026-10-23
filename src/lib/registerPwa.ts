import { preparePwaReload } from './pwaReload';

type Options = { reload?: () => void; prepareReload?: () => Promise<void>; buildId?: string };
const CHECK_INTERVAL = 60_000;
const MIN_RESUME_INTERVAL = 5_000;

/** Keep an open/resumed PWA on the deployed build without requiring a manual refresh. */
export function registerPwa({reload=()=>window.location.reload(), prepareReload=preparePwaReload, buildId=import.meta.env.VITE_PWA_BUILD_ID}:Options={}) {
  if (!('serviceWorker' in navigator)) return () => {};
  const workers=navigator.serviceWorker;
  const development=import.meta.env.DEV;
  const base=import.meta.env.BASE_URL;
  const swUrl=new URL(`${base}${development?'dev-sw.js?dev-sw':'sw.js'}`,window.location.href);
  let cancelled=false,reloading=false,preparing=false,hadController=!!workers.controller;
  let timer:ReturnType<typeof setTimeout>|undefined,reloadTimer:ReturnType<typeof setTimeout>|undefined,retryTimer:ReturnType<typeof setTimeout>|undefined;
  let interval:ReturnType<typeof setInterval>|undefined,idle:number|undefined;
  let registration:ServiceWorkerRegistration|undefined,lastCheck=-Infinity,checking=false,registering=false,failures=0;
  let forcedBuild:string|undefined;
  let versionAbort:AbortController|undefined;
  const cleanups:(()=>void)[]=[];
  const watched=new WeakSet<ServiceWorkerRegistration>(),watchedWorkers=new WeakSet<ServiceWorker>();
  const available=()=>document.visibilityState!=='hidden'&&navigator.onLine!==false;
  const queueReload=()=>{
    if(cancelled||reloading||preparing||reloadTimer!==undefined||development)return;
    reloadTimer=setTimeout(()=>{
      reloadTimer=undefined;if(cancelled)return;preparing=true;
      void prepareReload().then(()=>{if(!cancelled){reloading=true;reload();}}).catch(()=>{
        // Keep the current document when a draft cannot yet be committed; retry automatically.
        if(!cancelled)reloadTimer=setTimeout(()=>{reloadTimer=undefined;queueReload();},2000);
      }).finally(()=>{preparing=false;});
    },250);
  };
  const controllerChanged=()=>{if(hadController)queueReload();hadController=!!workers.controller;};
  const workerMessage=(event:MessageEvent)=>{
    if(event.data?.type!=='LIME_PWA_UPDATE'||typeof event.data.token!=='string')return;
    (event.source as ServiceWorker|null)?.postMessage({type:'LIME_PWA_UPDATE_ACK',token:event.data.token});
    if(hadController)queueReload();
  };
  const activateWaiting=()=>registration?.waiting?.postMessage({type:'SKIP_WAITING'});
  const watch=(result:ServiceWorkerRegistration)=>{
    registration=result;
    const found=()=>{
      const installing=result.installing;if(!installing||watchedWorkers.has(installing))return;
      watchedWorkers.add(installing);
      const state=()=>{if(installing.state==='installed')activateWaiting();if(installing.state==='redundant')forcedBuild=undefined;};
      installing.addEventListener('statechange',state);cleanups.push(()=>installing.removeEventListener('statechange',state));state();
    };
    if(!watched.has(result)){watched.add(result);result.addEventListener('updatefound',found);cleanups.push(()=>result.removeEventListener('updatefound',found));}
    found();activateWaiting();
  };
  const retryRegistration=()=>{
    if(cancelled||development||retryTimer!==undefined)return;
    const delay=Math.min(300000,5000*2**Math.min(failures++,6));
    retryTimer=setTimeout(()=>{retryTimer=undefined;if(available())register();else retryRegistration();},delay);
  };
  // Retain a cache-busted worker URL on later launches instead of alternating URLs.
  const currentScript=()=>{
    if(!workers.controller?.scriptURL)return development?`${base}dev-sw.js?dev-sw`:`${base}sw.js`;
    try {const current=new URL(workers.controller?.scriptURL??swUrl.href);if(current.origin===swUrl.origin&&current.pathname===swUrl.pathname)return current.href;}catch{/* Use the scoped application worker. */}
    return development?`${base}dev-sw.js?dev-sw`:`${base}sw.js`;
  };
  const register=()=>{
    if(cancelled||registering)return;
    registering=true;
    void workers.register(development?`${base}dev-sw.js?dev-sw`:currentScript(),{scope:base,updateViaCache:'none'}).then(result=>{
      if(cancelled)return;failures=0;watch(result);
      if(!development){interval??=setInterval(()=>{void check(false);},CHECK_INTERVAL);void check(true);}
    }).catch(error=>{console.debug('PWA registration will retry',error);retryRegistration();}).finally(()=>{registering=false;});
  };
  const probeVersion=async()=>{
    if(!buildId||cancelled||!available())return;
    const controller=new AbortController();versionAbort=controller;
    const timeout=setTimeout(()=>controller.abort(),5000);
    try {
      const response=await fetch(`${base}version.json?_=${Date.now()}`,{cache:'no-store',credentials:'omit',signal:controller.signal});
      if(!response.ok)return;
      const version:unknown=await response.json();
      const id=version&&typeof version==='object'&&'buildId' in version?version.buildId:undefined;
      if(typeof id!=='string'||!/^\d{13}-[a-f0-9]{8}$/.test(id)||id===buildId||id===forcedBuild||cancelled||preparing||reloading||reloadTimer!==undefined||registration?.installing||!available())return;
      // Bypass intermediate HTTP caches when the published version and running code differ.
      const result=await workers.register(`${base}sw.js?build=${encodeURIComponent(id)}`,{scope:base,updateViaCache:'none'});
      if(cancelled)return;forcedBuild=id;watch(result);
    }catch{/* Offline or a rolling deployment: the next foreground check retries. */}
    finally{clearTimeout(timeout);if(versionAbort===controller)versionAbort=undefined;}
  };
  const check=async(resume:boolean)=>{
    if(cancelled||development||!available())return;
    activateWaiting();
    if(!registration){if(Date.now()-lastCheck>=MIN_RESUME_INTERVAL){lastCheck=Date.now();register();}return;}
    if(checking||Date.now()-lastCheck<(resume?MIN_RESUME_INTERVAL:CHECK_INTERVAL))return;
    lastCheck=Date.now();checking=true;
    try {await registration.update();activateWaiting();await probeVersion();}
    catch(error){console.debug('PWA update check will retry',error);await probeVersion();}
    finally{checking=false;}
  };
  const resume=()=>{void check(true);};
  const schedule=()=>{
    if(cancelled||timer!==undefined||idle!==undefined)return;
    if(typeof window.requestIdleCallback==='function')idle=window.requestIdleCallback(register,{timeout:1000});
    else timer=setTimeout(register,development?1000:0);
  };
  if(document.readyState==='complete')schedule();else window.addEventListener('load',schedule,{once:true});
  if(!development){workers.addEventListener('controllerchange',controllerChanged);workers.addEventListener('message',workerMessage);window.addEventListener('focus',resume);window.addEventListener('online',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);}
  return()=>{
    cancelled=true;versionAbort?.abort();window.removeEventListener('load',schedule);clearTimeout(timer);clearTimeout(reloadTimer);clearTimeout(retryTimer);clearInterval(interval);if(idle!==undefined)window.cancelIdleCallback(idle);
    workers.removeEventListener('controllerchange',controllerChanged);workers.removeEventListener('message',workerMessage);
    window.removeEventListener('focus',resume);window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume);cleanups.forEach(cleanup=>cleanup());
  };
}
