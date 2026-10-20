import { getPrivateBotPrompt, isAccountReadOnly } from "@/lib/accountSuspension";
import { randomUUID, getClientName } from "@/lib/utils";
import { type User, type PostWithAuthor } from "@/types/index";
import { supabase } from "@/lib/supabase";
import { fetchBlueskyFollowers, fetchBlueskyFollows, isBlueskyProfileId, searchExternalUsers } from "@/lib/bluesky";
import { refreshNotificationBadge, dismissNotificationToasts } from "@/lib/registerPwa";
import { type AccountReadContext } from "@/lib/accountReadClient";
import { getCurrentUserId } from "@/lib/currentUser";
import { type LiveSpace, type SpaceMember } from "@/components/spaces/SpaceProvider";
import { recordRecommendationEngagement } from "@/lib/recommendations";
import { getPostById } from "@/api/posts";
import { externalLikeSnapshot, completeSavedPosts, isExternalPostId } from "@/api/external-posts";

// users
// users
// Keep the fields returned by toUser; exclude unrelated profile settings.
const USER_SELECT_COLUMNS = 'id, username, display_name, bio, location, avatar_url, cover_url, created_at, is_official, is_private, emoji_effect, bot_enabled, review, Account_suspension';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(row: any): User {
  return {
    id: row.id as string,
    isSuspended: row.Account_suspension === true,
    review: row.review === true,
    isPrivate: row.is_private === true,
    username: row.username as string,
    displayName: (row.display_name ?? '') as string,
    bio: (row.bio ?? '') as string,
    location: (row.location ?? '') as string,
    avatarUrl: (row.avatar_url ?? '') as string,
    coverUrl: (row.cover_url ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    isOfficial:  (row.is_official  ?? false) as boolean,
    emojiEffect: (row.emoji_effect ?? '') as string,
    // bot関連のプロパティを追加
    bot_enabled: (row.bot_enabled ?? false) as boolean,
    bot_prompt: undefined, // Private settings are fetched separately by their owner.
  };
}

async function getUserByUsername(username: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(USER_SELECT_COLUMNS)
    .eq('username', username)
    .maybeSingle();

  if (error || !data) return null;
  return toUser(data);
}

async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(USER_SELECT_COLUMNS)
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return toUser(data);
}

/**
 * プロフィール更新（画像アップロード対応版）
 */
