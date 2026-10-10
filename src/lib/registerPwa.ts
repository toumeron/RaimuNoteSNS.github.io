/** Check on launch/resume and reload once when an updated worker takes control. */
export function registerPwa({reload=()=>window.location.reload()}:{reload?:()=>void}={}) {
  if (!('serviceWorker' in navigator)) return () => {};
  const workers=navigator.serviceWorker;
  let cancelled=false,reloading=false,hadController=!!workers.controller;
  let timer:ReturnType<typeof setTimeout>|undefined,reloadTimer:ReturnType<typeof setTimeout>|undefined,idle:number|undefined;
  let registration:ServiceWorkerRegistration|undefined,lastCheck=0,checking=false;
  const cleanupWorkers:(()=>void)[]=[];
  const queueReload=()=>{
    if(cancelled||reloading||reloadTimer!==undefined||import.meta.env.DEV)return;
    reloadTimer=setTimeout(()=>{if(cancelled)return;reloading=true;reload();},250);
  };
  const controllerChanged=()=>{
    if(hadController)queueReload();
    hadController=!!workers.controller;
  };
  const workerMessage=(event:MessageEvent)=>{
    if(event.data?.type!=='LIME_PWA_UPDATE'||typeof event.data.token!=='string')return;
    (event.source as ServiceWorker|null)?.postMessage({type:'LIME_PWA_UPDATE_ACK',token:event.data.token});
    if(hadController)queueReload();
  };
  if(!import.meta.env.DEV){workers.addEventListener('controllerchange',controllerChanged);workers.addEventListener('message',workerMessage);}
  const activateWaiting=()=>registration?.waiting?.postMessage({type:'SKIP_WAITING'});
  const check=()=>{
    if(cancelled||!registration||checking||document.visibilityState==='hidden'||Date.now()-lastCheck<60000)return;
    lastCheck=Date.now();checking=true;
    void registration.update().catch(error=>console.debug('PWA update check unavailable',error)).finally(()=>{checking=false;});
    activateWaiting();
  };
  const register=()=>{
    if(cancelled)return;
    const script=import.meta.env.DEV?'dev-sw.js?dev-sw':'sw.js';
    void workers.register(`${import.meta.env.BASE_URL}${script}`,{scope:import.meta.env.BASE_URL,updateViaCache:'none'}).then(result=>{
      if(cancelled)return;registration=result;
      const found=()=>{
        const installing=result.installing;if(!installing)return;
        const state=()=>{if(installing.state==='installed')activateWaiting();};
        installing.addEventListener('statechange',state);cleanupWorkers.push(()=>installing.removeEventListener('statechange',state));state();
      };
      result.addEventListener('updatefound',found);cleanupWorkers.push(()=>result.removeEventListener('updatefound',found));found();activateWaiting();
      if(!import.meta.env.DEV)check();
    }).catch(error=>console.warn('PWA registration failed',error));
  };
  const schedule=()=>{
    if(cancelled||timer!==undefined||idle!==undefined)return;
    if(typeof window.requestIdleCallback==='function')idle=window.requestIdleCallback(register,{timeout:5000});
    else timer=setTimeout(register,1000);
  };
  if(document.readyState==='complete')schedule();else window.addEventListener('load',schedule,{once:true});
  if(!import.meta.env.DEV){window.addEventListener('focus',check);window.addEventListener('online',check);window.addEventListener('pageshow',check);document.addEventListener('visibilitychange',check);}
  return()=>{
    cancelled=true;window.removeEventListener('load',schedule);clearTimeout(timer);clearTimeout(reloadTimer);if(idle!==undefined)window.cancelIdleCallback(idle);
    workers.removeEventListener('controllerchange',controllerChanged);workers.removeEventListener('message',workerMessage);
    window.removeEventListener('focus',check);window.removeEventListener('online',check);window.removeEventListener('pageshow',check);document.removeEventListener('visibilitychange',check);cleanupWorkers.forEach(cleanup=>cleanup());
  };
}
