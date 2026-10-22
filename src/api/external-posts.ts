import { externalRead, randomUUID, getClientName, normalizeTimelineBlueskyPost, validatePollDraft, type PollDraft, type Poll } from "@/lib/utils";
import { supabase, type AccountReadContext } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/currentUser";
import { fetchBlueskyPost, fetchBlueskyPostActivity } from "@/lib/bluesky";
import { type PostWithAuthor, type CommentWithAuthor, type User } from "@/types/index";
import { mapBoundsContain, type MapBounds, type MapPostPin } from "@/lib/mapLocation";
import { uploadPostMedia } from "@/lib/mediaThumbnail";
import { fetchTwitterPostActivity } from "@/lib/fxTwitter";
import { getPostQuotes, getPostReposters } from "@/api/posts";
import { type ScheduledPost } from "@/components/feed/PostPoll";

// external-posts
const isExternalPostId = (id: string) => id.startsWith('bsky:at://') || /^x:\d{2,20}$/.test(id) || /^misskey:https:\/\/misskey[.]io\/notes\/[A-Za-z0-9]+$/.test(id);

// Repost metadata is supplementary. Bound concurrent reads and stop a failing
// backend from receiving another three requests for every card/remount.
let repostReadFailure:{until:number;error:unknown}|undefined;
async function getExternalRepostState(postId: string, signal?:AbortSignal) {
 return externalRead(async()=>{
  signal?.throwIfAborted();
  if(repostReadFailure&&repostReadFailure.until>Date.now())throw repostReadFailure.error;
  try{
   const userId=await getCurrentUserId();
   const read=<T extends {abortSignal:(signal:AbortSignal)=>T}>(query:T)=>signal?query.abortSignal(signal):query;
   const [shares,quotes,own]=await Promise.all([
    read(supabase.from('external_reposts').select('*',{count:'exact',head:true}).eq('post_id',postId)),
    read(supabase.from('posts').select('*',{count:'exact',head:true}).eq('quoted_external_post->>id',postId)),
    userId?read(supabase.from('external_reposts').select('post_id').eq('post_id',postId).eq('user_id',userId)).maybeSingle():Promise.resolve({data:null,error:null}),
   ]);
   if(shares.error)throw shares.error;if(quotes.error)throw quotes.error;if(own.error)throw own.error;
   return {repostsCount:(shares.count??0)+(quotes.count??0),repostedByMe:Boolean(own.data)};
  }catch(error){if(!signal?.aborted)repostReadFailure={until:Date.now()+15_000,error};throw error;}
 },signal,'supplementary');
}

async function getExternalPost(id: string): Promise<PostWithAuthor | null> {
  const post = await fetchBlueskyPost(id);
  if (!post) return null;
  const state = await getExternalRepostState(id);
  return { ...post, ...state, author: { bio: '', coverUrl: '', createdAt: post.createdAt, ...post.author } };
}

async function toggleExternalRepost(id: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('ログインが必要です');
  const { data: existing, error } = await supabase.from('external_reposts').select('post_id')
    .eq('post_id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (existing) {
    const result = await supabase.from('external_reposts').delete().eq('post_id', id).eq('user_id', userId);
    if (result.error) throw result.error;
  } else {
    const post = await fetchBlueskyPost(id);
    if (!post) throw new Error('引用元の投稿が見つかりません');
    const result = await supabase.from('external_reposts').insert({post_id: id, user_id: userId,
      post_snapshot: {...post, repostsCount: 0, repostedByMe: false} });
    if (result.error) throw result.error;
  }
  try {
    const state = await getExternalRepostState(id);
    return { reposted: !existing, repostsCount: state.repostsCount };
  } catch {
    return { reposted: !existing };
  }
}