async function updateProfile(
  id: string,
  patch: Partial<Pick<User, 'displayName' | 'bio' | 'location' | 'avatarUrl' | 'coverUrl' | 'emojiEffect' | 'bot_enabled' | 'bot_prompt' | 'isPrivate'>>,
): Promise<User> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.isPrivate !== undefined) dbPatch.is_private = patch.isPrivate;
  if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
  if (patch.bio !== undefined) dbPatch.bio = patch.bio;
  if (patch.location !== undefined) dbPatch.location = patch.location.trim();
  if (patch.emojiEffect !== undefined) dbPatch.emoji_effect = patch.emojiEffect;
  // bot関連の値をDBのカラム名（スネークケース）にマッピングして追加
  if (patch.bot_enabled !== undefined) dbPatch.bot_enabled = patch.bot_enabled;
  if (patch.bot_prompt !== undefined) {
    // Never write a private prompt into the legacy public column unless the
    // server-side migration that redirects it to owner-only storage is present.
    try { await getPrivateBotPrompt(id); }
    catch { throw new Error('Bot設定の非公開保存先が利用できません。データベースの更新後に再試行してください。'); }
    dbPatch.bot_prompt = patch.bot_prompt;
  }

  // --- 画像アップロードの共通処理 ---
  const uploadImage = async (url: string, bucket: string) => {
    // blob: 形式でない（すでに https:// 等）ならそのまま返す
    if (!url.startsWith('blob:')) return url;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const fileExt = blob.type.split('/')[1] || 'png';
      // ファイル名は重複しないように UUID を使用
      const fileName = `${id}/${randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      // 公開 URL を取得
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      return data.publicUrl;
    } catch (err) {
      console.error(`Upload failed to ${bucket}:`, err);
      return url; // 失敗時はそのまま返してフォールバック
    }
  };

  // avatarUrl があればアップロード（avatars バケットを使用）
  if (patch.avatarUrl) {
    dbPatch.avatar_url = await uploadImage(patch.avatarUrl, 'avatars');
  }

  // coverUrl があればアップロード（posts バケットを流用、または profiles バケットを作成）
  if (patch.coverUrl) {
    dbPatch.cover_url = await uploadImage(patch.coverUrl, 'posts');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(dbPatch)
    .eq('id', id)
    .select(USER_SELECT_COLUMNS)
    .single();

  if (error || !data) throw new Error('ユーザーが見つかりません');
  return toUser(data);
}

/** Return the public aggregate, including restricted activity, without bodies. */
async function getProfileActivityCount(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_profile_activity_count', { target_user_id: userId });
  if (error) throw error;
  if (typeof data !== 'number' && typeof data !== 'string') throw new Error('Invalid profile activity count');
  const count = Number(data);
  if (data == null || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid profile activity count');
  return count;
}

type AccountReview = {
  id: string; author_id: string; rating: number; title: string; content: string; created_at: string;
  likes_count: number; liked_by_me: boolean;
  author: { username: string; display_name: string; avatar_url: string; is_official: boolean; is_private?: boolean };
};
type AccountReviews = {
  enabled: boolean; total: number; average: number; distribution: Record<string, number>; reviews: AccountReview[];
};
const accountReviewsKey = (profileId: string) => ['account-reviews', profileId] as const;
async function getAccountReviews(profileId: string, offset = 0): Promise<AccountReviews> {
  const { data, error } = await supabase.rpc('get_account_reviews', { target_profile: profileId, page_offset: offset });
  if (error) throw error;
  return data as AccountReviews;
}
async function submitAccountReview(profileId: string, rating: number, title: string, content: string) {
  const { error } = await supabase.rpc('submit_account_review', {
    target_profile: profileId, stars: rating, review_title: title, review_content: content,
  });
  if (error) throw error;
}
async function setAccountReviewLike(reviewId: string, enabled: boolean): Promise<{liked: boolean; count: number}> {
  const { data, error } = await supabase.rpc('set_account_review_like', { target_review: reviewId, enabled });
  if (error) throw error;
  return data;
}

// follows
// accountPrivacy
type AccountFollowState = { followed: boolean; requested: boolean; canView: boolean };
type FollowRequest = { id: string; username: string; displayName: string; avatarUrl: string; isPrivate: boolean; isOfficial: boolean };
async function getAccountFollowState(id: string): Promise<AccountFollowState> {
 const { data, error } = await supabase.rpc('get_account_follow_state', { target_user_id: id });
 if (error) throw error;
 return data;
}
async function toggleAccountFollow(id: string): Promise<AccountFollowState> {
 const { data, error } = await supabase.rpc('toggle_account_follow', { target_user_id: id });
 if (error) throw error;
 return data;
}
async function getFollowRequests(): Promise<FollowRequest[]> {
 const { data, error } = await supabase.rpc('get_account_follow_requests');
 if (error) throw error;
 return data ?? [];
}
async function respondFollowRequest(id: string, accept: boolean) {
 const { error } = await supabase.rpc('respond_account_follow_request', { requester_id: id, accept_request: accept });
 if (error) throw error;
}

// follows
// ── 修正内容 ──────────────────────────────────────────────────────────────
// DB の follows テーブルの実際のカラム名は follower_id / followee_id。
// コードが following_id を使っていたため 42703(column does not exist) が発生。
// また id カラムが存在しないため select('id') も 42703 エラーになっていた。
//   select('id', { count: 'exact' })
//     → select('*', { count: 'exact', head: true })  に変更
//   following_id  →  followee_id  に全箇所置換
// ─────────────────────────────────────────────────────────────────────────

async function getFollowStats(userId: string): Promise<{
  followers: number;
  following: number;
  followedByMe: boolean;
  requestedByMe?: boolean;
  canView?: boolean;
}> {
  // External provider IDs are not UUIDs in Lime's follows table.
  if (userId.startsWith('x-user:') || userId.startsWith('misskey-user:') || userId.startsWith('did:')) {
    return { followers: 0, following: 0, followedByMe: false };
  }
  const state = await getAccountFollowState(userId);

  const [followersRes, followingRes] = await Promise.all([
    // 自分をフォローしている人の数 (userId が followee_id 側)
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('followee_id', userId),
    // userId がフォローしている人の数 (userId が follower_id 側)
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId),
  ]);

  return {
    followers:    followersRes.count    ?? 0,
    following:    followingRes.count    ?? 0,
    followedByMe: state.followed,
    requestedByMe: state.requested,
    canView: state.canView,
  };
}

async function toggleFollow(targetUserId: string): Promise<{ followed: boolean; requested?: boolean }> {
  return toggleAccountFollow(targetUserId);
}

type KnownFollower = { id: string; username: string; displayName: string; avatarUrl: string };

/** Visible, accepted followers that the viewer already follows. */
async function getKnownFollowers(viewerId: string, targetId: string): Promise<{total:number;users:KnownFollower[]}> {
  const empty={total:0,users:[] as KnownFollower[]};
  if(!viewerId||viewerId===targetId||targetId.startsWith('did:')||targetId.startsWith('misskey-user:')||targetId.startsWith('x-user:'))return empty;
  const followedIds=new Set<string>();
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from('follows').select('followee_id').eq('follower_id',viewerId).eq('approved',true).order('followee_id').range(offset,offset+999);
    if(error)throw error;
    for(const row of data??[])if(row.followee_id&&row.followee_id!==viewerId)followedIds.add(row.followee_id);
    if((data?.length??0)<1000)break;
  }
  const ids=[...followedIds];
  let total=0;const users:KnownFollower[]=[];
  for(let offset=0;offset<ids.length;offset+=200){
    const {data,count,error}=await supabase.from('follows').select('profile:profiles!follows_follower_id_fkey(id,username,display_name,avatar_url)',{count:'exact'}).eq('followee_id',targetId).eq('approved',true).in('follower_id',ids.slice(offset,offset+200)).order('follower_id').range(0,2);
    if(error)throw error;
    total+=count??0;
    for(const row of data??[]){
      const profile=Array.isArray(row.profile)?row.profile[0]:row.profile;
      if(profile&&users.length<3)users.push({id:profile.id,username:profile.username,displayName:profile.display_name||profile.username,avatarUrl:profile.avatar_url||''});
    }
  }
  return {total,users};
}

// account-about
type AccountAbout = {
  user_id: string;
  country_code: string | null;
  connection_source: string | null;
  connection_updated_at: string | null;
  username_change_count: number;
  last_username_change_at: string | null;
  tracking_since: string;
};
const accountAboutKey = (id: string) => ['account-about', id] as const;

async function getAccountAbout(id: string): Promise<AccountAbout | null> {
  const { data, error } = await supabase.from('profiles')
    .select('user_id:id,country_code,connection_source,connection_updated_at,username_change_count,last_username_change_at,tracking_since:username_tracking_since')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data as AccountAbout | null;
}

function countryName(code: string | null): string {
  if (!code) return '未取得';
  try { return new Intl.DisplayNames(['ja'], { type: 'region' }).of(code) ?? code; }
  catch { return code; }
}

// The default country.is endpoint returns only IP and country. Do not request
// optional city/location fields, use GPS, or retain the returned IP address.
async function detectCountry(signal?: AbortSignal): Promise<string | null> {
  // Enable only after approval to send the caller's IP to the country service.
  if (import.meta.env.VITE_ACCOUNT_COUNTRY_LOOKUP_ENABLED !== 'true') return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 10000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetch('https://api.country.is/', {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('国情報を取得できませんでした');
    const { country } = await response.json();
    return typeof country === 'string' && /^[A-Z]{2}$/.test(country) &&
      country !== 'XX' ? country : null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function syncAccountConnection(id: string, signal?: AbortSignal): Promise<boolean> {
  if (import.meta.env.VITE_ACCOUNT_COUNTRY_LOOKUP_ENABLED !== 'true') return false;
  const existing = await getAccountAbout(id);
  if (signal?.aborted) return false;
  if (existing?.connection_updated_at &&
      Date.now() - Date.parse(existing.connection_updated_at) < 24 * 60 * 60 * 1000) return false;
  const country = await detectCountry(signal);
  if (signal?.aborted || !country) return false;
  const { error } = await supabase.rpc('update_account_connection', {
    expected_user_id: id, country, client: getClientName(),
  });
  if (error) throw error;
  return true;
}

// followLists
type FollowListTab='known'|'followers'|'following';
type FollowListPage={users:User[];cursor:string|null};
const mapProfile=(p:any):User=>({id:p.id,username:p.username,displayName:p.display_name||p.displayName||p.username,avatarUrl:p.avatar_url||p.avatarUrl||'',bio:p.bio||'',coverUrl:p.cover_url||'',createdAt:p.created_at||'',isOfficial:p.is_official??p.isOfficial??false,providerVerification:p.providerVerification,isPrivate:p.is_private??p.isPrivate??false});
async function fetchFollowListPage(target:User,tab:FollowListTab,viewerId:string,cursor:string|null,signal?:AbortSignal):Promise<FollowListPage>{
 const known=tab==='known',following=tab==='following';
 let knownIds=new Set<string>(),knownHandles=new Set<string>();
 if(known){
  for(let offset=0;;offset+=1000){
   const {data,error}=await supabase.from('follows').select('followee_id,external_handle').eq('follower_id',viewerId).eq('approved',true).order('created_at',{ascending:false}).range(offset,offset+999).abortSignal(signal!);
   if(error)throw error;for(const row of data??[]){if(row.followee_id)knownIds.add(row.followee_id);if(row.external_handle)knownHandles.add(row.external_handle.toLowerCase());}if((data?.length??0)<1000)break;
  }
 }
 if(isBlueskyProfileId(target.id)){
  const page=await (following?fetchBlueskyFollows:fetchBlueskyFollowers)({actor:target.username,cursor,limit:50,signal});
  return {users:page.users.map(profile=>profile as User).filter(profile=>!known||knownHandles.has(profile.username.toLowerCase())),cursor:page.cursor};
 }
 const offset=Number(cursor??0);
 const {data,error}=await supabase.from('follows').select(`${following?'followee_id,external_provider,external_handle,external_profile':'follower_id'},profile:profiles!${following?'follows_followee_id_fkey':'follows_follower_id_fkey'}(id,username,display_name,avatar_url,bio,is_official,is_private,created_at)`).eq(following?'follower_id':'followee_id',target.id).eq('approved',true).order('created_at',{ascending:false}).range(offset,offset+49).abortSignal(signal!);
 if(error)throw error;
 const users=(data??[]).map((row:any)=>{
  const profile=Array.isArray(row.profile)?row.profile[0]:row.profile;
  if(profile)return !known||knownIds.has(profile.id)?mapProfile(profile):null;
  if(!following||!row.external_provider)return null;
  const p=row.external_profile??{};
  const twitter=row.external_provider==='x';
  const username=p.username??(twitter?`${row.external_handle.replace(/@(?:x|twitter)\.com$/i,'')}@twitter.com`:row.external_handle);
  return mapProfile({...p,id:p.id??(twitter?'x-user:':row.external_provider==='misskey'?'misskey-user:':'did:handle:')+row.external_handle,username});
 });
 return {users:users.filter((profile):profile is User=>!!profile),cursor:data?.length===50?String(offset+50):null};
}

// accountSearch
/** Shared with the search page and list member search. */
function searchProfileUser(row:Record<string,any>):User {
 return {id:row.id,username:row.username,displayName:row.display_name||row.displayName||'User',avatarUrl:row.avatar_url||row.avatarUrl||'',coverUrl:row.cover_url||'',createdAt:row.created_at||'',bio:row.bio||'',isOfficial:!!(row.is_official||row.isOfficial),isPrivate:!!(row.is_private||row.isPrivate),providerVerification:row.providerVerification};
}
async function searchAccounts(query:string,signal?:AbortSignal):Promise<User[]> {
 if (isAccountReadOnly()) return [];
 const q=query.trim().replace(/^@+/, '');if(!q)return [];
 const safe=q.replace(/[%_,().\\]/g,'').slice(0,100);
 const native=supabase.from('profiles').select('id,username,display_name,avatar_url,bio,is_official,is_private').or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%,bio.ilike.%${safe}%`).limit(15).abortSignal(signal??new AbortController().signal);
 const results=await Promise.allSettled([native,searchExternalUsers(q,{signal,limit:15})]);if(signal?.aborted)throw signal.reason;
 const local=results[0].status==='fulfilled'?results[0].value:null;if(local?.error)throw local.error;
 if(results.every(item=>item.status==='rejected'))throw new Error('ユーザーを検索できませんでした');
 return [...new Map([...(local?.data??[]).map(searchProfileUser),...(results[1].status==='fulfilled'?results[1].value:[])].map(user=>[user.id,user])).values()];
}

