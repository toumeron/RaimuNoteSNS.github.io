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

/** Use the existing authenticated image reader for the public CDN's missing CORS header. */
export async function prepareRecommendationImage(raw:string,signal?:AbortSignal):Promise<{url:string;release:()=>void}>{
 const thumbnail=recommendationThumbnailUrl(raw);
 const fallback={url:raw,release:()=>{}};
 if(!thumbnail)return fallback;
 if(new URL(thumbnail).hostname==='pbs.twimg.com')return {...fallback,url:thumbnail};
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
 if(signal?.aborted)throw signal.reason;
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(),1500);
 try{
  const {supabase}=await import('./supabase');
  const result=await supabase.functions.invoke('link-preview',{body:{mode:'image',url:thumbnail},signal:controller.signal});
  if(signal?.aborted)throw signal.reason;
  const type=result.response?.headers.get('x-lime-image-type')??result.data?.type??'';
  if(result.error||!(result.data instanceof Blob)||!type.startsWith('image/')||result.data.size>1024*1024)return fallback;
  const url=URL.createObjectURL(new Blob([result.data],{type}));
  return {url,release:()=>URL.revokeObjectURL(url)};
 }catch(error){if(signal?.aborted)throw error;return fallback;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
