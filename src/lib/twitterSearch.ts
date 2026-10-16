import { searchXPage } from "@/lib/fxTwitter";
import { normalizeTimelineBlueskyPost } from "@/lib/timelinePaging";
import { type PostWithAuthor } from "@/types/index";

// twitterSearch
/** Translate LimeNote search conditions to the provider's search syntax. */
function twitterSearchQuery(p:{terms:string[];phrases:string[];orGroups:string[][];excludes:string[];from:string[];notFrom:string[];to?:string[];bareHandle:string|null;since:Date|null;until:Date|null;minLikes:number|null;maxLikes:number|null;minReposts:number|null;media:'any'|'image'|'video'|null;excludeImage:boolean;excludeVideo:boolean;hasLink:boolean;excludeLink:boolean}){
 const day=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const handle=(value:string)=>value.replace(/@(?:x|twitter)\.com$/i,'').replace(/^@/,'');
 const parts=[...p.terms.filter(term=>!(p.to??[]).some(name=>term.toLowerCase()===`@${name.toLowerCase()}`)),...p.phrases.map(value=>JSON.stringify(value)),...p.orGroups.map(group=>`(${group.join(' OR ')})`),...p.excludes.map(value=>`-${JSON.stringify(value)}`)];
 if(p.bareHandle)parts.push(`from:${handle(p.bareHandle)}`);
 if(p.from.length)parts.push(`(${p.from.map(value=>`from:${handle(value)}`).join(' OR ')})`);
 parts.push(...p.notFrom.map(value=>`-from:${handle(value)}`),...(p.to??[]).map(value=>`to:${handle(value)}`));
 if(p.since)parts.push(`since:${day(p.since)}`);
 if(p.until){const exclusive=new Date(p.until);exclusive.setDate(exclusive.getDate()+1);parts.push(`until:${day(exclusive)}`);}
 if(p.minLikes!==null)parts.push(`min_faves:${p.minLikes}`);
 if(p.maxLikes!==null)parts.push(`-min_faves:${p.maxLikes+1}`);
 if(p.minReposts!==null)parts.push(`min_retweets:${p.minReposts}`);
 if(p.media)parts.push(`filter:${p.media==='any'?'media':p.media==='image'?'images':'videos'}`);
 if(p.excludeImage)parts.push('-filter:images');if(p.excludeVideo)parts.push('-filter:videos');
 if(p.hasLink)parts.push('filter:links');if(p.excludeLink)parts.push('-filter:links');
 return parts.join(' ').trim();
}

// twitterSearchResults
/** Fill matching search results rather than counting IDs rejected by filters.
 * Read at most two source pages, retaining the last successful cursor on errors. */
async function searchTwitterResults(query:string,options:{cursor:string|null;feed:'top'|'latest'|'media';signal?:AbortSignal;matches:(post:PostWithAuthor)=>boolean;exclude?:ReadonlySet<string>;target?:number}){
 if(options.signal?.aborted)throw options.signal.reason;
 const posts:PostWithAuthor[]=[],seen=new Set(options.exclude),cursors=new Set<string|null>();
 let cursor=options.cursor,error:unknown=null;
 for(let read=0;read<2&&posts.length<(options.target??18);read++){
  if(cursors.has(cursor))break;cursors.add(cursor);
  try{
   const page=await searchXPage(query,{cursor,feed:options.feed,preferAlternative:true,limit:20,signal:options.signal});
   if(options.signal?.aborted)throw options.signal.reason;
   for(const row of page.posts){const post=normalizeTimelineBlueskyPost(row);if(seen.has(post.id)||!options.matches(post))continue;seen.add(post.id);posts.push(post);}
   cursor=page.cursor;
   if(!cursor||cursors.has(cursor)){cursor=null;break;}
  }catch(failure){if(options.signal?.aborted)throw options.signal.reason;error=failure;break;}
 }
 return {posts,cursor,error};
}

// searchProviderBatch
/** Preserve relevance order within each service while keeping twitter visible in all-source search. */
function searchProviderBatch(candidates:PostWithAuthor[],limit:number,mixed:boolean){
 const rows=[...new Map(candidates.map(post=>[post.id,post])).values()];
 if(!mixed)return {posts:rows.slice(0,limit),remaining:rows.slice(limit)};
 const isTwitter=(post:PostWithAuthor)=>post.source==='x'||post.id.startsWith('x:');
 const twitter=rows.filter(isTwitter),other=rows.filter(post=>!isTwitter(post));
 const count=Math.min(twitter.length,Math.max(Math.ceil(limit*.9),limit-other.length));
 const a=twitter.slice(0,count),b=other.slice(0,limit-a.length),posts:PostWithAuthor[]=[];
 const total=a.length+b.length;let x=0,y=0;
 for(let i=0;i<total;i++){if(x<Math.ceil((i+1)*a.length/total))posts.push(a[x++]);else posts.push(b[y++]);}
 const selected=new Set(posts.map(post=>post.id));
 return {posts,remaining:rows.filter(post=>!selected.has(post.id))};
}

export { twitterSearchQuery };
export { searchTwitterResults };
export { searchProviderBatch };
