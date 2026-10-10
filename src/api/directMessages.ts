import {refreshNotificationBadge} from '@/lib/notificationBadge';
import {dismissNotificationToasts} from '@/lib/notificationToast';
import {supabase} from '@/lib/supabase';
export type DirectPeer={id:string;username:string;displayName:string;avatarUrl:string;isPrivate?:boolean;isOfficial?:boolean;createdAt:string};
export type DirectConversation={id:string;status:'pending'|'accepted'|'declined';initiatedBy:string;updatedAt:string;peer:DirectPeer;preview:string;hasMedia:boolean;unreadCount:number;pinned?:boolean};
export type DirectMessage={id:string;conversation_id:string;sender_id:string;content:string;attachments:string[];created_at:string;mediaUrls:string[]};
export const directKeys={inbox:['direct-inbox'] as const,messages:(id:string)=>['direct-messages',id] as const,preferences:['direct-preferences'] as const};
export async function getDirectInbox():Promise<DirectConversation[]>{const {data,error}=await supabase.rpc('get_direct_inbox');if(error)throw error;return data??[];}
export async function getDirectPreferences():Promise<'everyone'|'none'>{const {data,error}=await supabase.rpc('get_dm_preferences');if(error)throw error;return data;}
export async function setDirectPreferences(value:'everyone'|'none'){const {error}=await supabase.rpc('set_dm_preferences',{value});if(error)throw error;}
export async function openDirectConversation(userId:string):Promise<string>{const {data,error}=await supabase.rpc('open_direct_conversation',{target_user:userId});if(error)throw error;return data;}
export async function sendDirectMessage(peerId:string,content:string,attachments:string[]=[],messageId=crypto.randomUUID()):Promise<string>{const {data,error}=await supabase.rpc('send_direct_message',{target_user:peerId,body:content,media:attachments,message_id:messageId});if(error)throw error;return data;}
export async function respondDirectRequest(id:string,accept:boolean){const {error}=await supabase.rpc('respond_direct_request',{target:id,accept_request:accept});if(error)throw error;}
export async function readDirectConversation(id:string,throughTime:string){const {error}=await supabase.rpc('read_direct_conversation',{target:id,through_time:throughTime});if(error)throw error;const {data:notifications}=await supabase.from('notifications').select('id,user_id').eq('conversation_id',id).eq('is_read',true).limit(1000);if(notifications?.length){const ids=notifications.map(n=>n.id);dismissNotificationToasts(ids);await refreshNotificationBadge(notifications[0].user_id,ids).catch(()=>{});}}
export async function getDirectMessages(id:string,before?:{created_at:string;id:string}):Promise<DirectMessage[]>{
 let query=supabase.from('direct_messages').select('*').eq('conversation_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
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
export async function searchDirectPeers(term:string):Promise<DirectPeer[]>{
 const text=term.trim().replace(/[%_,()]/g,'');if(!text)return [];
 const {data,error}=await supabase.from('profiles').select('id,username,display_name,avatar_url,is_private,is_official,created_at').or(`username.ilike.%${text}%,display_name.ilike.%${text}%`).limit(20);if(error)throw error;
 return (data??[]).map(row=>({id:row.id,username:row.username,displayName:row.display_name||row.username,avatarUrl:row.avatar_url||'',isPrivate:row.is_private,isOfficial:row.is_official,createdAt:row.created_at}));
}
export async function uploadDirectMedia(conversationId:string,_userId:string,files:File[]):Promise<string[]>{
 if(files.length>4||files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10485760))throw new Error('画像はJPEG・PNG・WebP形式で、1枚10MB以下・4枚まで添付できます');
 const refs:string[]=[];
 try{for(const file of files){const body=new FormData();body.set('conversationId',conversationId);body.set('file',file);const {data,error}=await supabase.functions.invoke('direct-media',{body});if(error||typeof data?.ref!=='string'||!data.ref.startsWith('cloudinary:'))throw new Error('DM画像のアップロードに失敗しました');refs.push(data.ref);}return refs;}
 catch(error){if(refs.length)await discardDirectMedia(refs);throw error;}
}
export async function discardDirectMedia(refs:string[]){if(!refs.length)return;const {error}=await supabase.functions.invoke('direct-media',{body:{action:'discard',refs}});if(error)throw error;}

export type ChatInboxPreferences={pins:Record<string,boolean>;hidden:Record<string,boolean>};
export async function getChatInboxPreferences():Promise<ChatInboxPreferences>{const {data,error}=await supabase.rpc('get_chat_inbox_preferences');if(error)throw error;return data??{pins:{},hidden:{}};}
export async function setChatInboxPreference(chat:string,kind:'pins'|'hidden',value:boolean){const {error}=await supabase.rpc('set_chat_inbox_preference',{chat,kind,value});if(error)throw error;}
export async function deleteDirectChat(id:string){const {error}=await supabase.rpc('delete_direct_chat',{target:id});if(error)throw error;}

export async function canDirectMessage(userId:string):Promise<boolean>{const {data,error}=await supabase.rpc('can_direct_message',{target_user:userId});if(error)throw error;return data===true;}