async function getExternalProfileReposts(userId: string, limit: number, offset = 0): Promise<PostWithAuthor[]> {
  const result = await supabase.from('external_reposts').select('post_snapshot, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).order('post_id', { ascending: false }).range(offset, offset + limit - 1);
  if (result.error) throw result.error;
  return (result.data ?? []).map(row => ({ ...row.post_snapshot,
    profileRepostedAt: row.created_at, profileRepostedBy: userId } as PostWithAuthor));
}

// external-map-posts
type ExternalMapCursor = { provider: 'flickr'; bounds: MapBounds; search: string; page: number; from: number; until: number }[];
type PositionPage = { pins: MapPostPin[]; next: ExternalMapCursor };
class MapRateLimitError extends Error {
    constructor(public retryAfter: number) { super('Map rate limit'); }
}
const cacheKey = (search:string,bounds?:MapBounds) => `lime-map-geo-avatar-v3:${search}:${JSON.stringify(bounds)}`;
function readPositions(search: string,bounds?:MapBounds): PositionPage | null {
    try { const stored=JSON.parse(sessionStorage.getItem(cacheKey(search,bounds)) ?? 'null'); return stored?.expires > Date.now() && Array.isArray(stored.pins) && Array.isArray(stored.next) ? stored : null; } catch { return null; }
}
function storePositions(search: string, page: PositionPage, append: boolean,bounds?:MapBounds) {
    try { const previous=append ? readPositions(search,bounds) : null; sessionStorage.setItem(cacheKey(search,bounds),JSON.stringify({pins:[...new Map([...(previous?.pins ?? []),...page.pins].map(pin=>[pin.id,pin])).values()],next:page.next,expires:Date.now()+300000})); } catch { /* A full browser cache must not interrupt map reads. */ }
}
async function getExternalMapPostPage(plan: ExternalMapCursor | undefined, signal?: AbortSignal, bounds?: MapBounds, search = ''): Promise<{ pins: MapPostPin[]; next: ExternalMapCursor }> {
    if(signal?.aborted)throw signal.reason;
    if(!plan){const stored=readPositions(search,bounds);if(stored)return {pins:stored.pins,next:stored.next};}
    const body=plan ? {mode:'map-geo-pins',jobs:plan.slice(0,4)} : {mode:'map-geo-pins',bounds,search};
    const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body,signal}),signal);
    if(signal?.aborted)throw signal.reason;
    const response=(result.error as {context?:Response}|null)?.context;
    if(response?.status===429)throw new MapRateLimitError(Math.max(300,Number(response.headers.get('Retry-After'))||300)*1000);
    if(result.error || result.data?.schema!=='geo-v1' || !Array.isArray(result.data?.pins) || !Array.isArray(result.data?.next))throw new Error('外部SNSのポスト位置を読み込めませんでした。');
    const page={pins:result.data.pins.filter((pin:MapPostPin)=>pin.source==='flickr'&&/^flickr:\d+@N\d+\/\d+$/.test(pin.id)&&pin.mapLocation&&Number.isFinite(pin.mapLocation.latitude)&&Number.isFinite(pin.mapLocation.longitude)),next:[...(plan?.slice(4) ?? []),...result.data.next]};
    storePositions(search,page,!!plan,bounds);
    return page;
}
function filterExternalMapPins(pins: MapPostPin[], bounds: MapBounds): MapPostPin[] {
    return pins.filter(pin => pin.mapLocation && mapBoundsContain(bounds,pin.mapLocation));
}

type ExternalMapPostDetail={id:string;originalUrl:string;createdAt:string;content:string;author:{displayName:string;avatarUrl:string}};
async function getExternalMapPostDetail(id:string):Promise<ExternalMapPostDetail|null>{
 if(!/^flickr:\d+@N\d+\/\d+$/.test(id))return null;
 const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'map-geo-detail',id}}));
 if(result.error)return null;return result.data?.post??null;
}