// directMessages
// directMessages
type DirectPeer={id:string;username:string;displayName:string;avatarUrl:string;isPrivate?:boolean;isOfficial?:boolean;createdAt:string;groupAvatars?:string[]};
type DirectConversation={id:string;status:'pending'|'accepted'|'declined';initiatedBy:string;updatedAt:string;peer:DirectPeer;preview:string;hasMedia:boolean;unreadCount:number;pinned?:boolean;isGroup?:boolean};
type DirectMessage={id:string;conversation_id:string;sender_id:string;content:string;attachments:string[];created_at:string;mediaUrls:string[];friend_id?:string|null;friend_name?:string|null;friend_avatar?:string|null;reply_to?:string|null;system_event?:string|null;reactions?:Record<string,Record<string,boolean>>};
const directKeys={inbox:['direct-inbox'] as const,messages:(id:string)=>['direct-messages',id] as const,preferences:['direct-preferences'] as const};
async function getDirectInbox():Promise<DirectConversation[]>{const {data,error}=await supabase.rpc('get_direct_inbox');if(error)throw error;return (data??[]).map(decorateDirectConversation);}
async function getDirectPreferences():Promise<'everyone'|'none'>{const {data,error}=await supabase.rpc('get_dm_preferences');if(error)throw error;return data;}
async function setDirectPreferences(value:'everyone'|'none'){const {error}=await supabase.rpc('set_dm_preferences',{value});if(error)throw error;}
async function openDirectConversation(userId:string):Promise<string>{const {data,error}=await supabase.rpc('open_direct_conversation',{target_user:userId});if(error)throw error;return data;}
async function sendDirectMessage(peerId:string,content:string,attachments:string[]=[],messageId=randomUUID()):Promise<string>{const {data,error}=await supabase.rpc('send_direct_message',{target_user:peerId,body:content,media:attachments,message_id:messageId});if(error)throw error;return data;}
async function respondDirectRequest(id:string,accept:boolean){const {error}=await supabase.rpc('respond_direct_request',{target:id,accept_request:accept});if(error)throw error;}
async function readDirectConversation(id:string,throughTime:string){const {error}=await supabase.rpc('read_direct_conversation',{target:id,through_time:throughTime});if(error)throw error;const {data:notifications}=await supabase.from('notifications').select('id,user_id').eq('conversation_id',id).eq('is_read',true).limit(1000);if(notifications?.length){const ids=notifications.map(n=>n.id);dismissNotificationToasts(ids);await refreshNotificationBadge(notifications[0].user_id,ids).catch(()=>{});}}
async function getDirectMessages(id:string,before?:{created_at:string;id:string}):Promise<DirectMessage[]>{
 let query=supabase.from('direct_messages').select('id,conversation_id,sender_id,content,attachments,created_at,friend_id,friend_name,friend_avatar,reply_to,system_event,reactions').eq('conversation_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
 if(before)query=query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
 const {data,error}=await query;if(error)throw error;
 const rows=data??[];const cloudRows=rows.filter(row=>(row.attachments??[]).some((ref:string)=>ref.startsWith('cloudinary:')));
 let cloudUrls:Record<string,string>={};if(cloudRows.length){const {data:result,error}=await supabase.functions.invoke('direct-media',{body:{action:'read',messageIds:cloudRows.map(row=>row.id)}});if(error||!result?.urls)throw new Error('DM画像を表示できませんでした');cloudUrls=result.urls;}
 return Promise.all(rows.map(async row=>{
  const paths=(row.attachments??[]) as string[];const legacy=paths.filter(path=>!path.startsWith('cloudinary:'));const urls={...cloudUrls};
  if(legacy.length){const {data:result,error}=await supabase.storage.from('direct-message-media').createSignedUrls(legacy,3600);if(error)throw error;for(const item of result??[])if(item.path&&item.signedUrl)urls[item.path]=item.signedUrl;}
  return {...row,mediaUrls:paths.flatMap(ref=>urls[ref]?[urls[ref]]:[])} as DirectMessage;
 }));
}
async function searchDirectPeers(term:string):Promise<DirectPeer[]>{
 if (isAccountReadOnly()) return [];
 const text=term.trim().replace(/[%_,()]/g,'');if(!text)return [];
 const {data,error}=await supabase.from('profiles').select('id,username,display_name,avatar_url,is_private,is_official,created_at').or(`username.ilike.%${text}%,display_name.ilike.%${text}%`).limit(20);if(error)throw error;
 return (data??[]).map(row=>({id:row.id,username:row.username,displayName:row.display_name||row.username,avatarUrl:row.avatar_url||'',isPrivate:row.is_private,isOfficial:row.is_official,createdAt:row.created_at}));
}
async function uploadDirectMedia(conversationId:string,_userId:string,files:File[]):Promise<string[]>{
 if(files.length>4||files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10485760))throw new Error('画像はJPEG・PNG・WebP形式で、1枚10MB以下・4枚まで添付できます');
 const refs:string[]=[];
 try{for(const file of files){const body=new FormData();body.set('conversationId',conversationId);body.set('file',file);const {data,error}=await supabase.functions.invoke('direct-media',{body});if(error||typeof data?.ref!=='string'||!data.ref.startsWith('cloudinary:'))throw new Error('DM画像のアップロードに失敗しました');refs.push(data.ref);}return refs;}
 catch(error){if(refs.length)await discardDirectMedia(refs);throw error;}
}
async function discardDirectMedia(refs:string[]){if(!refs.length)return;const {error}=await supabase.functions.invoke('direct-media',{body:{action:'discard',refs}});if(error)throw error;}

