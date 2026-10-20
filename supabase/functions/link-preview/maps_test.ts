import { loadMapPins } from "./maps.ts";
import { mapSearchJobs } from "./maps.ts";
import { inferPostPlace } from "./places.ts";
import { geoMapJobs } from "./maps.ts";
import { loadGeoMapPins } from "./maps.ts";
import { loadGeoMapDetail } from "./maps.ts";
import { flickrAvatarUrl } from "./maps.ts";

{
const assert=(value:unknown)=>{if(!value)throw new Error('Assertion failed');};
Deno.test('searches Kanto place names broadly, with no URL queries or date limit',async()=>{
 const jobs=mapSearchJobs({south:34.9,north:37,west:138.4,east:141});
 assert(jobs.length>=40);for(const name of ['東京','神奈川','埼玉','千葉','渋谷','新宿','池袋','横浜'])assert(jobs.some(job=>job.query===name));
 assert(!jobs.some(job=>/maps\.|geo:|google|openstreetmap/.test(job.query)));
 let requested='';
 const reader=async(input:RequestInfo|URL)=>{requested=String(input);return Response.json({posts:[{uri:'at://did:plc:map/app.bsky.feed.post/city-test',record:{text:'渋谷に来ました',createdAt:'2026-10-10T00:00:00Z'},author:{displayName:'not forwarded'},embed:{images:[{fullsize:'not forwarded'}]}}],cursor:'next-map-test'});};
 const result=await loadMapPins([{provider:'bluesky',query:'渋谷-test'}],reader as typeof fetch);
 assert(result.pins.length===1);assert(Math.abs(result.pins[0].mapLocation.latitude-35.658)<.01);
 assert(Object.keys(result.pins[0]).sort().join(',')==='createdAt,id,mapLocation,source');
 assert(result.next[0].cursor==='next-map-test');const url=new URL(requested);assert(url.searchParams.get('limit')==='100');assert(!url.searchParams.has('since'));
});
Deno.test('ignores coordinates and names occurring only inside URLs, embeds, or quotes',async()=>{
 assert(inferPostPlace('geo:35.68,139.76 https://maps.google.com/?q=東京')===null);
 assert(inferPostPlace('https://example.com/渋谷')===null);
 assert(inferPostPlace('福山雅治さん')===null);
 const reader=async()=>Response.json({posts:[{uri:'at://did:plc:map/app.bsky.feed.post/no-text-place',record:{text:'地震速報 https://maps.google.com/?q=35.68,139.76',createdAt:'2026-10-10T00:00:00Z'},embed:{external:{title:'東京',uri:'https://maps.google.com/?q=35,139'}}}]});
 const result=await loadMapPins([{provider:'bluesky',query:'ignore-urls-test'}],reader as typeof fetch);assert(result.pins.length===0);
});
Deno.test('recognises named locations without coordinates',()=>{
 for(const name of ['東京駅','横浜','渋谷','新宿','池袋','さいたま','千葉市'])assert(inferPostPlace(`${name}に来ました`));
 assert(inferPostPlace('今日は東京 https://maps.google.com/?q=34,135')===null);
});
Deno.test('rejects invalid map jobs and suppresses an unchanged cursor',async()=>{
 let rejected=false;try{await loadMapPins([{provider:'other',query:'x'}]);}catch{rejected=true;}assert(rejected);
 const reader=async()=>Response.json({posts:[],cursor:'same-cursor'});
 const result=await loadMapPins([{provider:'bluesky',query:'cursor-test',cursor:'same-cursor'}],reader as typeof fetch);assert(result.next.length===0);
});
Deno.test('falls back between the official Bluesky search readers',async()=>{
 const hosts:string[]=[];const reader=async(input:RequestInfo|URL)=>{hosts.push(new URL(String(input)).hostname);return hosts.length===1?new Response(null,{status:403}):Response.json({posts:[]});};
 await loadMapPins([{provider:'bluesky',query:'reader-fallback-test'}],reader as typeof fetch);
 assert(hosts.join(',')==='api.bsky.app,public.api.bsky.app');
});

Deno.test('prefers a specific place over the first regional or larger city mention',()=>{
 const shibuya=inferPostPlace('東京で遊んできた。今日は渋谷に来ました')!;
 assert(Math.abs(shibuya.latitude-35.658)<.01);
 const yokohama=inferPostPlace('神奈川県の横浜市に来ました')!;
 assert(Math.abs(yokohama.latitude-35.433)<.02);
 const shinjuku=inferPostPlace('東京都新宿区でランチ')!;
 assert(Math.abs(shinjuku.latitude-35.691)<.01);
});

Deno.test('places Tokyo Station at the real station and never invents a point for Tokyo alone',()=>{
 const station=inferPostPlace('東京都の東京駅で待ち合わせ')!;
 assert(Math.abs(station.latitude-35.68113)<.00001);assert(Math.abs(station.longitude-139.76706)<.00001);
 for(const text of ['東京に来ました','東京都','in Tokyo','神奈川県で旅行','https://example.com/東京駅'])assert(inferPostPlace(text)===null);
 assert(inferPostPlace('Tokyo Station')!.longitude===station.longitude);
 assert(mapSearchJobs({south:35.6,north:35.8,west:139.6,east:139.9}).some(job=>job.query==='東京駅'));
});
}