// external-likes
type ExternalLikeState={liked:boolean;count:number;unmirroredCount:number};
/** Keep a public rendering snapshot, never account tokens or private settings. */
function externalLikeSnapshot(post:PostWithAuthor,depth=0){
 if(!isExternalPostId(post.id)||post.visibility&&post.visibility!=='public')throw new Error('公開された外部投稿のみいいねできます');
 return {id:post.id,userId:post.userId,source:post.source,visibility:'public',content:post.content,imageUrls:post.imageUrls,externalVideo:post.externalVideo,externalDetails:post.externalDetails,imageAltTexts:post.imageAltTexts,imageDimensions:post.imageDimensions,snapshotVersion:2,isQuote:!!post.isQuote,parentId:post.parentId,parentPost:depth<2&&post.parentPost&&isExternalPostId(post.parentPost.id)&&post.parentPost.visibility==='public'?externalLikeSnapshot(post.parentPost,depth+1):null,createdAt:post.createdAt,likesCount:post.likesCount,commentsCount:post.commentsCount,repostsCount:post.repostsCount,likedByMe:false,repostedByMe:false,blueskyUri:post.blueskyUri,blueskyUrl:post.blueskyUrl,cid:post.cid,externalReplyToId:post.externalReplyToId,externalReplyToUsername:post.externalReplyToUsername,languages:post.languages,recommendationLanguages:post.recommendationLanguages,recommendationTopics:post.recommendationTopics,recommendationAuthorTopics:post.recommendationAuthorTopics,recommendationSources:post.recommendationSources,recommendationVisual:post.recommendationVisual,contentLabels:post.contentLabels,linkPreview:post.linkPreview,author:{id:post.author.id,username:post.author.username,displayName:post.author.displayName,bio:post.author.bio,avatarUrl:post.author.avatarUrl,coverUrl:post.author.coverUrl,createdAt:post.author.createdAt,isOfficial:false,isPrivate:post.author.isPrivate===true,providerVerification:post.author.providerVerification}};
}
/** Repair legacy rendering snapshots on demand; no background polling or writes. */
const savedPostReads=new Map<string,{expires:number;promise:Promise<PostWithAuthor|null>}>();
export async function completeSavedPosts<T extends PostWithAuthor>(posts:T[],context?:AccountReadContext):Promise<T[]>{
 const output=[...posts];let index=0;
 await Promise.all(Array.from({length:Math.min(3,posts.length)},async()=>{
  while(index<posts.length){const slot=index++,post=posts[slot];
   const external=isExternalPostId(post.id);
   const missingQuote=!!(post.isQuote||post.parentId)&&!post.parentPost;
   const missingImages=post.imageUrls?.some((_,i)=>!post.imageDimensions?.[i]);
   if(!missingQuote&&!(external&&((post as any).snapshotVersion!==2||missingImages)))continue;
   try{
    let fresh:PostWithAuthor|null;
    if(external){
     let read=savedPostReads.get(post.id);
     if(!read||read.expires<Date.now()){
      const promise=fetchBlueskyPost(post.id).then(row=>row?({...row,repostsCount:row.repostsCount??0,repostedByMe:false,author:{coverUrl:'',...row.author}} as PostWithAuthor):null).catch(()=>null);
      read={expires:Date.now()+300000,promise};savedPostReads.set(post.id,read);
      if(savedPostReads.size>200)savedPostReads.delete(savedPostReads.keys().next().value!);
     }
     fresh=await read.promise;
    }else fresh=await (await import('./posts')).getPostById(post.id,context);
    if(fresh&&(!external||fresh.visibility==='public'))output[slot]={...post,...fresh,likedByMe:post.likedByMe,repostedByMe:post.repostedByMe,profileRepostedAt:post.profileRepostedAt,profileRepostedBy:post.profileRepostedBy} as T;
   }catch{/* Saved public content remains available when its provider is offline. */}
  }
 }));return output;
}
async function setExternalLike(post:PostWithAuthor,liked:boolean,mirrored=false):Promise<ExternalLikeState>{
 const {data,error}=await supabase.rpc('set_external_like',{snapshot:externalLikeSnapshot(post),enabled:liked,mirrored});
 if(error)throw error;return data as ExternalLikeState;
}
// Coalesce the visible cards' state reads into one RPC; opening a timeline
// must not issue two queries per external post.
const requests=new Map<string,{resolve:(state:ExternalLikeState)=>void;reject:(error:unknown)=>void;viewer?:string|null}[]>();
let flush:ReturnType<typeof setTimeout>|undefined;
function getExternalLikeState(postId:string,viewer?:string|null):Promise<ExternalLikeState>{
 return new Promise((resolve,reject)=>{const entries=requests.get(postId)??[];entries.push({resolve,reject,viewer});requests.set(postId,entries);if(!flush)flush=setTimeout(async()=>{
  const batch=new Map(requests);requests.clear();flush=undefined;
  try{
   const before=await getCurrentUserId().catch(()=>null);
   const valid=new Map([...batch].map(([id,entries])=>[id,entries.filter(entry=>{
    if(entry.viewer===undefined||entry.viewer===before)return true;
    entry.reject(new Error('Account changed'));return false;
   })] as const).filter(([,entries])=>entries.length));
   const ids=[...valid.keys()],data:any[]=[];
   for(let i=0;i<ids.length;i+=100){const result=await supabase.rpc('external_like_states',{post_ids:ids.slice(i,i+100)});if(result.error)throw result.error;data.push(...(result.data??[]));}
   const after=await getCurrentUserId().catch(()=>null);
   for(const [id,entries] of valid){const row=data.find(row=>row.post_id===id);const state={liked:!!row?.liked,count:Number(row?.likes_count??0),unmirroredCount:Number(row?.unmirrored_count??0)};entries.forEach(entry=>{
    if(entry.viewer!==undefined&&entry.viewer!==after)entry.reject(new Error('Account changed'));else entry.resolve(state);
   });}
  }catch(error){for(const entries of batch.values())entries.forEach(entry=>entry.reject(error));}
 },8);});
}