type ChatInboxPreferences={pins:Record<string,boolean>;hidden:Record<string,boolean>};
async function getChatInboxPreferences():Promise<ChatInboxPreferences>{const {data,error}=await supabase.rpc('get_chat_inbox_preferences');if(error)throw error;return data??{pins:{},hidden:{}};}
async function setChatInboxPreference(chat:string,kind:'pins'|'hidden',value:boolean){const {error}=await supabase.rpc('set_chat_inbox_preference',{chat,kind,value});if(error)throw error;}
async function deleteDirectChat(id:string){const {error}=await supabase.rpc('delete_direct_chat',{target:id});if(error)throw error;}

async function canDirectMessage(userId:string):Promise<boolean>{const {data,error}=await supabase.rpc('can_direct_message',{target_user:userId});if(error)throw error;return data===true;}

type DirectGroupMember=DirectPeer&{status:'accepted'|'pending';admin:boolean};
type DirectGroup=DirectConversation&{isGroup:true;createdAt:string;description:string;adminOnly:boolean;inviteToken:string|null;muted:boolean;friends?:GroupFriend[];members:DirectGroupMember[];requests:DirectPeer[]};
function decorateDirectConversation(c:DirectConversation):DirectConversation{
 if((c as DirectGroup).isGroup){const g=c as DirectGroup;c.peer={...c.peer,groupAvatars:[...g.members.filter(m=>m.id!==g.initiatedBy),...(g.friends??[])].slice(0,2).map(m=>m.avatarUrl)};}
 return c;
}
async function getDirectGroup(id:string):Promise<DirectGroup>{const {data,error}=await supabase.rpc('get_group_direct_conversation',{target:id});if(error)throw error;return decorateDirectConversation(data) as DirectGroup;}
async function createDirectGroup(people:string[],name=''):Promise<string>{const {data,error}=await supabase.rpc('create_group_direct_conversation',{people,name});if(error)throw error;return data;}
async function updateDirectGroup(id:string,input:{name:string;description:string;avatar:string;onlyAdmin:boolean}){const {error}=await supabase.rpc('update_group_direct_conversation',{target:id,name:input.name,description:input.description,avatar:input.avatar,only_admin:input.onlyAdmin,disappearing:0});if(error)throw error;}
async function addDirectGroupMembers(id:string,people:string[]){const {error}=await supabase.rpc('add_group_direct_members',{target:id,people});if(error)throw error;}
async function manageDirectGroupMember(id:string,person:string,action:'approve'|'reject'|'admin'|'remove'){const {error}=await supabase.rpc('manage_group_direct_member',{target:id,person,action});if(error)throw error;}
async function muteDirectGroup(id:string,value:boolean){const {error}=await supabase.rpc('set_group_direct_muted',{target:id,value});if(error)throw error;}
async function setDirectGroupInvite(id:string,enabled:boolean):Promise<string|null>{const {data,error}=await supabase.rpc('set_group_direct_invite',{target:id,enabled});if(error)throw error;return data;}
async function sendDirectGroupMessage(id:string,body:string,media:string[]=[],messageId=randomUUID()){const {error}=await supabase.rpc('send_group_direct_message',{target:id,body,media,message_id:messageId});if(error)throw error;}
async function getDirectGroupInvitation(token:string):Promise<{name:string;avatarUrl:string;memberCount:number}|null>{const {data,error}=await supabase.rpc('get_group_direct_invitation',{token});if(error)throw error;return data;}
async function requestDirectGroupJoin(token:string):Promise<string>{const {data,error}=await supabase.rpc('request_group_direct_join',{token});if(error)throw error;return data;}

