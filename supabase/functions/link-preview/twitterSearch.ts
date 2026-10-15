const cache=new Map<string,{until:number;ids:string[];total:number}>();
export function parseTwitterSearchPage(html:string):{ids:string[];total:number}{
 const json=html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
 if(!json)throw new Error('Search data missing');
 const page=JSON.parse(json)?.props?.pageProps?.pageData;
 if(page?.status!==200||!Array.isArray(page?.timeline?.entry))throw new Error('Search unavailable');
 const ids=[...new Set<string>(page.timeline.entry.map((row:{id?:unknown})=>row.id).filter((id:unknown):id is string=>typeof id==='string'&&/^\d{2,20}$/.test(id)))];
 return {ids,total:Math.max(ids.length,Number(page.timeline.head?.totalResultsAvailable)||0)};
}
export async function loadTwitterSearch(query:unknown,feed:unknown,offset:unknown){
 if(typeof query!=='string'||!query.trim()||query.length>500)throw new Error('Invalid query');
 if(!['latest','top','media'].includes(String(feed)))throw new Error('Invalid feed');
 if(typeof offset!=='number'||!Number.isInteger(offset)||offset<0||offset>1000)throw new Error('Invalid cursor');
 const block=Math.floor(offset/40)*40,key=JSON.stringify([query,feed,block]);
 let saved=cache.get(key);
 if(!saved||saved.until<Date.now()){
  const params=new URLSearchParams({p:query,ei:'UTF-8',b:String(block)});if(feed==='top')params.set('md','h');
  const response=await fetch(`https://search.yahoo.co.jp/realtime/search?${params}`,{headers:{Accept:'text/html'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`Search HTTP ${response.status}`);
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty search');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024)throw new Error('Search too large');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  saved={until:Date.now()+60000,...parseTwitterSearchPage(new TextDecoder().decode(bytes))};
  if(cache.size>=30)cache.delete(cache.keys().next().value!);cache.set(key,saved);
 }
 const local=offset-block,ids=saved.ids.slice(local,local+6),next=offset+ids.length;
 return {ids,cursor:ids.length&&next<Math.min(saved.total,1000)&&(local+ids.length<saved.ids.length||saved.ids.length===40)?next:null};
}