/** Update an existing owner's snapshot only, without creating a like or touching mirror state. */
async function enrichExternalLike(post:PostWithAuthor,viewerId:string){
 if(!post.recommendationVisual||!isExternalPostId(post.id)||await getCurrentUserId()!==viewerId)return;
 const {error}=await supabase.from('likes').update({post_snapshot:externalLikeSnapshot(post)}).eq('user_id',viewerId).eq('external_post_id',post.id);
 if(error)throw error;
}

// repost-state
async function getNativeRepostState(postId:string) {
  const viewer=await getCurrentUserId();
  const [post,own]=await Promise.all([
    supabase.from('posts').select('reposts_count').eq('id',postId).single(),
    viewer ? supabase.from('reposts').select('post_id').eq('post_id',postId).eq('user_id',viewer).maybeSingle() : Promise.resolve({data:null,error:null}),
  ]);
  if(post.error) throw post.error;
  if(own.error) throw own.error;
  return {repostsCount:Number(post.data?.reposts_count ?? 0),repostedByMe:Boolean(own.data)};
}

// reply-reposts
const isReplyPostId = (id: string) => id.startsWith('reply:');
const REPLY_REPOST_SELECT = `*, profiles:user_id(*), post:post_id(user_id, profiles:user_id(username)), replying_to:parent_comment_id(profiles:user_id(username))`;

/** The source post's RLS determines visibility before converting a reply. */
function replyToPost(reply: any): PostWithAuthor {
  const author = reply.author ?? reply.profiles ?? {};
  return {
    id: `reply:${reply.id}`, replyId: reply.id, replyPostId: reply.postId ?? reply.post_id,
    replyToUsername: reply.replying_to?.profiles?.username ?? reply.post?.profiles?.username ?? reply.replyToUsername,
    userId: reply.userId ?? reply.user_id ?? author.id,
    content: reply.content ?? '', imageUrls: reply.imageUrls ?? reply.image_urls ?? [],
    createdAt: reply.createdAt ?? reply.created_at, clientName:reply.clientName ?? reply.client_name, visibility:'public',
    likesCount: Number(reply.likesCount ?? reply.likes_count ?? 0), likedByMe: Boolean(reply.likedByMe),
    commentsCount: Number(reply.commentsCount ?? reply.comments_count ?? 0),
    repostsCount: Number(reply.repostsCount ?? 0), repostedByMe: Boolean(reply.repostedByMe),
    author: {id:author.id, username:author.username ?? '', displayName:author.displayName ?? author.display_name ?? author.username ?? '',
      avatarUrl:author.avatarUrl ?? author.avatar_url ?? '',bio:author.bio ?? '', coverUrl:author.coverUrl ?? author.cover_url ?? '',
      createdAt:author.createdAt ?? author.created_at ?? '',isOfficial:author.isOfficial ?? author.is_official ?? false},
  };
}

