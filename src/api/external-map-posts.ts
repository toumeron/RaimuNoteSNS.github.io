import { supabase } from '@/lib/supabase';
import { externalRead } from '@/lib/utils';
import { mapBoundsContain, type MapBounds, type MapPostPin } from '@/lib/mapLocation';

export type ExternalMapCursor = { provider: 'flickr'; bounds: MapBounds; search: string; page: number; from: number; until: number }[];
type PositionPage = { pins: MapPostPin[]; next: ExternalMapCursor };
export class MapRateLimitError extends Error {
    constructor(public retryAfter: number) { super('Map rate limit'); }
}
const cacheKey = (search:string,bounds?:MapBounds) => `lime-map-geo-v1:${search}:${JSON.stringify(bounds)}`;
function readPositions(search: string,bounds?:MapBounds): PositionPage | null {
    try { const stored=JSON.parse(sessionStorage.getItem(cacheKey(search,bounds)) ?? 'null'); return stored?.expires > Date.now() && Array.isArray(stored.pins) && Array.isArray(stored.next) ? stored : null; } catch { return null; }
}
function storePositions(search: string, page: PositionPage, append: boolean,bounds?:MapBounds) {
    try { const previous=append ? readPositions(search,bounds) : null; sessionStorage.setItem(cacheKey(search,bounds),JSON.stringify({pins:[...new Map([...(previous?.pins ?? []),...page.pins].map(pin=>[pin.id,pin])).values()],next:page.next,expires:Date.now()+300000})); } catch { /* A full browser cache must not interrupt map reads. */ }
}
export async function getExternalMapPostPage(plan: ExternalMapCursor | undefined, signal?: AbortSignal, bounds?: MapBounds, search = ''): Promise<{ pins: MapPostPin[]; next: ExternalMapCursor }> {
    if(signal?.aborted)throw signal.reason;
    if(!plan){const stored=readPositions(search,bounds);if(stored)return {pins:stored.pins,next:stored.next};}
    const body=plan ? {mode:'map-geo-pins',jobs:plan.slice(0,4)} : {mode:'map-geo-pins',bounds,search};
    const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body,signal}),signal);
    if(signal?.aborted)throw signal.reason;
    const response=(result.error as {context?:Response}|null)?.context;
    if(response?.status===429)throw new MapRateLimitError(Math.max(300,Number(response.headers.get('Retry-After'))||300)*1000);
    if(result.error || result.data?.schema!=='geo-v1' || !Array.isArray(result.data?.pins) || !Array.isArray(result.data?.next))throw new Error('外部SNSのポスト位置を読み込めませんでした。');
    const page={pins:result.data.pins.filter((pin:MapPostPin)=>pin.source==='flickr'&&/^flickr:\d+@N\d+\/\d+$/.test(pin.id)&&pin.mapLocation&&Number.isFinite(pin.mapLocation.latitude)&&Number.isFinite(pin.mapLocation.longitude)),next:[...(plan?.slice(4) ?? []),...result.data.next]};
    storePositions(search,page,!!plan,bounds);
    return page;
}
export function filterExternalMapPins(pins: MapPostPin[], bounds: MapBounds): MapPostPin[] {
    return pins.filter(pin => pin.mapLocation && mapBoundsContain(bounds,pin.mapLocation));
}

export type ExternalMapPostDetail={id:string;originalUrl:string;createdAt:string;content:string;author:{displayName:string;avatarUrl:string}};
export async function getExternalMapPostDetail(id:string):Promise<ExternalMapPostDetail|null>{
 if(!/^flickr:\d+@N\d+\/\d+$/.test(id))return null;
 const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'map-geo-detail',id}}));
 if(result.error)return null;return result.data?.post??null;
}
