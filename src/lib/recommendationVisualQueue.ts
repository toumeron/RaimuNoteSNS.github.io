

// recommendationVisualQueue
/** Fetch a few images concurrently, but keep the model and decoded pixels serial. */
function createRecommendationVisualQueue<Context,Input,Prepared,Output>(options:{
 load:()=>Promise<Context>;
 prepare:(input:Input)=>Promise<Prepared>;
 infer:(context:Context,prepared:Prepared,input:Input)=>Promise<Output>;
 capacity?:number;
}){
 const capacity=options.capacity??3;
 let active=0,tail:Promise<unknown>=Promise.resolve();
 const waiting:Array<()=>void>=[];
 const acquire=()=>new Promise<void>(resolve=>{
  const start=()=>{active++;resolve();};
  if(active<capacity)start();else waiting.push(start);
 });
 return async(input:Input):Promise<Output>=>{
  await acquire();
  try{
   // Model initialization and image/PDS reads do not depend on each other.
   const [context,prepared]=await Promise.all([options.load(),options.prepare(input)]);
   const result=tail.then(()=>options.infer(context,prepared,input));
   tail=result.catch(()=>{});
   return await result;
  }finally{active--;waiting.shift()?.();}
 };
}

// recommendationImageInput
/** CLIP reads 224 px. Fetching multi-megabyte originals adds no useful detail. */
function recommendationThumbnailUrl(raw:string):string|null{
 try{
  const url=new URL(raw);
  if(url.protocol!=='https:')return null;
  if(url.hostname==='cdn.bsky.app'&&/^\/img\/feed_(fullsize|thumbnail)\/plain\//.test(url.pathname)){
   url.pathname=url.pathname.replace('/feed_fullsize/','/feed_thumbnail/');return url.href;
  }
  if(url.hostname==='pbs.twimg.com'&&url.pathname.startsWith('/media/')){url.searchParams.set('name','small');return url.href;}
 }catch{/* Other media keep their existing reader. */}
 return null;
}

/** Public pixels never consume the URL-preview/search quota. The worker reads
 * Bluesky blobs from the creator's public PDS when the CDN lacks CORS. */
async function prepareRecommendationImage(raw:string,signal?:AbortSignal):Promise<{url:string;release:()=>void}>{
 if(signal?.aborted)throw signal.reason;
 return {url:recommendationThumbnailUrl(raw)??raw,release:()=>{}};
}

export { createRecommendationVisualQueue };
export { recommendationThumbnailUrl };
export { prepareRecommendationImage };