async function getReplyRepostState(id: string, context?: AccountReadContext) {
  const commentId = id.replace(/^reply:/,'');
  const viewer = context?.userId ?? await getCurrentUserId();
  const client = context?.client ?? supabase;
  const [shares,quotes,own] = await Promise.all([
    client.from('reply_reposts').select('*',{count:'exact',head:true}).eq('comment_id',commentId),
    client.from('posts').select('*',{count:'exact',head:true}).eq('quoted_reply_id',commentId),
    viewer ? client.from('reply_reposts').select('comment_id').eq('comment_id',commentId).eq('user_id',viewer).maybeSingle() : Promise.resolve({data:null,error:null}),
  ]);
  if(shares.error) throw shares.error;
  if(quotes.error) throw quotes.error;
  if(own.error) throw own.error;
  return {repostsCount:(shares.count ?? 0)+(quotes.count ?? 0),repostedByMe:Boolean(own.data)};
}

async function getReplyPost(id: string, context?: AccountReadContext): Promise<PostWithAuthor | null> {
  const client = context?.client ?? supabase;
  context?.signal?.throwIfAborted();
  const result = await client.from('comments').select(REPLY_REPOST_SELECT).eq('id',id.replace(/^reply:/,'')).single();
  if(result.error || !result.data) return null;
  const post=replyToPost(result.data);
  const [state,viewer]=await Promise.all([getReplyRepostState(id, context),context?.userId ?? getCurrentUserId()]);
  const like=viewer ? await client.from('comment_likes').select('user_id').eq('comment_id',post.replyId).eq('user_id',viewer).maybeSingle() : {data:null};
  return {...post,...state,likedByMe:Boolean(like.data)};
}

async function toggleReplyRepost(id: string) {
  const viewer=await getCurrentUserId();
  if(!viewer) throw new Error('ログインが必要です');
  const commentId=id.replace(/^reply:/,'');
  const own=await supabase.from('reply_reposts').select('comment_id').eq('comment_id',commentId).eq('user_id',viewer).maybeSingle();
  if(own.error) throw own.error;
  const result=own.data ? await supabase.from('reply_reposts').delete().eq('comment_id',commentId).eq('user_id',viewer)
    : await supabase.from('reply_reposts').insert({comment_id:commentId,user_id:viewer});
  if(result.error) throw result.error;
  try { return {reposted:!own.data,repostsCount:(await getReplyRepostState(id)).repostsCount}; }
  catch { return {reposted:!own.data}; }
}

async function getProfileReplyReposts(userId:string,limit:number,offset=0):Promise<PostWithAuthor[]> {
  const result=await supabase.from('reply_reposts').select(`created_at, comments!inner(${REPLY_REPOST_SELECT})`)
    .eq('user_id',userId).order('created_at',{ascending:false}).order('comment_id',{ascending:false}).range(offset,offset+limit-1);
  if(result.error) throw result.error;
  return (result.data ?? []).map((row:any)=>({...replyToPost(row.comments),profileRepostedBy:userId,profileRepostedAt:row.created_at}));
}

export { getExternalRepostState };
export { getExternalPost };
export { toggleExternalRepost };
export { getExternalProfileReposts };
export { isExternalPostId };
export { getExternalMapPostPage };
export { filterExternalMapPins };
export { getExternalMapPostDetail };
export type { ExternalMapCursor };
export { MapRateLimitError };
export type { ExternalMapPostDetail };
export { externalLikeSnapshot };
export { setExternalLike };
export { getExternalLikeState };
export { enrichExternalLike };
export type { ExternalLikeState };
export { getNativeRepostState };
export { replyToPost };
export { getReplyRepostState };
export { getReplyPost };
export { toggleReplyRepost };
export { getProfileReplyReposts };
export { isReplyPostId };
export { REPLY_REPOST_SELECT };


