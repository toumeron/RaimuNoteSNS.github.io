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
