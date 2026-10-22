import {preloadPostCardAssets} from '@/components/feed/PostCard';
import type {PostWithAuthor} from '@/types';
import {QueryClient,QueryObserver} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {pwaQueryGcTime,pwaHlsBuffers,trimInactivePwaQueries,installPwaMemoryManagement} from "@/lib/utils";
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
it('counts ordinary array pages when applying the inactive feed memory budget',()=>{
 vi.stubGlobal('navigator',{standalone:true});const client=new QueryClient();
 client.setQueryData(['old-array-feed'],{pages:[Array(1500).fill({})],pageParams:[0]},{updatedAt:Date.now()-60000});
 trimInactivePwaQueries(client);expect(client.getQueryState(['old-array-feed'])).toBeUndefined();client.clear();
});
it('batches foreground route cleanup, preserves recent data, and stops housekeeping while hidden',()=>{
 vi.useFakeTimers();vi.stubGlobal('navigator',{standalone:true});vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const client=new QueryClient({defaultOptions:{queries:{gcTime:Infinity}}});const stop=installPwaMemoryManagement(client);
 client.setQueryData(['large-left-route'],{pages:[Array(1500).fill({})]});
 vi.advanceTimersByTime(29000);expect(client.getQueryState(['large-left-route'])).toBeTruthy();
 client.setQueryData(['just-left-route'],['recent']);
 vi.advanceTimersByTime(1100);expect(client.getQueryState(['large-left-route'])).toBeUndefined();expect(client.getQueryData(['just-left-route'])).toEqual(['recent']);
 client.setQueryData(['queued'],[]);vi.spyOn(document,'hidden','get').mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));
 expect(vi.getTimerCount()).toBe(0);stop();client.setQueryData(['after-cleanup'],[]);expect(vi.getTimerCount()).toBe(0);client.clear();vi.useRealTimers();
});

it('does not download and decode a second full-size image to measure Android PWA feed cards',()=>{
 vi.stubGlobal('navigator',{standalone:true,userAgent:'Android'});
 const image=vi.fn();vi.stubGlobal('Image',image);
 preloadPostCardAssets({content:'',imageUrls:['https://images.example/android-pwa-measurement']} as PostWithAuthor);
 expect(image).not.toHaveBeenCalled();
});