type GroupFriend=DirectPeer&{ownerId?:string};
type GroupFriendDraft={id:string;name:string;avatar:string;prompt:string};
async function createGroupWithFriends(people:string[],friends:GroupFriendDraft[]){const {data,error}=await supabase.rpc('create_group_with_friends',{people,friends,name:''});if(error)throw error;return data as string;}
async function addGroupFriends(id:string,friends:GroupFriendDraft[]){const {error}=await supabase.rpc('add_group_ai_friends',{target:id,friends});if(error)throw error;}
async function removeGroupFriend(id:string,friend:string){const {error}=await supabase.rpc('remove_group_ai_friend',{target:id,friend});if(error)throw error;}
async function askGroupFriends(conversationId:string,messageId:string){const {data,error}=await supabase.functions.invoke('group-friends',{body:{conversationId,messageId}});if(error)throw error;return (data?.failures??[]) as string[];}

async function toggleDirectReaction(id:string,emoji:string){const {error}=await supabase.rpc("toggle_direct_reaction",{target:id,emoji});if(error)throw error;}
async function deleteDirectMessage(id:string,forEveryone:boolean){const {error}=await supabase.rpc("delete_direct_message",{target:id,for_everyone:forEveryone});if(error)throw error;}

async function sendDirectReply(replyMessage:string,body:string,media:string[],messageId:string){const {data,error}=await supabase.rpc("send_direct_reply",{reply_message:replyMessage,body,media,message_id:messageId});if(error)throw error;return data as string;}