{
const geoMapsTestAssert=(value:unknown)=>{if(!value)throw new Error('Assertion failed');};
const bounds={south:35,north:36,west:139,east:140};
Deno.test('uses only provider coordinates, not place names, titles, or URLs',async()=>{
 let params:URLSearchParams|undefined;
 const reader=async(input:RequestInfo|URL)=>{params=new URL(String(input)).searchParams;return Response.json({stat:'ok',photos:{page:1,pages:2,total:251,photo:[{id:'1',owner:'123@N00',ispublic:1,latitude:'35.68113',longitude:'139.76706',accuracy:16,dateupload:'1700000000',title:'皇居'}, {id:'2',owner:'123@N00',ispublic:1,title:'東京駅',dateupload:'1700000000'}, {id:'3',owner:'123@N00',ispublic:0,latitude:'35.68',longitude:'139.76',accuracy:16,dateupload:'1700000000'}]}});};
 const result=await loadGeoMapPins(geoMapJobs(bounds),'test-key',reader as typeof fetch);
 geoMapsTestAssert(result.pins.length===1);geoMapsTestAssert(result.pins[0].mapLocation.longitude===139.76706);
 geoMapsTestAssert(Object.keys(result.pins[0]).sort().join(',')==='author,createdAt,id,mapLocation,source');
 geoMapsTestAssert(params!.get('has_geo')==='1');geoMapsTestAssert(params!.get('bbox')==='139,35,140,36');geoMapsTestAssert(params!.get('per_page')==='250');geoMapsTestAssert(params!.get('extras')==='geo,date_upload,owner_name,icon_server');geoMapsTestAssert(params!.get('min_upload_date')==='1');
 geoMapsTestAssert(result.next[0].page===2);
});
Deno.test('does not fall back to inferred posts without an API key',async()=>{
 let called=false;const result=await loadGeoMapPins(geoMapJobs(bounds),undefined,(async()=>{called=true;return Response.json({});}) as typeof fetch);
 geoMapsTestAssert(!called&&result.configured===false&&result.pins.length===0&&result.next.length===0);
});
Deno.test('splits historical upload intervals rather than cutting results at 4000',async()=>{
 const jobs=geoMapJobs(bounds);jobs[0].from=100;jobs[0].until=200;
 const result=await loadGeoMapPins(jobs,'test-key',(async()=>Response.json({stat:'ok',photos:{total:5000,pages:20,photo:[]}})) as typeof fetch);
 geoMapsTestAssert(result.next.length===2);geoMapsTestAssert(result.next[0].from===100&&result.next[0].until===150);geoMapsTestAssert(result.next[1].from===151&&result.next[1].until===200);
});
Deno.test('rejects legacy provider jobs and splits date-line bounds',async()=>{
 let rejected=false;try{await loadGeoMapPins([{provider:'bluesky',query:'東京'}],'test-key');}catch{rejected=true;}geoMapsTestAssert(rejected);
 geoMapsTestAssert(geoMapJobs({...bounds,west:170,east:-170}).length===2);
});
Deno.test('loads details separately and only for public photos',async()=>{
 const reader=(async()=>Response.json({stat:'ok',photo:{id:'456',owner:{nsid:'123@N00',username:'photographer'},visibility:{ispublic:1},title:{_content:'Tokyo Station'},dates:{posted:'1700000000'}}})) as typeof fetch;
 const detail=await loadGeoMapDetail('flickr:123@N00/456','test-key',reader);
 geoMapsTestAssert(detail?.originalUrl==='https://www.flickr.com/photos/123@N00/456/');geoMapsTestAssert(detail?.author.displayName==='photographer');
 const privateReader=(async()=>Response.json({stat:'ok',photo:{visibility:{ispublic:0}}})) as typeof fetch;
 geoMapsTestAssert(await loadGeoMapDetail('flickr:123@N00/456','test-key',privateReader)===null);
});

Deno.test('constructs public owner icons without detail requests or unsafe URL fields',()=>{
 geoMapsTestAssert(flickrAvatarUrl('123@N00','42',1)==='https://farm1.staticflickr.com/42/buddyicons/123@N00.jpg');
 geoMapsTestAssert(flickrAvatarUrl('123@N00','0',0)==='https://www.flickr.com/images/buddyicon.gif');
 geoMapsTestAssert(flickrAvatarUrl('bad/owner','42','evil.example')==='https://www.flickr.com/images/buddyicon.gif');
});
}
