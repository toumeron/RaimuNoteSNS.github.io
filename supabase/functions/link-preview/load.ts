import rows from "./data/mapPlaces.json" with { type: "json" };
import stations from "./data/mapStations.json" with { type: "json" };
import { metadata, publicUrl, type LinkPreview, publicAddress } from "./metadata.ts";
import { validMapLocation, type MapPostPin, type MapLocation, type MapBounds, mapBoundsContain } from "../../../src/lib/mapLocation.ts";
import { lookup } from "node:dns/promises";

// load
// Fixed-server API reader for clients whose cross-origin requests are blocked.
// This is a public-data reader; provider credentials and writes are never accepted.
export async function loadMisskey(endpoint:unknown, params:unknown):Promise<unknown> {
 const reads=['notes/local-timeline','notes/featured','notes/search','notes/show','notes/children','notes/replies','users/show','users/notes','users/search','users/following','users/followers'];
 if(typeof endpoint!=='string'||!reads.includes(endpoint))throw new Error('Unsupported Misskey endpoint');
 if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('Invalid Misskey parameters');
 const input=params as Record<string,unknown>,body:Record<string,unknown>={};
 for(const key of ['noteId','userId','untilId']){
  if(input[key]!==undefined){if(typeof input[key]!=='string'||!/^[a-zA-Z0-9-]{1,128}$/.test(input[key] as string))throw new Error('Invalid Misskey ID');body[key]=input[key];}
 }
 for(const key of ['query','username','host','origin']){
  if(input[key]!==undefined){if(input[key]!==null&&(typeof input[key]!=='string'||(input[key] as string).length>200))throw new Error('Invalid Misskey search');body[key]=input[key];}
 }
 if(input.withFiles!==undefined){if(typeof input.withFiles!=='boolean')throw new Error('Invalid Misskey media filter');body.withFiles=input.withFiles;}
 if(input.withReplies!==undefined){if(typeof input.withReplies!=='boolean')throw new Error('Invalid Misskey reply filter');body.withReplies=input.withReplies;}
 if(input.limit!==undefined)body.limit=Math.min(100,Math.max(1,Number(input.limit)||30));
 if(input.i!==undefined)throw new Error('Misskey credentials are not supported');
 const response=await fetch(`https://misskey.io/api/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','User-Agent':'LimeNote/1.0'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 // A missing exact-handle candidate is an ordinary empty search result.
 if(endpoint==='users/show'&&response.status===404)return null;
 if(!response.ok)throw new Error(`Misskey API ${response.status}`);
 if(response.status===204)return null;
 const value=await response.json();
 // Do not return non-public notes, including nested quotes/replies, or private account fields.
 const userFields=['id','username','host','name','avatarUrl','bannerUrl','description','createdAt','followersCount','followingCount','notesCount','isBot','isFollowing'];
 const clean=(item:unknown):unknown=>{
  if(Array.isArray(item))return item.map(clean).filter(value=>value!==null);
  if(!item||typeof item!=='object')return item;
  const row=item as Record<string,unknown>;
  // Preserve an opaque ID for untilId pagination without forwarding private content.
  if(typeof row.visibility==='string'&&row.visibility!=='public')return {id:row.id,visibility:row.visibility};
  if(typeof row.username==='string')return Object.fromEntries(userFields.filter(key=>key in row).map(key=>[key,row[key]]));
  return Object.fromEntries(Object.entries(row).filter(([key])=>key!=='token'&&key!=='i').map(([key,value])=>[key,clean(value)]));
 };
 return clean(value);
}
export async function loadPreview(raw:string,readPage:typeof page=page):Promise<LinkPreview|null> {
  const original=publicUrl(raw).href;let url=publicUrl(original);const visited=new Set<string>();
  for(let redirects=0;redirects<=8;redirects++){
    if(visited.has(url.href))return null;visited.add(url.href);
    const amazon=/(^|\.)(amazon\.co\.jp|amzn\.asia)$/.test(url.hostname);
    const browserAgent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    let result=await readPage(url,amazon?browserAgent:undefined);
    if(amazon&&result.status>=400&&url.hostname!=='amzn.asia'){const asin=url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];if(asin){url=new URL('/gp/product/'+asin,url.origin);result=await readPage(url,browserAgent);}}
    if(result.status>=300&&result.status<400&&result.location){url=publicUrl(new URL(result.location,url).href);continue;}
    if(result.status!==200){if(result.status===404&&!amazon)return null;throw new Error('Page HTTP '+result.status);}
    // Some shorteners use HTML refresh instead of an HTTP Location header.
    const refresh=result.html.match(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i)?.[0];
    const target=refresh?.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const content=target?.[1]??target?.[2];
    const destination=content?.match(/^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*(.*?)\s*$/i)?.[1]?.replace(/^["']|["']$/g,'');
    if(destination){const next=publicUrl(new URL(destination.replace(/&amp;/gi,'&'),url).href);if(next.href!==url.href){url=next;continue;}}
    let preview=metadata(result.html,url.href,original);
    if(/(^|\.)amazon\.co\.jp$/.test(url.hostname)&&(!preview?.image||/^Amazon\.co\.jp\s*$/i.test(preview.title))){
      const asin=url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];
      if(asin){
        // Product pages have different layouts on the desktop and mobile storefronts.
        for(const path of ['/dp/'+asin,'/gp/aw/d/'+asin]){
          const canonical=new URL(path,url.origin);
          const retry=await readPage(canonical,browserAgent);
          if(retry.status!==200)continue;
          const improved=metadata(retry.html,canonical.href,original);
          if(improved?.image){preview=improved;break;}
          if(improved&&!/^Amazon\.co\.jp\s*$/i.test(improved.title))preview=improved;
        }
      }
      if(!preview||/^Amazon\.co\.jp\s*$/i.test(preview.title))throw new Error('Amazon product unavailable');
    }
    return preview;
  }
  return null;
}

export function allowedImage(raw:string,storageHost:string):URL{
 const url=publicUrl(raw);
 const platform=/^(?:res\.cloudinary\.com|cdn\.bsky\.app|video\.bsky\.app|(?:media|proxy)\.misskeyusercontent\.jp|pbs\.twimg\.com|melonbooks\.akamaized\.net|media\d*\.tenor\.com|media\.tenor\.com|m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-fe\.ssl-images-amazon\.com)$/i.test(url.hostname);
 if(url.protocol!=='https:'||(!platform&&!(url.hostname===storageHost&&url.pathname.startsWith('/storage/v1/object/'))))throw new Error('Unsupported image host');
 return url;
}
export async function loadImage(raw:string,storageHost:string):Promise<Blob>{
 let url=allowedImage(raw,storageHost);
 for(let redirects=0;redirects<=3;redirects++){
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Accept:'image/*'}});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)break;url=allowedImage(new URL(location,url).href,storageHost);continue;}
  const type=response.headers.get('content-type')??'';
  if(!response.ok||!type.startsWith('image/')||!response.body){await response.body?.cancel();throw new Error('Image unavailable');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16*1024*1024)throw new Error('Image too large');chunks.push(value);}}finally{await reader.cancel();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  return new Blob([buffer],{type});
 }
 throw new Error('Image redirect limit');
}


// bluesky
const endpoints=new Set(['app.bsky.feed.searchPosts','app.bsky.actor.searchActors','app.bsky.actor.searchActorsTypeahead']);
/** Public, read-only searches on one fixed AppView; no provider credentials or arbitrary URLs. */
export async function loadBlueskySearch(endpoint:unknown,params:unknown):Promise<unknown>{
 if(typeof endpoint!=='string'||!endpoints.has(endpoint))throw new Error('Unsupported Bluesky endpoint');
 if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('Invalid Bluesky parameters');
 const input=params as Record<string,unknown>,query=new URLSearchParams();
 const allowed=new Set(['q','limit','cursor','sort','lang','author','mentions','since','until','tag','url','domain']);
 for(const [key,value]of Object.entries(input)){
  if(!allowed.has(key)||typeof value!=='string'||value.length>1000)throw new Error('Invalid Bluesky parameter');
  if(key==='limit'&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>100))throw new Error('Invalid Bluesky limit');
  if(key==='sort'&&!['top','latest'].includes(value))throw new Error('Invalid Bluesky sort');
  query.set(key,value);
 }
 if(!query.get('q')?.trim())throw new Error('Bluesky query required');
 const response=await fetch(`https://api.bsky.app/xrpc/${endpoint}?${query}`,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`Bluesky API ${response.status}`);
 if(!response.body)throw new Error('Empty Bluesky response');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new Error('Bluesky response too large');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}


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


// http
const LIMIT=1_500_000;
export function decodeHttp(bytes:Uint8Array,truncated=false):{status:number;location?:string;html:string} {
  const text=new TextDecoder('latin1').decode(bytes),end=text.indexOf('\r\n\r\n');
  if(end<0)throw new Error('Invalid HTTP response');
  const head=text.slice(0,end),status=Number(head.match(/^HTTP\/1\.[01] (\d+)/)?.[1]);
  const headers=new Map(head.split('\r\n').slice(1).map(line=>{const colon=line.indexOf(':');return [line.slice(0,colon).toLowerCase(),line.slice(colon+1).trim()];}));
  if(status!==200||!/text\/html|application\/xhtml\+xml/i.test(headers.get('content-type')??''))return {status,location:headers.get('location'),html:''};
  let body=bytes.slice(end+4);
  if(/chunked/i.test(headers.get('transfer-encoding')??'')){
    const parts:Uint8Array[]=[];let cursor=0,total=0;
    while(cursor<body.length){
      let boundary=cursor;while(boundary<body.length-1&&!(body[boundary]===13&&body[boundary+1]===10))boundary++;
      const length=parseInt(new TextDecoder().decode(body.slice(cursor,boundary)).split(';')[0],16);
      if(!Number.isFinite(length)||length<0)throw new Error('Invalid HTTP chunks');
      if(boundary+2+length>body.length){if(!truncated)throw new Error('Invalid HTTP chunks');const tail=body.slice(boundary+2);parts.push(tail);total+=tail.length;break;}
      if(length===0)break;
      parts.push(body.slice(boundary+2,boundary+2+length));total+=length;cursor=boundary+2+length+2;
    }
    body=new Uint8Array(total);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}
  }
  return {status,html:new TextDecoder().decode(body)};
}
// Connect to the validated address, then validate TLS against the original host.
// Supabase's Node HTTP shim does not implement custom DNS lookup callbacks.
export async function page(url:URL,userAgent="Mozilla/5.0 (compatible; LimeNote/1.0)"):Promise<{status:number;location?:string;html:string}> {
  let dnsTimer:ReturnType<typeof setTimeout>|undefined;
  const addresses=await Promise.race([lookup(url.hostname,{all:true}),new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('Timeout')),10000);})]).finally(()=>clearTimeout(dnsTimer));
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('Private address');
  // These domains are operated by the platforms themselves, with no user-managed DNS.
  // Use the platform HTTP stack for their HTTP/2 compatibility; redirects remain manual.
  if(/(^|\.)(pixiv\.net|booth\.pm|fanbox\.cc)$/.test(url.hostname)){
    const response=await fetch(url,{headers:{'User-Agent':userAgent,'Accept':'text/html,application/xhtml+xml','Accept-Language':'ja-JP,ja;q=0.9,en;q=0.5'},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(response.status!==200||!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();return {status:response.status,location:response.headers.get('location')??undefined,html:''};}
    const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;const part=value.subarray(0,LIMIT-size);chunks.push(part);size+=part.length;if(size>=LIMIT)break;}}finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {status:200,html:new TextDecoder().decode(bytes)};
  }
  let connection:Deno.Conn|undefined;
  let finished=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const operation=(async()=>{
    const tcp=await Deno.connect({hostname:addresses[0].address,port:Number(url.port||(url.protocol==='https:'?443:80))});
    // A TCP connect can finish after Promise.race already timed out. Close that
    // late socket instead of starting unbounded work without a deadline timer.
    if(finished){tcp.close();throw new Error('Timeout');}
    connection=tcp;
    if(url.protocol==='https:')connection=await Deno.startTls(tcp,{hostname:url.hostname});
    if(finished){connection.close();throw new Error('Timeout');}
    const message=new TextEncoder().encode(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: ${userAgent}\r\nAccept: text/html,application/xhtml+xml\r\nAccept-Encoding: identity\r\nAccept-Language: ja-JP,ja;q=0.9,en;q=0.5\r\nConnection: close\r\n\r\n`);
    let written=0;while(written<message.length)written+=await connection.write(message.subarray(written));
    const parts:Uint8Array[]=[];let length=0,truncated=false;
    while(true){const buffer=new Uint8Array(16384),count=await connection.read(buffer);if(count===null)break;const part=buffer.slice(0,Math.min(count,LIMIT-length));length+=part.length;parts.push(part);if(length>=LIMIT){truncated=true;break;}}
    const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return decodeHttp(bytes,truncated);
  })();
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{try{connection?.close();}catch{/* Closed */}reject(new Error('Timeout'));},10000);})]);}
  finally{finished=true;clearTimeout(timer);try{connection?.close();}catch{/* Closed */}}
}

// Place lookup shared by map readers.
type Place={name:string;point:MapLocation;population:number;country:string;aliases:string[];station?:boolean};
const places:Place[]=rows.map(([name,lat,lon,population,country,aliases])=>({name:String(name),point:{latitude:Number(lat),longitude:Number(lon)},population:Number(population),country:String(country),aliases:aliases as string[]}));
places.push(...stations.map(([name,latitude,longitude,aliases])=>({name:String(name),point:{latitude:Number(latitude),longitude:Number(longitude)},population:0,country:'JP',aliases:aliases as string[],station:true})));
const names=new Map<string,Place>();
for(const place of [...places].sort((a,b)=>b.population-a.population))for(const name of place.aliases)if(name.length>1&&!names.has(name.toLowerCase()))names.set(name.toLowerCase(),place);
let matcher:RegExp|undefined;
const regions=new Set(['東京','東京都','Tokyo','东京','神奈川','埼玉','千葉','茨城','栃木','群馬']);
export function inferPostPlace(text:string):MapLocation|null {
 // Never use URLs, attached pages, author profiles, or quoted posts as evidence.
 const plain=text.replace(/https?:\/\/[^\s<>]+|geo:[^\s<>]+/gi,' ').replace(/@[\w.:-]+/g,' ');
 matcher??=new RegExp([...names.keys()].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'giu');
 matcher.lastIndex=0;
 const candidates:{place:Place;specificity:number;index:number}[]=[];
 for(const match of plain.matchAll(matcher)){
  const name=match[0],before=plain.slice(0,match.index),after=plain.slice(match.index!+name.length);
  if(/^[a-z\s.'-]+$/i.test(name)){
   if(/[a-z]$/i.test(before)||/^[a-z]/i.test(after))continue;
   if(name===name.toLowerCase()&&!/(?:#|\b(?:in|at|from|to)\s+)$/i.test(before))continue;
  }else if(/^[一-龥]{2,}/.test(after)&&! /^(?:都|府|県|市|区|町|村|駅|空港|旅行|観光|出張|方面|到着|滞在)/.test(after))continue;
  const place=names.get(name.toLowerCase())!;
  const regional=(regions.has(place.name)||place.aliases.some(alias=>['東京','東京都','Tokyo'].includes(alias)))&&!/^市/.test(after)&&name!=='千葉市';
  if(regional)continue;
  // A city/district in the same sentence is more useful than its prefecture.
  candidates.push({place,specificity:place.station?2:1,index:match.index!});
 }
 if(!candidates.length)return null;
 candidates.sort((a,b)=>b.specificity-a.specificity || a.place.population-b.place.population || a.index-b.index);
 return candidates[0].place.point;
}
export function mapPlaceSearchTerms(bounds:MapBounds):string[] {
 const visible=places.filter(place=>mapBoundsContain(bounds,place.point));
 const kanto=['東京駅','新宿駅','渋谷駅','品川駅','上野駅','池袋駅','秋葉原駅','横浜駅','大宮駅','千葉駅','東京','神奈川','埼玉','千葉','茨城','栃木','群馬','渋谷','新宿','池袋','秋葉原','横浜','川崎','さいたま','船橋','八王子','町田','柏'];
 const priority=kanto.filter(name=>visible.some(place=>place.aliases.includes(name)));
 const remaining=visible.sort((a,b)=>b.population-a.population).map(place=>place.name);
 return [...new Set([...priority,...remaining])].slice(0,48);
}