// notifications
const notificationKinds = ['new_post','mention','reply','like','repost','reaction','follow','dm','dm_request'] as const;
type NotificationKind = typeof notificationKinds[number];
type NotificationPreference = NotificationKind | 'push';
type NotificationPreferences = Record<NotificationPreference, boolean>;
const notificationLabels: Record<NotificationPreference,string> = {new_post:'新着ポスト',mention:'メンション',reply:'返信',like:'いいね',repost:'リポスト',reaction:'リアクション',follow:'フォロー',dm:'ダイレクトメッセージ',dm_request:'メッセージリクエスト',push:'端末へのプッシュ通知'};
type NotificationRow = {id:string;user_id:string;actor_id:string|null;post_id:string|null;comment_id?:string|null;conversation_id?:string|null;direct_message_id?:string|null;type:NotificationKind;actor_name:string|null;actor_username?:string|null;actor_avatar_url:string|null;actor_is_official?:boolean;actor_is_private?:boolean;content_preview:string|null;image_urls?:string[];emoji?:string|null;external_post_id?:string|null;is_read:boolean;created_at:string};
type NotificationSubscription = {id:string;subscriber_id:string;provider:'limenote'|'bluesky'|'misskey';target_user_id:string|null;external_actor:string|null;target_name:string|null;target_avatar_url:string|null;profiles?:{username:string;display_name:string;avatar_url:string}|null};
function normalizePreferences(value: Partial<NotificationPreferences> = {}): NotificationPreferences {
 return Object.fromEntries([...notificationKinds,'push'].map(kind=>[kind,value[kind]!==false])) as NotificationPreferences;
}
async function getNotificationPreferences(userId:string) {
 const {data,error}=await supabase.from('profile_private_settings').select('notification_preferences').eq('user_id',userId).maybeSingle();
 if(error)throw error;return normalizePreferences(data?.notification_preferences??{});
}
async function setNotificationPreference(kind:NotificationPreference,enabled:boolean) {
 const {error}=await supabase.rpc('set_notification_preference',{kind,enabled});if(error)throw error;
}
async function getNotifications(userId:string,page=0,context?:AccountReadContext) {
 const client=context?.client??supabase;
 context?.signal?.throwIfAborted();
 const {data,error}=await client.from('notifications').select('*').eq('user_id',userId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*50,page*50+49);
 if(error)throw error;
 const rows=(data??[]) as NotificationRow[];
 const actorIds=[...new Set(rows.flatMap(row=>row.actor_id?[row.actor_id]:[]))];
 if(!actorIds.length)return rows;
 const {data:actors,error:actorsError}=await client.from('profiles').select('id,is_private').in('id',actorIds);
 if(actorsError)throw actorsError;
 const privateActors=new Map((actors??[]).map(actor=>[actor.id,actor.is_private===true]));
 return rows.map(row=>({...row,actor_is_private:row.actor_id?privateActors.get(row.actor_id)===true:false}));
}
async function markNotificationsRead(userId:string,ids:string[],context?:AccountReadContext) {
 if(context&&context.userId!==userId)throw new Error('通知のアカウントが一致しません');
 const client=context?.client??supabase;
 if(!ids.length)return;const {error}=await client.from('notifications').update({is_read:true}).eq('user_id',userId).in('id',ids);if(error)throw error;
 dismissNotificationToasts(ids);
 void refreshNotificationBadge(userId,ids,context).catch(()=>{});
}
async function markAllNotificationsRead(userId:string,context?:AccountReadContext) {
 if(context&&context.userId!==userId)throw new Error('通知のアカウントが一致しません');
 const client=context?.client??supabase;
 const {error}=await client.from('notifications').update({is_read:true}).eq('user_id',userId).eq('is_read',false);
 if(error)throw error;
 dismissNotificationToasts();
 void refreshNotificationBadge(userId,[],context).catch(()=>{});
}
async function getNotificationSubscriptions(userId:string) {
 const {data,error}=await supabase.from('post_notification_subscriptions').select('id,subscriber_id,provider,target_user_id,external_actor,target_name,target_avatar_url,profiles:profiles!post_notification_subscriptions_target_user_id_fkey(username,display_name,avatar_url)').eq('subscriber_id',userId).order('created_at',{ascending:false});
 if(error)throw error;return (data??[]) as unknown as NotificationSubscription[];
}
async function removeNotificationSubscription(userId:string,id:string) {
 const {error}=await supabase.from('post_notification_subscriptions').delete().eq('subscriber_id',userId).eq('id',id);if(error)throw error;
}
function notificationLink(n:NotificationRow) {
 if((n.type==='dm'||n.type==='dm_request')&&n.conversation_id)return `/messages/${encodeURIComponent(n.conversation_id)}`;
 if(n.external_post_id)return `/post/${encodeURIComponent(n.external_post_id)}`;
 if(n.comment_id)return `/post/${encodeURIComponent(`reply:${n.comment_id}`)}`;
 if(n.post_id)return `/post/${encodeURIComponent(n.post_id)}`;
 return n.actor_username?`/u/${encodeURIComponent(n.actor_username)}`:'/notifications';
}
function groupNotifications(rows:NotificationRow[]) {
 const groups: {key:string;rows:NotificationRow[]}[]=[];
 for(const row of rows){
  const date=new Date(row.created_at).toLocaleDateString('ja-JP');
  const canGroup=['like','repost','reaction','follow'].includes(row.type);
  const key=canGroup?`${date}:${row.type}:${row.post_id??''}:${row.comment_id??''}:${row.emoji??''}:${row.external_post_id??''}`:row.id;
  const group=groups.find(g=>g.key===key);
  if(group)group.rows.push(row);else groups.push({key,rows:[row]});
 }
 return groups;
}
function notificationDescription(kind:NotificationKind,emoji?:string|null) {
 return {new_post:'さんが新しく投稿しました',mention:'さんがあなたをメンションしました',reply:'さんがあなたに返信しました',like:'さんがあなたのポストをいいねしました',repost:'さんがあなたのポストをリポストしました',reaction:`さんがあなたのポストに${emoji??''}でリアクションしました`,follow:'さんがあなたをフォローしました',dm:'さんからメッセージが届きました',dm_request:'さんからメッセージリクエストが届きました'}[kind]??'さんからの通知';
}

// lists
// lists
type ListMember=Pick<User,'id'|'username'|'displayName'|'avatarUrl'|'bio'|'isOfficial'|'isPrivate'|'providerVerification'>;
type UserList={id:string;owner_id:string;name:string;description:string;is_private:boolean;cover_ref:string|null;members:ListMember[];created_at:string;updated_at:string;owner:{username:string;display_name:string;avatar_url:string;is_official?:boolean;is_private?:boolean};coverUrl?:string;followers?:number;saved?:boolean};
const select='*,owner:profiles!owner_id(username,display_name,avatar_url,is_official,is_private)';
const listsKey=(owner?:string)=>['user-lists',owner??null];
function listMember(user:ListMember):ListMember{return {id:user.id,username:user.username,displayName:(user.displayName??user.username).slice(0,100),avatarUrl:user.avatarUrl?.startsWith('https://')?user.avatarUrl.slice(0,2000):'',bio:(user.bio??'').slice(0,500),isOfficial:!!user.isOfficial,isPrivate:!!user.isPrivate,...(user.providerVerification?{providerVerification:user.providerVerification}:{})};}
async function enrich(rows:UserList[],saved:string[]=[]) {
 if(!rows.length)return rows;
 if(rows.length>100){const result:UserList[]=[];for(let start=0;start<rows.length;start+=100)result.push(...await enrich(rows.slice(start,start+100),saved));return result;}
 const [{data:counts,error},media]=await Promise.all([
  supabase.rpc('list_follower_counts',{list_ids:rows.map(row=>row.id)}),
  rows.some(row=>row.cover_ref)?supabase.functions.invoke('list-media',{body:{action:'resolve',listIds:rows.map(row=>row.id)}}):Promise.resolve({data:{urls:{}},error:null}),
 ]);
 if(error)throw error;if(media.error)throw media.error;
 return rows.map(row=>({...row,saved:saved.includes(row.id),followers:counts?.find((item:{id:string})=>item.id===row.id)?.followers??0,coverUrl:row.cover_ref?media.data?.urls?.[row.cover_ref]:undefined}));
}
async function getLists(owner?:string):Promise<UserList[]> {
 const saved=owner?await supabase.from('profile_private_settings').select('saved_lists').eq('user_id',owner).maybeSingle():{data:null,error:null};if(saved.error)throw saved.error;
 const ids:string[]=saved.data?.saved_lists??[];
 const [mine,discovery,followed]=await Promise.all([
  owner?supabase.from('user_lists').select(select).eq('owner_id',owner).order('created_at',{ascending:false}).limit(100):Promise.resolve({data:[],error:null}),
  supabase.from('user_lists').select(select).eq('is_private',false).order('created_at',{ascending:false}).limit(50),
  ids.length?supabase.from('user_lists').select(select).in('id',ids):Promise.resolve({data:[],error:null}),
 ]);
 for(const result of [mine,discovery,followed])if(result.error)throw result.error;
 return enrich([...new Map([...mine.data??[],...followed.data??[],...discovery.data??[]].map(row=>[row.id,row as UserList])).values()],ids);
}
async function getList(id:string):Promise<UserList> {const {data,error}=await supabase.from('user_lists').select(select).eq('id',id).single();if(error)throw error;const list=data as UserList;const native=list.members.filter(member=>/^[0-9a-f-]{36}$/i.test(member.id)).map(member=>member.id);
 if(native.length){const profiles=await supabase.from('profiles').select('id,username,display_name,avatar_url,bio,is_official,is_private').in('id',native);if(profiles.error)throw profiles.error;const current=new Map((profiles.data??[]).map(row=>[row.id,listMember(searchProfileUser(row))]));list.members=list.members.map(member=>current.get(member.id)??member);}
 return (await enrich([list]))[0];}