// comments
type CommentInput = { content: string; imageUrls?: string[]; parentCommentId?: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToComment(row: any): CommentWithAuthor {
  return {
    id: row.id, postId: row.post_id, userId: row.user_id,
    content: row.content, createdAt: row.created_at,
    parentCommentId: row.parent_comment_id ?? null,
    clientName: row.client_name ?? undefined,
    imageUrls: row.image_urls ?? [], likes_count: row.likes_count ?? 0,
    author: rowToUser(row.profiles),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(profile: any): User {
  return {
    id:          profile.id,
    username:    profile.username    ?? '',
    displayName: profile.display_name ?? '',
    bio:         profile.bio         ?? '',
    avatarUrl:   profile.avatar_url  ?? '',
    coverUrl:    profile.cover_url   ?? '',
    createdAt:   profile.created_at  ?? '',
    isOfficial: profile.is_official ?? false,
    isPrivate: profile.is_private === true,
  };
}

async function getCommentsByPost(postId: string): Promise<CommentWithAuthor[]> {
  const comments: CommentWithAuthor[] = [];
  let after: { createdAt: string; id: string } | undefined;
  // PostgREST caps a response at 1000 rows. Continue by a stable key so deep
  // threads are not truncated and live insertions cannot shift page offsets.
  for (;;) {
    let query = supabase.from('comments').select('*, profiles:profiles!comments_user_id_fkey(*)').eq('post_id', postId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 999);
    if (after) query = query.or(`created_at.gt.${after.createdAt},and(created_at.eq.${after.createdAt},id.gt.${after.id})`);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    comments.push(...rows.map(rowToComment));
    if (rows.length < 1000) return comments;
    const last = rows[rows.length - 1];
    after = { createdAt: last.created_at, id: last.id };
  }
}

async function createComment(postId: string, input: string | CommentInput): Promise<CommentWithAuthor> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('ログインしてください');
  const payload = typeof input === 'string' ? { content: input } : input;
  const content = payload.content.trim();
  if ((!content && !payload.imageUrls?.length) || content.length > 280) throw new Error('返信は280文字以内、または画像を添付してください');
  const id = randomUUID();
  const { data: parent, error: parentError } = await supabase.from('posts').select('visibility').eq('id', postId).single();
  if (parentError || !parent) throw new Error('返信先の投稿を閲覧できません');
  const imageUrls = await uploadPostMedia(payload.imageUrls ?? [], userId, id, parent.visibility !== 'public');

  // INSERT直後に profiles(*) を含む select を連鎖させると環境によっては
  // PostgREST エラーが発生するため、INSERT では id のみ取得して別途 SELECT する。
  const { data, error } = await supabase
    .from('comments')
    .insert({ id, post_id: postId, user_id: userId, content, parent_comment_id: payload.parentCommentId ?? null, image_urls: imageUrls, client_name: getClientName() })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'コメントの送信に失敗しました');

  // comments_count を実数でリフレッシュ
  const { count } = await supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (count !== null) {
    await supabase.from('posts').update({ comments_count: count }).eq('id', postId);
  }

  // 挿入したコメントを author 情報込みで取得
  const { data: fullData, error: fetchError } = await supabase
    .from('comments')
    .select('*, profiles:profiles!comments_user_id_fkey(*)')
    .eq('id', data.id)
    .single();

  if (fetchError || !fullData) throw new Error('コメントの取得に失敗しました');

  return rowToComment(fullData);
}

async function getCommentLikers(commentId: string): Promise<User[]> {
  const { data, error } = await supabase.from('comment_likes').select('profiles(*)').eq('comment_id', commentId);
  if (error) throw error;
  return (data ?? []).map(row => rowToUser(row.profiles));
}

// post-activity
type ActivityTab='quotes'|'reposts'|'likes';
const hasExternalActivity=(id:string)=>id.startsWith('bsky:')||/^x:\d+$/.test(id);
type ActivityCursor={remote:string|null;remoteDone:boolean;localPage:number;localDone:boolean;remoteSeen?:string[];seen?:string[]};
async function getExternalPostActivity(id:string,tab:ActivityTab,sort:'top'|'latest',previous?:ActivityCursor,signal?:AbortSignal){
 if(id.startsWith('x:')&&tab==='likes')throw new Error('twitterのいいね一覧には対応していません');
 const cursor={...(previous??{remote:null,remoteDone:false,localPage:0,localDone:tab==='likes'})};
 cursor.remoteSeen=[...(previous?.remoteSeen??[])];cursor.seen=[...(previous?.seen??[])];
 const seen=new Set(cursor.seen);
 const reads:Promise<{users:User[];posts:PostWithAuthor[]}>[]=[];
 if(!cursor.remoteDone)reads.push((async()=>{
  const page=id.startsWith('x:')?await fetchTwitterPostActivity(id,tab as 'quotes'|'reposts',cursor.remote,signal):await fetchBlueskyPostActivity(id,tab,cursor.remote,signal);
  const rows=tab==='quotes'?page.posts:page.users;
  cursor.remoteDone=!rows.some(row=>!seen.has(row.id))||!page.cursor||page.cursor===cursor.remote||cursor.remoteSeen!.includes(page.cursor);
  if(page.cursor)cursor.remoteSeen!.push(page.cursor);cursor.remote=page.cursor;
  return {users:page.users as User[],posts:page.posts.map(normalizeTimelineBlueskyPost)};
 })());
 if(!cursor.localDone)reads.push((async()=>{
  const posts=tab==='quotes'?await getPostQuotes(id,null,sort,cursor.localPage):[];
  const users=tab==='reposts'?await getPostReposters(id,null,cursor.localPage):[];
  cursor.localDone=!(tab==='quotes'?posts:users).some(row=>!seen.has(row.id))||(tab==='quotes'?posts.length<20:users.length<50);cursor.localPage++;
  return {posts,users};
 })());
 const results=await Promise.allSettled(reads);if(signal?.aborted)throw signal.reason;
 const valid=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]),failure=results.find(result=>result.status==='rejected');
 if(failure&&!valid.some(page=>page.users.length||page.posts.length))throw failure.reason;
 const users=[...new Map(valid.flatMap(page=>page.users).map(user=>[user.id,user])).values()].filter(user=>!seen.has(user.id));
 const posts=[...new Map(valid.flatMap(page=>page.posts).map(post=>[post.id,post])).values()].filter(post=>!seen.has(post.id)).sort((a,b)=>(sort==='top'?b.likesCount-a.likesCount:0)||b.createdAt.localeCompare(a.createdAt));
 cursor.seen.push(...users.map(user=>user.id),...posts.map(post=>post.id));
 return {users,posts,next:cursor.localDone&&cursor.remoteDone?undefined:cursor};
}

