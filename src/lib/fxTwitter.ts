import { twitterReplyText } from "@/lib/utils";
import { profilePostIdentity } from "@/lib/utils";
import { relayTwitterSearch } from "@/api/search-news";
import {externalRead} from './utils';
import { twitterAvatarUrl } from "@/components/ui/avatar";
import type {BlueskyMappedPost,BlueskyProfile,BlueskyPostThread} from './bluesky';
import {cloudExternalHandles} from './externalAccounts';
export const isXId=(id?:string|null)=>!!id&&/^x:(?:\d{2,20})$|^x-user:\d+$/.test(id);
export const isXActor=(actor:string)=>actor.startsWith('x-user:')||/^[\w]{1,15}@(?:x|twitter)\.com$/i.test(actor)||/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[\w]{1,15}\/?$/i.test(actor);
export const xHandle=(actor:string)=>actor.startsWith('x-user:')?'id:'+actor.slice(7):actor.replace(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i,'').replace(/@(?:x|twitter)\.com$/i,'').replace(/^@/,'').replace(/\/$/,'');
export const configuredXHandles=()=> (cloudExternalHandles('x')??[]).map(handle=>`${handle}@twitter.com`);
export function xPostId(value:string){
 if(/^x:\d{2,20}$/.test(value))return value;
 try{const url=new URL(value);if(!['x.com','www.x.com','twitter.com','www.twitter.com','fxtwitter.com','fixupx.com'].includes(url.hostname))return null;const match=url.pathname.match(/^\/(?:[\w]{1,15}|i)\/status\/(\d{2,20})(?:\/.*)?$/);return match?`x:${match[1]}`:null;}catch{return null;}
}
type FxUser={id:string;screen_name:string;name?:string;avatar_url?:string;banner_url?:string;description?:string;joined?:string;followers?:number;following?:number;statuses?:number;protected?:boolean;verification?:{verified:boolean;type?:'individual'|'organization'|'government'|null};location?:string};
type FxMedia={url:string;type?:string;width?:number;height?:number;thumbnail_url?:string;duration?:number;format?:string;formats?:{url:string;container?:string;codec?:string;bitrate?:number;width?:number;height?:number}[];altText?:string};
export type FxPost={id:string;type?:string;statuses?:FxPost[];text:string;created_at?:string;created_timestamp?:number;author:FxUser;likes?:number;replies?:number;reposts?:number;retweets?:number;lang?:string;possibly_sensitive?:boolean;replying_to?:string|{screen_name:string;status:string}|null;replying_to_status?:string|null;quote?:FxPost;media?:{photos?:FxMedia[];videos?:FxMedia[]};views?:number;bookmarks?:number;quotes?:number;is_pinned?:boolean;pinned?:boolean;reposted_by?:{id:string;name:string;screen_name:string}|null;community_note?:{text:string}|null;poll?:{choices:{label:string;count:number}[];total_votes:number;ends_at:string};card?:{url:string;title?:string;description?:string;domain?:string;image?:{url:string}};source?:string;raw_text?:{facets?:{type:string;original?:string;replacement?:string}[]}};
const date=(value:string|number|undefined)=>{const parsed=new Date(value??0);return Number.isFinite(parsed.getTime())?parsed.toISOString():new Date(0).toISOString();};
const https=(value?:string)=>{try{return value&&new URL(value).protocol==='https:'?value:undefined;}catch{return undefined;}};
export function mapXUser(user:FxUser):BlueskyProfile{
 return {id:`x-user:${user.id}`,username:`${user.screen_name}@twitter.com`,displayName:user.name||user.screen_name,avatarUrl:twitterAvatarUrl(https(user.avatar_url))||'',coverUrl:https(user.banner_url)||'',bio:user.description||'',createdAt:date(user.joined),isOfficial:false,...(user.verification?.verified?{providerVerification:{provider:'twitter' as const,type:user.verification.type??'individual'}}:{}),isPrivate:!!user.protected,followersCount:user.followers??0,followingCount:user.following??0,postsCount:user.statuses??0};
}
export function mapXPost(post:FxPost,depth=0):BlueskyMappedPost|null{
 if(!post?.author?.id||post.author.protected||!/^\d{2,20}$/.test(post.id)||post.type&&post.type!=='status')return null;
 const reply=typeof post.replying_to==='object'?post.replying_to:null;
 const replyId=reply?.status??post.replying_to_status;
 const replyName=reply?.screen_name??(typeof post.replying_to==='string'?post.replying_to:undefined);
 const author=mapXUser(post.author),video=post.media?.videos?.find(item=>https(item.url));
 const variants=video?.formats?.filter(format=>https(format.url))??[];
 // Provider ordering is not a quality ranking; it commonly starts with a small rendition.
 const renditionSize=(format:typeof variants[number])=>{
  const match=format.url.match(/\/(\d{2,5})x(\d{2,5})(?:\/|\.)/);
  return (format.width||Number(match?.[1])||0)*(format.height||Number(match?.[2])||0);
 };
 const mp4=variants.filter(format=>format.container==='mp4'&&!/hevc|h265|av1|vp9/i.test(format.codec??''))
  .sort((a,b)=>renditionSize(b)-renditionSize(a)||(b.bitrate??0)-(a.bitrate??0)||Number(/h264|avc/i.test(b.codec??''))-Number(/h264|avc/i.test(a.codec??'')))[0];
 const stream=variants.find(format=>format.container==='m3u8');
 const directMp4=video&&(/\.mp4(?:[?#]|$)/i.test(video.url)||video.format==='video/mp4')?video.url:undefined;
 const primaryMp4=mp4?.url??directMp4;
 const primary=primaryMp4??stream?.url??video?.url;
 const hls=!!primary&&!primaryMp4&&(!!stream||!!video?.format?.includes('mpegurl')||/\.m3u8(?:[?#]|$)/i.test(primary));
 const parent=depth<2&&post.quote?mapXPost(post.quote,depth+1):null;
 return {id:`x:${post.id}`,userId:author.id,author,content:twitterReplyText((post.raw_text?.facets??[]).reduce((text,facet)=>facet.type==='url'&&facet.original&&https(facet.replacement)?text.split(facet.original).join(facet.replacement!):text,post.text??''),!!(replyId||replyName)),imageUrls:(post.media?.photos??[]).flatMap(item=>https(item.url)?[item.url]:[]),imageDimensions:(post.media?.photos??[]).filter(item=>https(item.url)).map(item=>item.width&&item.height?{width:item.width,height:item.height}:undefined),imageAltTexts:(post.media?.photos??[]).map(item=>item.altText??''),createdAt:date(post.created_timestamp?post.created_timestamp*1000:post.created_at),visibility:'public',likedByMe:false,likesCount:post.likes??0,repostsCount:post.reposts??post.retweets??0,commentsCount:post.replies??0,isBot:false,cid:'',source:'x',externalPinned:post.is_pinned===true||post.pinned===true,externalDetails:{views:post.views,bookmarks:post.bookmarks,reposts:post.reposts??post.retweets,quotes:post.quotes,communityNote:post.community_note?.text,poll:post.poll?{options:post.poll.choices.map(choice=>({label:choice.label,votes:choice.count})),endsAt:post.poll.ends_at}:undefined},...(post.reposted_by?{externalRepostedBy:{id:`x-user:${post.reposted_by.id}`,displayName:post.reposted_by.name,username:`${post.reposted_by.screen_name}@twitter.com`},profileRepostedBy:`x-user:${post.reposted_by.id}`,profileRepostedAt:date(post.created_timestamp?post.created_timestamp*1000:post.created_at)}:{}),blueskyUrl:`https://twitter.com/${post.author.screen_name}/status/${post.id}`,blueskyUri:`x:${post.id}`,languages:post.lang?[post.lang]:[],contentLabels:post.possibly_sensitive?['graphic-media']:[],...(post.card&&https(post.card.url)?{linkPreview:{url:post.card.url,domain:new URL(post.card.url).hostname,title:post.card.title??post.card.domain??new URL(post.card.url).hostname,description:post.card.description,image:https(post.card.image?.url)??''}}:{}),
 ...(video?{externalVideo:{playlist:primary!,format:hls?'hls' as const:'mp4' as const,...(primaryMp4&&stream?{fallback:{playlist:stream.url,format:'hls' as const}}:{}),thumbnail:https(video.thumbnail_url),width:video.width||16,height:video.height||9,duration:video.duration??0}}:{}),
 ...(replyId?{externalReplyToId:`x:${replyId}`,externalReplyToUsername:replyName?`${replyName}@twitter.com`:undefined}:{}),
 ...(parent?{isQuote:true,parentId:parent.id,parentPost:{...parent,repostsCount:parent.repostsCount??0,repostedByMe:false,author:{coverUrl:'',...parent.author}}}:{}),};
}
type FxPage={code:number;results?:FxPost[];cursor?:{bottom?:string|null};status?:FxPost;tweet?:FxPost;thread?:FxPost[];replies?:FxPost[];user?:FxUser;users?:FxUser[]};
const cache=new Map<string,{until:number;data:FxPage}>();
async function request(path:string,signal?:AbortSignal,timeout=12000,priority:'interactive'|'supplementary'='supplementary'):Promise<FxPage>{
 const saved=cache.get(path);if(saved&&saved.until>Date.now())return saved.data;
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>controller.abort(),timeout);
 try{return await externalRead(async()=>{const response=await fetch(`https://api.fxtwitter.com/2/${path}`,{signal:controller.signal,referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});if(!response.ok&&response.status!==404)throw new Error(`twitterの投稿を取得できませんでした (${response.status})`);const data=await response.json() as FxPage;if(data.code!==200&&data.code!==404)throw new Error('twitterの投稿を取得できませんでした');if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');if(data.code===200||!path.startsWith('search?'))cache.set(path,{until:Date.now()+(data.code===200?60000:15000),data});if(cache.size>100)cache.delete(cache.keys().next().value!);return data;},controller.signal,priority);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function xFeed(options:{actor?:string;cursor?:string|null;limit?:number;filter?:string;signal?:AbortSignal;includeReposts?:boolean}){
 const params=new URLSearchParams({count:String(Math.min(options.limit??20,100))});if(options.cursor)params.set('cursor',options.cursor);if(options.filter==='posts_with_replies'){params.set('with_replies','1');params.set('groupthreads','1');}const path=options.filter==='posts_with_media'?'media':'statuses';const data=await request(`profile/${encodeURIComponent(xHandle(options.actor!))}/${path}?${params}`,options.signal);const raw=(data.results??[]).flatMap(row=>row.type==='thread'?row.statuses??[]:[row]);const all=new Map(raw.map(row=>[row.id,row]));
 const build=(row:FxPost,seen=new Set<string>()):BlueskyMappedPost|null=>{if(seen.has(row.id)||seen.size>=20)return null;seen.add(row.id);const post=mapXPost(row);if(!post)return null;const parent=post.externalReplyToId&&all.get(post.externalReplyToId.slice(2));if(parent){const mapped=build(parent,seen);if(mapped)post.externalReplyParent={...mapped,repostsCount:mapped.repostsCount??0,repostedByMe:false,author:{coverUrl:'',...mapped.author}};}return post;};
 return {posts:[...new Map(raw.map(row=>build(row)).filter((post):post is BlueskyMappedPost=>!!post).filter(post=>!(options.filter==='posts_with_media'||options.includeReposts===false)||!post.profileRepostedBy).map(post=>[profilePostIdentity(post),post])).values()],cursor:data.cursor?.bottom&&data.cursor.bottom!==options.cursor?data.cursor.bottom:null};
}
export async function xProfile(actor:string,signal?:AbortSignal){const data=await request(`profile/${encodeURIComponent(xHandle(actor))}`,signal,12000,'interactive');return data.user?mapXUser(data.user):null;}
export async function xConversationPage(id:string,cursor?:string|null,signal?:AbortSignal){
 const parsed=xPostId(id);if(!parsed)return {post:null,replies:[],cursor:null,totalReplies:undefined as number|undefined};
 const params=new URLSearchParams();if(cursor)params.set('cursor',cursor);
 const data=await request(`conversation/${parsed.slice(2)}${params.size?'?'+params:''}`,signal,12000,'interactive');
 const raw=data.status??data.tweet;
 const ancestors=new Map((data.thread??[]).map(post=>[post.id,post]));
 const build=(raw:FxPost,seen=new Set<string>()):BlueskyMappedPost|null=>{if(seen.has(raw.id)||seen.size>=20)return null;seen.add(raw.id);const post=mapXPost(raw);if(!post)return null;const parent=post.externalReplyToId&&ancestors.get(post.externalReplyToId.slice(2));if(parent){const mapped=build(parent,seen);if(mapped)post.externalReplyParent={...mapped,repostsCount:mapped.repostsCount??0,repostedByMe:false,author:{coverUrl:'',...mapped.author}};}return post;};
 const post=raw?build(raw):null;
 const ancestorIds=new Set<string>();let ancestor=post?.externalReplyParent;while(ancestor&&!ancestorIds.has(ancestor.id)){ancestorIds.add(ancestor.id);ancestor=ancestor.externalReplyParent;}
 const replies=[...new Map([...(data.replies??[]),...(data.thread??[])].map(row=>{const mapped=mapXPost(row);return [row.id,mapped&&{...mapped,externalReplyToId:mapped.externalReplyToId??parsed}];})).values()].filter((row):row is NonNullable<typeof row>=>!!row&&row.id!==parsed&&!ancestorIds.has(row.id));
 return {post,replies,totalReplies:typeof raw?.replies==='number'?raw.replies:undefined,cursor:raw?.replies!==0&&replies.length>0&&data.cursor?.bottom&&data.cursor.bottom!==cursor?data.cursor.bottom:null};
}
export async function xThread(id:string,signal?:AbortSignal):Promise<BlueskyPostThread>{
 const parsed=xPostId(id);if(!parsed)return {post:null,replies:[]};
 const data=await request(`status/${parsed.slice(2)}`,signal,12000,'interactive');return {post:data.status||data.tweet?mapXPost((data.status||data.tweet)!):null,replies:[]};
}
let searchUnavailableUntil=0;
async function alternativeSearch(query:string,options:{cursor?:string|null;feed?:'latest'|'top'|'media'|'media-top';signal?:AbortSignal;limit?:number;onPost?:(post:BlueskyMappedPost)=>void}){
 const offset=options.cursor?.startsWith('yahoo:')?Number(options.cursor.slice(6)):0;
 if(!Number.isInteger(offset)||offset<0||offset>1000)throw new Error('検索カーソルが無効です');
 const limit=Math.max(1,Math.min(20,Math.floor(options.limit??6)||6));
 const page=await relayTwitterSearch(query,options.feed??'latest',offset,options.signal,limit);
 const ids=page.ids.slice(0,limit);
 const results:BlueskyMappedPost[]=[];let index=0;
 await Promise.all(Array.from({length:Math.min(limit>6?3:2,ids.length)},async()=>{while(index<ids.length){const id=ids[index++];try{const item=await xThread(`x:${id}`,options.signal);if(item.post){results.push(item.post);options.onPost?.(item.post);}}catch(error){if(options.signal?.aborted)throw error;}}}));
 if(page.ids.length&&!results.length)throw new Error('twitterの投稿情報を取得できませんでした');
 const byId=new Map(results.map(post=>[post.id,post]));
 const next=ids.length<page.ids.length?offset+ids.length:page.cursor;
 return {posts:ids.flatMap(id=>byId.has(`x:${id}`)?[byId.get(`x:${id}`)!]:[]),cursor:next!==null?`yahoo:${next}`:null};
}
export async function searchXPage(query:string,options:{cursor?:string|null;feed?:'latest'|'top'|'media'|'media-top';signal?:AbortSignal;preferAlternative?:boolean;limit?:number;onPost?:(post:BlueskyMappedPost)=>void}={}){
 const id=xPostId(query);if(id){const data=await xThread(id,options.signal);return {posts:data.post?[data.post]:[],cursor:null};}
 const q=query.replace(/(?:^|\s)source:(?:x|twitter)(?=\s|$)/gi,' ').replace(/(from:|to:)([\w]{1,15})@(?:x|twitter)\.com/gi,'$1$2').trim();
 if(!q)return {posts:[],cursor:null};
 const authorOnly=q.match(/^\(?from:([A-Za-z0-9_]{1,15})\)?(?: filter:(media|images|videos))?$/);
 if(authorOnly){const page=await xFeed({actor:`${authorOnly[1]}@twitter.com`,cursor:options.cursor,filter:authorOnly[2]||options.feed==='media'?'posts_with_media':'posts_with_replies',signal:options.signal});return {posts:page.posts,cursor:page.cursor};}
 if(options.preferAlternative||options.cursor?.startsWith('yahoo:')||(!options.cursor&&Date.now()<searchUnavailableUntil))return alternativeSearch(q,options);
 const params=new URLSearchParams({q,count:'20',feed:options.feed??'latest'});if(options.cursor)params.set('cursor',options.cursor);
 let data:FxPage;
 try{data=await request(`search?${params}`,options.signal,4000,'interactive');}catch(error){if(options.signal?.aborted||error instanceof Error&&error.message.includes('(429)'))throw error;searchUnavailableUntil=Date.now()+60000;return alternativeSearch(q,options);}
 if(data.code===404){searchUnavailableUntil=Date.now()+60000;return alternativeSearch(q,options);}
 return {posts:[...new Map((data.results??[]).map(raw=>mapXPost(raw)).filter((post):post is BlueskyMappedPost=>!!post).map(post=>[post.id,post])).values()],cursor:data.cursor?.bottom&&data.cursor.bottom!==options.cursor?data.cursor.bottom:null};
}
export async function searchX(query:string,includePosts=true,signal?:AbortSignal){
 const id=xPostId(query);if(id){const thread=await xThread(id,signal);return {posts:includePosts&&thread.post?[thread.post]:[],users:[]};}
 if(isXActor(query)){const profile=await xProfile(query,signal);const page=includePosts?await xFeed({actor:query,signal}):{posts:[]};return {posts:page.posts,users:profile?[profile]:[]};}
 if(!includePosts){const data=await request(`typeahead?${new URLSearchParams({q:query,result_type:'users'})}`,signal,12000,'interactive');let users=(data.users??[]).map(mapXUser);if(!users.length&&/^[A-Za-z0-9_]{1,15}$/.test(query)){const exact=await xProfile(`${query}@twitter.com`,signal);if(exact)users=[exact];}return {posts:[],users};}
 const page=await searchXPage(query,{signal});return {posts:page.posts,users:[]};
}

export async function xFollowList(actor:string,following:boolean,cursor?:string|null,limit=50,signal?:AbortSignal){
 const params=new URLSearchParams({count:String(limit)});if(cursor)params.set('cursor',cursor);
 const data=await request(`profile/${encodeURIComponent(xHandle(actor))}/${following?'following':'followers'}?${params}`,signal);
 if(data.code!==200||!Array.isArray(data.results))throw new Error("Twitterのフォロー一覧を取得できませんでした");
 const users=data.results as unknown as FxUser[];
 return {users:users.filter(user=>!!user.screen_name&&!!user.id).map(mapXUser),cursor:data.cursor?.bottom??null};
}

export const twitterReplyUrl=(id:string)=>/^x:\d{2,20}$/.test(id)?`https://twitter.com/intent/tweet?in_reply_to=${id.slice(2)}`:null;

export async function fetchTwitterPostActivity(postId:string,tab:'quotes'|'reposts',cursor?:string|null,signal?:AbortSignal){
 const id=xPostId(postId);if(!id)throw new Error('投稿IDが無効です');
 const params=new URLSearchParams({count:'50'});if(cursor)params.set('cursor',cursor);
 const data=await request(`status/${id.slice(2)}/${tab}?${params}`,signal,12000,'interactive');
 if(data.code!==200)throw new Error(`twitterのアクティビティを取得できませんでした (${data.code})`);
 const users=tab==='reposts'?(data.users??data.results??[]) as FxUser[]:[];
 const mappedUsers=users.filter(user=>user.id&&user.screen_name).map(mapXUser),posts=tab==='quotes'?(data.results??[]).flatMap(row=>{const post=mapXPost(row);return post?[post]:[];}):[];
 return {users:mappedUsers,posts,cursor:(tab==='quotes'?posts.length:mappedUsers.length)&&data.cursor?.bottom&&data.cursor.bottom!==cursor?data.cursor.bottom:null};
}
