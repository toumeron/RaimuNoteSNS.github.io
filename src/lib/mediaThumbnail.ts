/** Grid previews use CDN thumbnails; viewer selections retain their original URLs. */
export function mediaThumbnailUrl(src:string):string{
 try{
  const url=new URL(src);
  if(url.protocol!=='https:')return src;
  if(url.hostname==='pbs.twimg.com'&&url.pathname.startsWith('/media/')){
   url.searchParams.set('name','small');return url.href;
  }
  if(url.hostname==='cdn.bsky.app'&&url.pathname.startsWith('/img/feed_fullsize/')){
   url.pathname=url.pathname.replace('/img/feed_fullsize/','/img/feed_thumbnail/');return url.href;
  }
 }catch{}
 return src;
}