// profile-highlights
const profileHighlightsKey = (userId: string) => ['posts', 'highlights', userId] as const;
const postHighlightKey = (userId: string, postId: string) => ['post-highlight', userId, postId] as const;

async function isPostHighlighted(userId: string, postId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profile_highlights')
    .select('post_id').eq('user_id', userId).eq('post_id', postId).maybeSingle();
  if (error) throw error;
  return !!data;
}

async function setPostHighlighted(userId: string, postId: string, highlighted: boolean): Promise<void> {
  const result = highlighted
    ? await supabase.from('profile_highlights').upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true })
    : await supabase.from('profile_highlights').delete().eq('user_id', userId).eq('post_id', postId);
  if (result.error) throw result.error;
}

const profilePinKey=(userId:string)=>['profile-pin',userId];
async function getProfilePin(userId:string):Promise<string|null>{
  const {data,error}=await supabase.from('profiles').select('pinned_post_id').eq('id',userId).maybeSingle();
  if(error)throw error;return data?.pinned_post_id??null;
}
async function setProfilePin(userId:string,postId:string|null):Promise<void>{
  const result=await supabase.from('profiles').update({pinned_post_id:postId}).eq('id',userId).select('id').single();
  if(result.error)throw result.error;
}

// scheduledPosts
async function getScheduledPosts():Promise<ScheduledPost[]> {const {data,error}=await supabase.rpc('get_scheduled_posts');if(error)throw error;return data??[];}
async function cancelScheduledPost(id:string) {const {error}=await supabase.rpc('cancel_scheduled_post',{post_id:id});if(error)throw error;}
async function reschedulePost(id:string,sendAt:string) {const {error}=await supabase.rpc('save_scheduled_post',{post_id:id,send_at:sendAt});if(error)throw error;}

