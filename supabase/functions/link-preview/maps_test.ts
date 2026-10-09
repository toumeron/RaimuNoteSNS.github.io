import {loadMapPins,mapSearchJobs} from './maps.ts';
import {inferPostPlace} from './places.ts';
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
