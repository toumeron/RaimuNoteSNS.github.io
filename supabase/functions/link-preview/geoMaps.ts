import {mapBoundsContain,validMapLocation,type MapBounds,type MapPostPin} from '../../../src/lib/mapLocation.ts';
export type GeoMapJob={provider:'flickr';bounds:MapBounds;search:string;page:number;from:number;until:number};
const checkBounds=(b:MapBounds)=>b&&[b.south,b.north,b.west,b.east].every(Number.isFinite)&&b.south>=-90&&b.north<=90&&b.south<b.north&&Math.abs(b.west)<=180&&Math.abs(b.east)<=180&&b.west!==b.east;
export function geoMapJobs(bounds:MapBounds,search=''):GeoMapJob[]{
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
export async function loadGeoMapPins(input:unknown,key:string|undefined,reader:typeof fetch=fetch){
 if(!Array.isArray(input)||input.length>4)throw new Error('Invalid geo map jobs');
 const jobs=input as GeoMapJob[];
 for(const j of jobs)if(j?.provider!=='flickr'||!checkBounds(j.bounds)||typeof j.search!=='string'||j.search.length>100||!Number.isInteger(j.page)||j.page<1||j.page>16||!Number.isInteger(j.from)||!Number.isInteger(j.until)||j.from<1||j.until<j.from||j.until>Math.floor(Date.now()/1000)+60)throw new Error('Invalid geo map job');
 if(!key)return {schema:'geo-v1',configured:false,pins:[],next:[]};
 const pins:MapPostPin[]=[],next:GeoMapJob[]=[];
 for(const job of jobs){
  const b=job.bounds;
  const data=await readFlickr({method:'flickr.photos.search',bbox:`${b.west},${b.south},${b.east},${b.north}`,has_geo:'1',extras:'geo,date_upload',per_page:'250',page:String(job.page),min_upload_date:String(job.from),max_upload_date:String(job.until),sort:'date-posted-desc',safe_search:'1',...(job.search?{text:job.search}:{})},key,reader);
  const photos=data.photos;
  // Flickr caps a search at 4,000 results. Split the actual upload-time range
  // before pagination so earlier posts aren't silently cut off.
  if(Number(photos?.total)>4000&&job.from<job.until){const mid=Math.floor((job.from+job.until)/2);next.push({...job,page:1,until:mid},{...job,page:1,from:mid+1});continue;}
  for(const row of photos?.photo??[]){
   const mapLocation={latitude:Number(row.latitude),longitude:Number(row.longitude)};
   if(row.ispublic!==1||Number(row.accuracy)<=0||!Number.isFinite(Number(row.accuracy))||!validMapLocation(mapLocation)||!mapBoundsContain(b,mapLocation)||!/^\d+$/.test(String(row.id))||!/^\d+@N\d+$/.test(String(row.owner)))continue;
   const time=Number(row.dateupload);if(!Number.isFinite(time)||time<=0)continue;
   pins.push({id:`flickr:${row.owner}/${row.id}`,source:'flickr',createdAt:new Date(time*1000).toISOString(),mapLocation});
  }
  if(job.page<Math.min(16,Number(photos?.pages)||0))next.push({...job,page:job.page+1});
 }
 return {schema:'geo-v1',configured:true,pins:[...new Map(pins.map(p=>[p.id,p])).values()],next};
}
export async function loadGeoMapDetail(id:unknown,key:string|undefined,reader:typeof fetch=fetch){
 if(typeof id!=='string'||!/^flickr:\d+@N\d+\/\d+$/.test(id))throw new Error('Invalid Flickr post');
 if(!key)return null;
 const [owner,photoId]=id.slice(7).split('/');
 const data=await readFlickr({method:'flickr.photos.getInfo',photo_id:photoId},key,reader),photo=data.photo;
 if(photo?.visibility?.ispublic!==1||photo.owner?.nsid!==owner||String(photo.id)!==photoId)return null;
 // Plain text only; do not execute the photo's HTML description.
 return {id,originalUrl:`https://www.flickr.com/photos/${owner}/${photoId}/`,createdAt:new Date(Number(photo.dates?.posted)*1000).toISOString(),content:String(photo.title?._content??''),author:{displayName:String(photo.owner?.realname||photo.owner?.username||'Flickr'),avatarUrl:''}};
}
