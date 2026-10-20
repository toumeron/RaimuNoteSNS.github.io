import { validMapLocation } from "./../../../src/lib/mapLocation.ts";
import type { MapPostPin } from "./../../../src/lib/mapLocation.ts";
import type { MapBounds } from "./../../../src/lib/mapLocation.ts";
import { inferPostPlace } from "./places.ts";
import { mapPlaceSearchTerms } from "./places.ts";
import { loadMisskey } from "./load.ts";
import { mapBoundsContain } from "./../../../src/lib/mapLocation.ts";

// maps
type Job = { provider: 'bluesky' | 'misskey'; query: string; cursor?: string };
const cache = new Map<string, { expires: number; value: { pins: MapPostPin[]; next: Job[] } }>();
function mapSearchJobs(bounds: unknown, search: unknown = ''): Job[] {
    const area=bounds as MapBounds;
    if(!area || ![area.south,area.north,area.west,area.east].every(Number.isFinite) || area.south < -90 || area.north > 90 || area.south > area.north || Math.abs(area.west)>180 || Math.abs(area.east)>180 || typeof search!=='string' || search.length>100)throw new Error('Invalid map bounds');
    const term=search.trim();
    const queries=[...new Set(mapPlaceSearchTerms(area).map(query=>term?`${query} ${term}`:query).concat(term?[term]:[]).map(query=>query.slice(0,100)))];
    return queries.flatMap(query=>[{provider:'bluesky' as const,query},{provider:'misskey' as const,query}]);
}
async function loadMapPins(input: unknown, reader: typeof fetch = fetch) {
    if (!Array.isArray(input) || input.length > 4) throw new Error('Invalid map searches');
    const jobs: Job[] = input.map(job => {
        if (!job || !['bluesky','misskey'].includes(job.provider) || typeof job.query !== 'string' || !job.query.trim() || job.query.length > 100 ||
            (job.cursor !== undefined && (typeof job.cursor !== 'string' || job.cursor.length > 512))) throw new Error('Invalid map search');
        return { provider: job.provider, query: job.query, ...(job.cursor ? { cursor: job.cursor } : {}) };
    });
    const key = JSON.stringify(jobs), stored = cache.get(key);
    if (stored && stored.expires > Date.now()) return stored.value;
    const pins: MapPostPin[] = [], next: Job[] = [];
    const results = await Promise.allSettled(jobs.map(async job => {
        let rows: any[], cursor: string | undefined;
        if (job.provider === 'bluesky') {
            const params = new URLSearchParams({ q: job.query, limit: '100', sort: 'latest' });
            if (job.cursor) params.set('cursor', job.cursor);
            let response: Response | undefined;
            for (const host of ['api.bsky.app','public.api.bsky.app']) {
                try { response = await reader(`https://${host}/xrpc/app.bsky.feed.searchPosts?${params}`, { signal: AbortSignal.timeout(15000) }); if(response.ok)break; } catch { /* Try the other official reader. */ }
            }
            if (!response?.ok) throw new Error(`Bluesky search ${response?.status ?? 'unavailable'}`);
            const data = await response.json(); rows = data.posts ?? []; cursor = data.cursor;
        } else {
            rows = await loadMisskey('notes/search', { query: job.query, limit: 100, ...(job.cursor ? { untilId: job.cursor } : {}) }) as any[];
            cursor = rows.length === 100 ? rows.at(-1)?.id : undefined;
        }
        if (cursor && cursor !== job.cursor) next.push({ ...job, cursor });
        for (const row of rows) {
            if (job.provider === 'misskey' && row.visibility !== 'public') continue;
            const point = inferPostPlace(job.provider === 'bluesky' ? row.record?.text ?? '' : row.text ?? '');
            const id = job.provider === 'bluesky' ? (typeof row.uri === 'string' && /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/]+$/.test(row.uri) ? `bsky:${row.uri}` : null) : (typeof row.id === 'string' && /^[A-Za-z0-9]+$/.test(row.id) ? `misskey:https://misskey.io/notes/${row.id}` : null);
            if (!point || !validMapLocation(point) || !id) continue;
            pins.push({ id, createdAt: job.provider === 'bluesky' ? row.record?.createdAt ?? row.indexedAt : row.createdAt, source: job.provider, mapLocation: point });
        }
    }));
    if (jobs.length && results.every(result => result.status === 'rejected')) throw new Error('Map providers unavailable');
    const value = { pins: [...new Map(pins.map(pin => [pin.id, pin])).values()], next };
    // Cache only position/ID projections, never post bodies or images.
    if (results.every(result => result.status === 'fulfilled')) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now()+300000, value });
    }
    return value;
}