async function uploadCover(file:File,id:string){if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)||file.size>8*1024*1024)throw new Error('画像は対応形式で8MB以内にしてください');const form=new FormData();form.set('file',file);form.set('listId',id);const {data,error}=await supabase.functions.invoke('list-media',{body:form});if(error)throw error;return data.ref as string;}
async function discardListCover(ref:string){const {error}=await supabase.functions.invoke('list-media',{body:{action:'discard',refs:[ref]}});if(error)throw error;}
async function saveList(input:{id?:string;name:string;description:string;is_private:boolean;cover_ref?:string|null;file?:File}):Promise<UserList>{
 if(!input.name.trim()||Array.from(input.name.trim()).length>50||Array.from(input.description).length>500)throw new Error('名前は1〜50文字、詳細は500文字以内にしてください');
 const owner=await getCurrentUserId();if(!owner)throw new Error('ログインしてください');const id=input.id??randomUUID();const uploaded=input.file?await uploadCover(input.file,id):undefined;
 const patch={name:input.name.trim(),description:input.description,is_private:input.is_private,...(uploaded?{cover_ref:uploaded}:input.cover_ref!==undefined?{cover_ref:input.cover_ref}:{})};
 const query=input.id?supabase.from('user_lists').update(patch).eq('id',id).eq('owner_id',owner):supabase.from('user_lists').insert({...patch,id,owner_id:owner});
 const {data,error}=await query.select(select).single();if(error){if(uploaded)await discardListCover(uploaded).catch(()=>{});throw error;}return data as UserList;
}
async function deleteList(id:string){const {error}=await supabase.from('user_lists').delete().eq('id',id).eq('owner_id',await getCurrentUserId());if(error)throw error;}
async function setListMember(id:string,user:ListMember,included:boolean){const {error}=await supabase.rpc('set_list_member',{list_id:id,member:listMember(user),included});if(error)throw error;}
async function setSavedList(id:string,included:boolean){const {error}=await supabase.rpc('set_saved_list',{list_id:id,included});if(error)throw error;}
async function searchListUsers(query:string,signal?:AbortSignal):Promise<ListMember[]>{return (await searchAccounts(query,signal)).map(listMember);}

async function searchLists(query:string):Promise<UserList[]> {if(isAccountReadOnly())return [];const {data,error}=await supabase.from('user_lists').select(select).ilike('name',`%${query.replace(/[%_]/g,'')}%`).order('created_at',{ascending:false}).limit(30);if(error)throw error;return enrich(data as UserList[]);}

// The TL catalog only needs labels; avoid signing/downloading covers on every page.
async function getListCatalog(owner:string):Promise<{id:string;name:string}[]> {
 const {data:settings,error:settingsError}=await supabase.from('profile_private_settings').select('saved_lists').eq('user_id',owner).maybeSingle();if(settingsError)throw settingsError;const ids:string[]=settings?.saved_lists??[];
 const results=await Promise.all([
  supabase.from('user_lists').select('id,name').eq('owner_id',owner).order('created_at',{ascending:false}).limit(100),
  supabase.from('user_lists').select('id,name').eq('is_private',false).order('created_at',{ascending:false}).limit(50),
  ids.length?supabase.from('user_lists').select('id,name').in('id',ids):Promise.resolve({data:[],error:null}),
 ]);for(const result of results)if(result.error)throw result.error;return [...new Map(results.flatMap(result=>result.data??[]).map(list=>[list.id,list])).values()];
}

// spaces
const SPACE_EMOJIS = ['😂', '😲', '😢', '💜', '💯', '👏', '✊', '👍', '👎', '👋', '✋'] as const;
async function spaceRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
const getLiveSpaces = () => spaceRpc<LiveSpace[]>('list_live_spaces');
type SpaceState = { waiting?: boolean; space: LiveSpace | null; members: SpaceMember[]; anonymous_count: number; reactions: { id: string; emoji: string; created_at: string }[]; me?: { can_speak: boolean; requested: boolean; role: 'host' | 'speaker' | 'listener' } | null };
const getSpaceState = (id: string) => spaceRpc<SpaceState>('get_space_state', { p_space_id: id });
async function getSpaceToken(id: string, uid: number, publishing: boolean) {
  const { data, error } = await supabase.functions.invoke('space-token', { body: { spaceId: id, uid, publishing } });
  if (error) throw new Error('音声接続を開始できませんでした。もう一度お試しください。');
  if (!data?.token || !data?.appId) throw new Error(data?.error || '音声接続の設定を取得できませんでした。');
  return data as { token: string; appId: string; role: 'host' | 'audience' };
}

