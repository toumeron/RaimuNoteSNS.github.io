import {page} from './http.ts';
import {metadata,publicUrl,type LinkPreview} from './metadata.ts';

// Fixed-server API reader for clients whose cross-origin requests are blocked.
// This is a public-data reader; provider credentials and writes are never accepted.
export async function loadMisskey(endpoint:unknown, params:unknown):Promise<unknown> {
 const reads=['notes/local-timeline','notes/featured','notes/search','notes/show','notes/children','users/show','users/notes','users/search','users/following','users/followers'];
 if(typeof endpoint!=='string'||!reads.includes(endpoint))throw new Error('Unsupported Misskey endpoint');
 if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('Invalid Misskey parameters');
 const input=params as Record<string,unknown>,body:Record<string,unknown>={};
 for(const key of ['noteId','userId','untilId']){
  if(input[key]!==undefined){if(typeof input[key]!=='string'||!/^[a-zA-Z0-9-]{1,128}$/.test(input[key] as string))throw new Error('Invalid Misskey ID');body[key]=input[key];}
 }
 for(const key of ['query','username','host','origin']){
  if(input[key]!==undefined){if(input[key]!==null&&(typeof input[key]!=='string'||(input[key] as string).length>200))throw new Error('Invalid Misskey search');body[key]=input[key];}
 }
 if(input.limit!==undefined)body.limit=Math.min(100,Math.max(1,Number(input.limit)||30));
 if(input.i!==undefined)throw new Error('Misskey credentials are not supported');
 const response=await fetch(`https://misskey.io/api/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
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