// geoMaps
type GeoMapJob={provider:'flickr';bounds:MapBounds;search:string;page:number;from:number;until:number};
function flickrAvatarUrl(owner:string,server:unknown,farm:unknown):string {
 const iconServer=String(server??''),iconFarm=String(farm??'');
 return /^\d+@N\d+$/.test(owner)&&/^[1-9]\d*$/.test(iconServer)&&/^\d+$/.test(iconFarm)?`https://farm${iconFarm}.staticflickr.com/${iconServer}/buddyicons/${owner}.jpg`:'https://www.flickr.com/images/buddyicon.gif';
}
const checkBounds=(b:MapBounds)=>b&&[b.south,b.north,b.west,b.east].every(Number.isFinite)&&b.south>=-90&&b.north<=90&&b.south<b.north&&Math.abs(b.west)<=180&&Math.abs(b.east)<=180&&b.west!==b.east;
function geoMapJobs(bounds:MapBounds,search=''):GeoMapJob[]{
 if(!checkBounds(bounds)||typeof search!=='string'||search.length>100)throw new Error('Invalid geo map bounds');
 const areas=bounds.west>bounds.east?[{...bounds,east:180},{...bounds,west:-180}]:[bounds];
 return areas.map(bounds=>({provider:'flickr',bounds,search,page:1,from:1,until:Math.floor(Date.now()/1000)}));
}
async function readFlickr(params:Record<string,string>,key:string,reader:typeof fetch){
 const url=new URL('https://api.flickr.com/services/rest/');
 url.search=new URLSearchParams({...params,api_key:key,format:'json',nojsoncallback:'1'}).toString();
 const response=await reader(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw new Error('Flickr unavailable');
 const data=await response.json();if(data.stat!=='ok')throw new Error('Flickr request failed');return data;
}
async function loadGeoMapPins(input:unknown,key:string|undefined,reader:typeof fetch=fetch){
 if(!Array.isArray(input)||input.length>4)throw new Error('Invalid geo map jobs');
 const jobs=input as GeoMapJob[];
 for(const j of jobs)if(j?.provider!=='flickr'||!checkBounds(j.bounds)||typeof j.search!=='string'||j.search.length>100||!Number.isInteger(j.page)||j.page<1||j.page>16||!Number.isInteger(j.from)||!Number.isInteger(j.until)||j.from<1||j.until<j.from||j.until>Math.floor(Date.now()/1000)+60)throw new Error('Invalid geo map job');
 if(!key)return {schema:'geo-v1',configured:false,pins:[],next:[]};
 const pins:MapPostPin[]=[],next:GeoMapJob[]=[];
 for(const job of jobs){
  const b=job.bounds;
  const data=await readFlickr({method:'flickr.photos.search',bbox:`${b.west},${b.south},${b.east},${b.north}`,has_geo:'1',extras:'geo,date_upload,owner_name,icon_server',per_page:'250',page:String(job.page),min_upload_date:String(job.from),max_upload_date:String(job.until),sort:'date-posted-desc',safe_search:'1',...(job.search?{text:job.search}:{})},key,reader);
  const photos=data.photos;
  // Flickr caps a search at 4,000 results. Split the actual upload-time range
  // before pagination so earlier posts aren't silently cut off.
  if(Number(photos?.total)>4000&&job.from<job.until){const mid=Math.floor((job.from+job.until)/2);next.push({...job,page:1,until:mid},{...job,page:1,from:mid+1});continue;}
  for(const row of photos?.photo??[]){
   const mapLocation={latitude:Number(row.latitude),longitude:Number(row.longitude)};
   if(row.ispublic!==1||Number(row.accuracy)<=0||!Number.isFinite(Number(row.accuracy))||!validMapLocation(mapLocation)||!mapBoundsContain(b,mapLocation)||!/^\d+$/.test(String(row.id))||!/^\d+@N\d+$/.test(String(row.owner)))continue;
   const time=Number(row.dateupload);if(!Number.isFinite(time)||time<=0)continue;
   pins.push({id:`flickr:${row.owner}/${row.id}`,source:'flickr',createdAt:new Date(time*1000).toISOString(),author:{displayName:String(row.ownername||'Flickr'),avatarUrl:flickrAvatarUrl(String(row.owner),row.iconserver,row.iconfarm)},mapLocation});
  }
  if(job.page<Math.min(16,Number(photos?.pages)||0))next.push({...job,page:job.page+1});
 }
 return {schema:'geo-v1',configured:true,pins:[...new Map(pins.map(p=>[p.id,p])).values()],next};
}
async function loadGeoMapDetail(id:unknown,key:string|undefined,reader:typeof fetch=fetch){
 if(typeof id!=='string'||!/^flickr:\d+@N\d+\/\d+$/.test(id))throw new Error('Invalid Flickr post');
 if(!key)return null;
 const [owner,photoId]=id.slice(7).split('/');
 const data=await readFlickr({method:'flickr.photos.getInfo',photo_id:photoId},key,reader),photo=data.photo;
 if(photo?.visibility?.ispublic!==1||photo.owner?.nsid!==owner||String(photo.id)!==photoId)return null;
 // Plain text only; do not execute the photo's HTML description.
 return {id,originalUrl:`https://www.flickr.com/photos/${owner}/${photoId}/`,createdAt:new Date(Number(photo.dates?.posted)*1000).toISOString(),content:String(photo.title?._content??''),author:{displayName:String(photo.owner?.realname||photo.owner?.username||'Flickr'),avatarUrl:flickrAvatarUrl(owner,photo.owner?.iconserver,photo.owner?.iconfarm)}};
}

export { mapSearchJobs };
export { loadMapPins };
export { flickrAvatarUrl };
export { geoMapJobs };
export { loadGeoMapPins };
export { loadGeoMapDetail };
export type { GeoMapJob };
