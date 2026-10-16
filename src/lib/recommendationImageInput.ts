/** CLIP reads 224 px. Fetching multi-megabyte originals adds no useful detail. */
export function recommendationThumbnailUrl(raw:string):string|null{
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
export async function prepareRecommendationImage(raw:string,signal?:AbortSignal):Promise<{url:string;release:()=>void}>{
 if(signal?.aborted)throw signal.reason;
 return {url:recommendationThumbnailUrl(raw)??raw,release:()=>{}};
}
