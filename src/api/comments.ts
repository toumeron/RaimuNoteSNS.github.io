import { randomUUID, getClientName } from "@/lib/utils";
import { type CommentWithAuthor, type User, type PostWithAuthor } from "@/types/index";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/currentUser";
import { uploadPostMedia } from "@/lib/mediaThumbnail";
import { fetchBlueskyPostActivity } from "@/lib/bluesky";
import { fetchTwitterPostActivity } from "@/lib/fxTwitter";
import { normalizeTimelineBlueskyPost } from "@/lib/timelinePaging";
import { getPostQuotes, getPostReposters } from "@/api/posts";
import { type ScheduledPost } from "@/components/feed/PostPoll";
import { validatePollDraft, type PollDraft, type Poll } from "@/lib/utils";

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