// polls
async function discardPollImages(refs:string[]) {if(refs.length)await supabase.functions.invoke('poll-media',{body:{action:'discard',refs}});}
async function preparePoll(draft:PollDraft,postId:string):Promise<PollDraft> {
 const message=validatePollDraft(draft);if(message)throw new Error(message);
 const refs:string[]=[];
 try{
 const options=[];
 for(const option of draft.options){
  let image:string|undefined;
  if(option.image){
   if(!option.image.startsWith('blob:'))throw new Error('投票画像は端末から選んでください');
   const response=await fetch(option.image);if(!response.ok)throw new Error('画像を読み込めませんでした');
   const file=await response.blob();if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)||!file.size||file.size>8*1024*1024)throw new Error('投票画像は対応形式で8MB以内にしてください');
   const body=new FormData();body.set('postId',postId);body.set('file',file,'poll-image');
   const {data,error}=await supabase.functions.invoke('poll-media',{body});if(error||typeof data?.ref!=='string'||!data.ref.startsWith('cloudinary:polls/'))throw new Error('投票画像のアップロードに失敗しました');
   image=data.ref;refs.push(image!);
  }
  options.push({label:option.label.trim(),...(image?{image}:{})});
 }
 return {durationMinutes:draft.durationMinutes,options};
 }catch(error){await discardPollImages(refs);throw error;}
}
async function readPoll(postId:string,viewer:string|null):Promise<{poll:Poll;selected:number|null;urls:Record<string,string>}> {
 const {data,error}=await supabase.from('posts').select('poll').eq('id',postId).single();if(error||!data?.poll)throw error??new Error('投票が見つかりません');
 let selected:number|null=null;
 if(viewer){const result=await supabase.from('poll_votes').select('option_index').eq('post_id',postId).eq('user_id',viewer).maybeSingle();if(result.error)throw result.error;selected=result.data?.option_index??null;}
 let urls:Record<string,string>={};
 if(data.poll.options.some((option:{image?:string})=>!!option.image)){const result=await supabase.functions.invoke('poll-media',{body:{action:'resolve',postIds:[postId]}});if(result.error)throw result.error;urls=result.data?.urls??{};}
 return {poll:data.poll as Poll,selected,urls};
}
async function votePoll(postId:string,option:number) {
 const viewer=await getCurrentUserId();if(!viewer)throw new Error('ログインして投票してください');
 const {error}=await supabase.from('poll_votes').insert({post_id:postId,user_id:viewer,option_index:option});
 if(error&&error.code!=='23505')throw error;
 return viewer;
}

export { getCommentsByPost };
export { createComment };
export { getCommentLikers };
export type { CommentInput };
export { getExternalPostActivity };
export type { ActivityTab };
export { hasExternalActivity };
export type { ActivityCursor };
export { isPostHighlighted };
export { setPostHighlighted };
export { getProfilePin };
export { setProfilePin };
export { profileHighlightsKey };
export { postHighlightKey };
export { profilePinKey };
export { getScheduledPosts };
export { cancelScheduledPost };
export { reschedulePost };
export { discardPollImages };
export { preparePoll };
export { readPoll };
export { votePoll };
