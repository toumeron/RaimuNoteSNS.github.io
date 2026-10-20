import type {QueryClient} from '@tanstack/react-query';
import {isInstalledPwa} from './utils';
import {sweepTransientCaches} from './transientCache';

export function pwaQueryGcTime(){return isInstalledPwa()?90_000:300_000;}
/** Bound inactive route data only; never truncate a visible feed or cancel a read. */
export function trimInactivePwaQueries(client:QueryClient,maxQueries=32,maxItems=1200){
 if(!isInstalledPwa())return;
 const entries=client.getQueryCache().getAll().filter(query=>query.getObserversCount()===0&&query.state.fetchStatus==='idle').sort((a,b)=>b.state.dataUpdatedAt-a.state.dataUpdatedAt);
 let count=0,items=0;
 for(const query of entries){
  const data=query.state.data as {pages?:Array<{posts?:unknown[];items?:unknown[]}>}|unknown[]|undefined;
  const size=Array.isArray(data)?data.length:data?.pages?.reduce((sum,page)=>sum+(page.posts?.length??page.items?.length??0),0)??0;
  // Recently left routes keep their back-navigation data even under the budget.
  const recent=Date.now()-query.state.dataUpdatedAt<30_000;
  if(!recent&&(count>=maxQueries||items+size>maxItems)){client.removeQueries({queryKey:query.queryKey,exact:true});continue;}
  count++;items+=size;
 }
}
export function installPwaMemoryManagement(client:QueryClient){
 const trim=()=>{if(isInstalledPwa()){sweepTransientCaches();trimInactivePwaQueries(client);}};
 const visibility=()=>{if(document.hidden)trim();};
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',trim);
 return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',trim);};
}
export function pwaHlsBuffers(){
 return isInstalledPwa()?{backBufferLength:10,maxBufferSize:20*1024*1024}:{};
}
