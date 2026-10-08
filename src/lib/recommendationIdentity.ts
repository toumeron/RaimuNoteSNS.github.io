import type {PostWithAuthor} from '@/types';
export function recommendationIdentity(post:Pick<PostWithAuthor,'id'|'blueskyUri'>):string {
 const uri=post.blueskyUri??post.id.replace(/^bsky:/,'');
 return uri.startsWith('at://')?`bsky:${uri}`:post.id;
}
/** Identify the same work across resized CDN URLs, copied posts and page boundaries. */
export function recommendationFingerprint(post:Pick<PostWithAuthor,'content'|'imageUrls'>):string|undefined {
 const media=post.imageUrls.map(raw=>{
  try{const url=new URL(raw);for(const key of ['w','h','width','height','format','q','quality','fit','auto','resize'])url.searchParams.delete(key);url.hash='';const blob=url.hostname==='cdn.bsky.app'?url.pathname.match(/\/(baf[a-z0-9]+)(?:@[a-z]+)?$/i)?.[1]:undefined;if(blob)return `bsky-media:${blob}`;url.pathname=url.pathname.replace(/\/img\/feed_(?:thumbnail|fullsize)\//,'/img/feed/');return url.toString();}catch{return raw;}
 }).sort();
 const text=post.content.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
 if(!media.length&&text.length<32)return undefined;
 const value=media.length?JSON.stringify(media):text;
 let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}
 return `fp:${(a>>>0).toString(36)}:${(b>>>0).toString(36)}`;
}
