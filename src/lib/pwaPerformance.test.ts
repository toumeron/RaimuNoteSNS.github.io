import {QueryClient,QueryObserver} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {pwaQueryGcTime,pwaHlsBuffers,trimInactivePwaQueries,installPwaMemoryManagement} from './pwaPerformance';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('applies PWA-only retention and HLS history budgets',()=>{
 expect(pwaQueryGcTime()).toBe(300000);expect(pwaHlsBuffers()).toEqual({});
 vi.stubGlobal('navigator',{standalone:true});expect(pwaQueryGcTime()).toBe(90000);expect(pwaHlsBuffers()).toMatchObject({backBufferLength:10,maxBufferSize:20971520});
});
it('discards only old unused list data, preserving visible, recent and fetching queries',()=>{
 vi.stubGlobal('navigator',{standalone:true});const client=new QueryClient();const old=Date.now()-60000;
 client.setQueryData(['visible'],{pages:[{posts:Array(2000).fill({})}]},{updatedAt:old});
 const observer=new QueryObserver(client,{queryKey:['visible'],enabled:false});const stop=observer.subscribe(()=>{});
 client.setQueryData(['recent'],{pages:[{posts:Array(10).fill({})}]});
 client.setQueryData(['old'],{pages:[{posts:Array(2000).fill({})}]},{updatedAt:old});
 const pending=client.fetchQuery({queryKey:['fetching'],queryFn:()=>new Promise(()=>{})});
 trimInactivePwaQueries(client,0,10);
 expect(client.getQueryData(['visible'])).toBeTruthy();expect(client.getQueryData(['recent'])).toBeTruthy();expect(client.getQueryState(['fetching'])).toBeTruthy();expect(client.getQueryState(['old'])).toBeUndefined();
 stop();void pending.catch(()=>{});client.clear();
});
it('leaves ordinary browser caches untouched and removes its lifecycle listeners on cleanup',()=>{
 const client=new QueryClient();client.setQueryData(['old'],Array(2000).fill({}),{updatedAt:Date.now()-60000});
 trimInactivePwaQueries(client,0,0);expect(client.getQueryState(['old'])).toBeTruthy();
 vi.stubGlobal('navigator',{standalone:true});const remove=vi.spyOn(window,'removeEventListener');const cleanup=installPwaMemoryManagement(client);
 window.dispatchEvent(new Event('pagehide'));expect(client.getQueryState(['old'])).toBeUndefined();cleanup();expect(remove).toHaveBeenCalledWith('pagehide',expect.any(Function));client.clear();
});
