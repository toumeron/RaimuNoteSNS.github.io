import {geoMapJobs,loadGeoMapPins,loadGeoMapDetail} from './geoMaps.ts';
const assert=(value:unknown)=>{if(!value)throw new Error('Assertion failed');};
const bounds={south:35,north:36,west:139,east:140};
Deno.test('uses only provider coordinates, not place names, titles, or URLs',async()=>{
 let params:URLSearchParams|undefined;
 const reader=async(input:RequestInfo|URL)=>{params=new URL(String(input)).searchParams;return Response.json({stat:'ok',photos:{page:1,pages:2,total:251,photo:[{id:'1',owner:'123@N00',ispublic:1,latitude:'35.68113',longitude:'139.76706',accuracy:16,dateupload:'1700000000',title:'皇居'}, {id:'2',owner:'123@N00',ispublic:1,title:'東京駅',dateupload:'1700000000'}, {id:'3',owner:'123@N00',ispublic:0,latitude:'35.68',longitude:'139.76',accuracy:16,dateupload:'1700000000'}]}});};
 const result=await loadGeoMapPins(geoMapJobs(bounds),'test-key',reader as typeof fetch);
 assert(result.pins.length===1);assert(result.pins[0].mapLocation.longitude===139.76706);
 assert(Object.keys(result.pins[0]).sort().join(',')==='createdAt,id,mapLocation,source');
 assert(params!.get('has_geo')==='1');assert(params!.get('bbox')==='139,35,140,36');assert(params!.get('per_page')==='250');assert(params!.get('extras')==='geo,date_upload');assert(params!.get('min_upload_date')==='1');
 assert(result.next[0].page===2);
});
Deno.test('does not fall back to inferred posts without an API key',async()=>{
 let called=false;const result=await loadGeoMapPins(geoMapJobs(bounds),undefined,(async()=>{called=true;return Response.json({});}) as typeof fetch);
 assert(!called&&result.configured===false&&result.pins.length===0&&result.next.length===0);
});
Deno.test('splits historical upload intervals rather than cutting results at 4000',async()=>{
 const jobs=geoMapJobs(bounds);jobs[0].from=100;jobs[0].until=200;
 const result=await loadGeoMapPins(jobs,'test-key',(async()=>Response.json({stat:'ok',photos:{total:5000,pages:20,photo:[]}})) as typeof fetch);
 assert(result.next.length===2);assert(result.next[0].from===100&&result.next[0].until===150);assert(result.next[1].from===151&&result.next[1].until===200);
});
Deno.test('rejects legacy provider jobs and splits date-line bounds',async()=>{
 let rejected=false;try{await loadGeoMapPins([{provider:'bluesky',query:'東京'}],'test-key');}catch{rejected=true;}assert(rejected);
 assert(geoMapJobs({...bounds,west:170,east:-170}).length===2);
});
Deno.test('loads details separately and only for public photos',async()=>{
 const reader=(async()=>Response.json({stat:'ok',photo:{id:'456',owner:{nsid:'123@N00',username:'photographer'},visibility:{ispublic:1},title:{_content:'Tokyo Station'},dates:{posted:'1700000000'}}})) as typeof fetch;
 const detail=await loadGeoMapDetail('flickr:123@N00/456','test-key',reader);
 assert(detail?.originalUrl==='https://www.flickr.com/photos/123@N00/456/');assert(detail?.author.displayName==='photographer');
 const privateReader=(async()=>Response.json({stat:'ok',photo:{visibility:{ispublic:0}}})) as typeof fetch;
 assert(await loadGeoMapDetail('flickr:123@N00/456','test-key',privateReader)===null);
});