// bookmarks
type BookmarkTarget = { id: string } & Partial<PostWithAuthor>;
type BookmarkRow = { id: string; post_id: string | null; comment_id: string | null; external_id: string | null; external_snapshot?: PostWithAuthor | null; created_at: string };
const sourceId = (row: Pick<BookmarkRow, 'post_id' | 'comment_id' | 'external_id'>) => row.external_id ?? (row.comment_id ? `reply:${row.comment_id}` : row.post_id!);
function source(target: BookmarkTarget) {
  if (target.id.startsWith('reply:')) return { column: 'comment_id', value: target.id.slice(6) } as const;
  if (isExternalPostId(target.id)) return { column: 'external_id', value: target.id } as const;
  return { column: 'post_id', value: target.id } as const;
}
async function getBookmarkIds(userId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('bookmarks').select('post_id, comment_id, external_id').eq('user_id', userId).order('id').range(offset, offset + 999);
    if (error) throw error;
    ids.push(...(data ?? []).map(sourceId));
    if ((data?.length ?? 0) < 1000) return ids;
  }
}
async function setBookmark(target: BookmarkTarget, saved: boolean, expectedUserId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (userId !== expectedUserId) throw new Error('アカウントが切り替わりました。もう一度お試しください');
  const { column, value } = source(target);
  if (!saved) {
    const { error } = await supabase.from('bookmarks').delete().eq('user_id', userId).eq(column, value);
    if (error) throw error;
    recordRecommendationEngagement(target,userId,'bookmark',false);
    return;
  }
  if (column === 'external_id' && (target.visibility !== 'public' || !target.author || typeof target.content !== 'string')) throw new Error('投稿を読み込んでからブックマークしてください');
  const snapshot = column === 'external_id' ? externalLikeSnapshot(target as PostWithAuthor) : null;
  const { error } = await supabase.from('bookmarks').insert({ user_id: userId, [column]: value, ...(snapshot ? { external_snapshot: snapshot } : {}) });
  if (error && error.code !== '23505') throw error;
  recordRecommendationEngagement(target,userId,'bookmark',true);
}
async function getBookmarkPage(userId: string, offset = 0, limit = 20, context?: AccountReadContext) {
  const client = context?.client ?? supabase;
  context?.signal?.throwIfAborted();
  const { data, error } = await client.from('bookmarks').select('id, post_id, comment_id, external_id, external_snapshot, created_at').eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as BookmarkRow[];
  const posts = await Promise.all(rows.map(async row => {
    if (row.external_id) return row.external_snapshot?.id === row.external_id && row.external_snapshot.visibility === 'public' ? row.external_snapshot : null;
    // Always fetch native originals through their current visibility rules.
    return context ? getPostById(sourceId(row), context) : getPostById(sourceId(row));
  }));
  const completed=await completeSavedPosts(posts.filter((post):post is PostWithAuthor=>!!post),context);
  const byId=new Map(completed.map(post=>[post.id,post]));
  posts.forEach((post,index)=>{if(post)posts[index]=byId.get(post.id)??post;});
  const entries = posts.flatMap((post, index) => post ? [{ post, savedAt: rows[index].created_at, bookmarkId: rows[index].id }] : []);
  return { entries, posts: posts.filter((post): post is PostWithAuthor => !!post), unavailable: posts.filter(post => !post).length, next: rows.length === limit ? offset + limit : undefined };
}

export { getUserByUsername };
export { getUserById };
export { updateProfile };
export { getProfileActivityCount };
export { getAccountReviews };
export { submitAccountReview };
export { setAccountReviewLike };
export type { AccountReview };
export type { AccountReviews };
export { accountReviewsKey };
export { getFollowStats };
export { toggleFollow };
export { getKnownFollowers };
export type { KnownFollower };
export { getAccountAbout };
export { countryName };
export { detectCountry };
export { syncAccountConnection };
export type { AccountAbout };
export { accountAboutKey };
export { getAccountFollowState };
export { toggleAccountFollow };
export { getFollowRequests };
export { respondFollowRequest };
export type { AccountFollowState };
export type { FollowRequest };
export { fetchFollowListPage };
export type { FollowListTab };
export type { FollowListPage };
export { searchProfileUser };
export { searchAccounts };
export { getDirectInbox };
export { getDirectPreferences };
export { setDirectPreferences };
export { openDirectConversation };
export { sendDirectMessage };
export { respondDirectRequest };
export { readDirectConversation };
export { getDirectMessages };
export { searchDirectPeers };
export { uploadDirectMedia };
export { discardDirectMedia };
export { getChatInboxPreferences };
export { setChatInboxPreference };
export { deleteDirectChat };
export { canDirectMessage };
export { decorateDirectConversation };
export { getDirectGroup };
export { createDirectGroup };
export { updateDirectGroup };
export { addDirectGroupMembers };
export { manageDirectGroupMember };
export { muteDirectGroup };
export { setDirectGroupInvite };
export { sendDirectGroupMessage };
export { getDirectGroupInvitation };
export { requestDirectGroupJoin };
export { createGroupWithFriends };
export { addGroupFriends };
export { removeGroupFriend };
export { askGroupFriends };
export { toggleDirectReaction };
export { deleteDirectMessage };
export { sendDirectReply };
export type { DirectPeer };
export type { DirectConversation };
export type { DirectMessage };
export { directKeys };
export type { ChatInboxPreferences };
export type { DirectGroupMember };
export type { DirectGroup };
export type { GroupFriend };
export type { GroupFriendDraft };
export { normalizePreferences };
export { getNotificationPreferences };
export { setNotificationPreference };
export { getNotifications };
export { markNotificationsRead };
export { markAllNotificationsRead };
export { getNotificationSubscriptions };
export { removeNotificationSubscription };
export { notificationLink };
export { groupNotifications };
export { notificationDescription };
export { notificationKinds };
export type { NotificationKind };
export type { NotificationPreference };
export type { NotificationPreferences };
export { notificationLabels };
export type { NotificationRow };
export type { NotificationSubscription };
export { listMember };
export { getLists };
export { getList };
export { discardListCover };
export { saveList };
export { deleteList };
export { setListMember };
export { setSavedList };
export { searchListUsers };
export { searchLists };
export { getListCatalog };
export type { ListMember };
export type { UserList };
export { listsKey };
export { spaceRpc };
export { getSpaceToken };
export { SPACE_EMOJIS };
export { getLiveSpaces };
export type { SpaceState };
export { getSpaceState };
export { getBookmarkIds };
export { setBookmark };
export { getBookmarkPage };
export type { BookmarkTarget };
