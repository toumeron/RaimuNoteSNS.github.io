import {refreshNotificationBadge} from '@/lib/notificationBadge';
import {dismissNotificationToasts} from '@/lib/notificationToast';
import { supabase } from '@/lib/supabase';
export const notificationKinds = ['new_post','mention','reply','like','repost','reaction','follow'] as const;
export type NotificationKind = typeof notificationKinds[number];
export type NotificationPreference = NotificationKind | 'push';
export type NotificationPreferences = Record<NotificationPreference, boolean>;
export const notificationLabels: Record<NotificationPreference,string> = {new_post:'新着ポスト',mention:'メンション',reply:'返信',like:'いいね',repost:'リポスト',reaction:'リアクション',follow:'フォロー',push:'端末へのプッシュ通知'};
export type NotificationRow = {id:string;user_id:string;actor_id:string|null;post_id:string|null;comment_id?:string|null;type:NotificationKind;actor_name:string|null;actor_username?:string|null;actor_avatar_url:string|null;actor_is_official?:boolean;actor_is_private?:boolean;content_preview:string|null;image_urls?:string[];emoji?:string|null;external_post_id?:string|null;is_read:boolean;created_at:string};
export type NotificationSubscription = {id:string;subscriber_id:string;provider:'limenote'|'bluesky'|'misskey';target_user_id:string|null;external_actor:string|null;target_name:string|null;target_avatar_url:string|null;profiles?:{username:string;display_name:string;avatar_url:string}|null};
export function normalizePreferences(value: Partial<NotificationPreferences> = {}): NotificationPreferences {
 return Object.fromEntries([...notificationKinds,'push'].map(kind=>[kind,value[kind]!==false])) as NotificationPreferences;
}
export async function getNotificationPreferences(userId:string) {
 const {data,error}=await supabase.from('profile_private_settings').select('notification_preferences').eq('user_id',userId).maybeSingle();
 if(error)throw error;return normalizePreferences(data?.notification_preferences??{});
}
export async function setNotificationPreference(kind:NotificationPreference,enabled:boolean) {
 const {error}=await supabase.rpc('set_notification_preference',{kind,enabled});if(error)throw error;
}
export async function getNotifications(userId:string,page=0) {
 const {data,error}=await supabase.from('notifications').select('*').eq('user_id',userId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*50,page*50+49);
 if(error)throw error;
 const rows=(data??[]) as NotificationRow[];
 const actorIds=[...new Set(rows.flatMap(row=>row.actor_id?[row.actor_id]:[]))];
 if(!actorIds.length)return rows;
 const {data:actors,error:actorsError}=await supabase.from('profiles').select('id,is_private').in('id',actorIds);
 if(actorsError)throw actorsError;
 const privateActors=new Map((actors??[]).map(actor=>[actor.id,actor.is_private===true]));
 return rows.map(row=>({...row,actor_is_private:row.actor_id?privateActors.get(row.actor_id)===true:false}));
}
export async function markNotificationsRead(userId:string,ids:string[]) {
 if(!ids.length)return;const {error}=await supabase.from('notifications').update({is_read:true}).eq('user_id',userId).in('id',ids);if(error)throw error;
 dismissNotificationToasts(ids);
 await refreshNotificationBadge(userId,ids).catch(()=>{});
}
export async function getNotificationSubscriptions(userId:string) {
 const {data,error}=await supabase.from('post_notification_subscriptions').select('id,subscriber_id,provider,target_user_id,external_actor,target_name,target_avatar_url,profiles:profiles!post_notification_subscriptions_target_user_id_fkey(username,display_name,avatar_url)').eq('subscriber_id',userId).order('created_at',{ascending:false});
 if(error)throw error;return (data??[]) as unknown as NotificationSubscription[];
}
export async function removeNotificationSubscription(userId:string,id:string) {
 const {error}=await supabase.from('post_notification_subscriptions').delete().eq('subscriber_id',userId).eq('id',id);if(error)throw error;
}
export function notificationLink(n:NotificationRow) {
 if(n.external_post_id)return `/post/${encodeURIComponent(n.external_post_id)}`;
 if(n.comment_id)return `/post/${encodeURIComponent(`reply:${n.comment_id}`)}`;
 if(n.post_id)return `/post/${encodeURIComponent(n.post_id)}`;
 return n.actor_username?`/u/${encodeURIComponent(n.actor_username)}`:'/notifications';
}
export function groupNotifications(rows:NotificationRow[]) {
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
export function notificationDescription(kind:NotificationKind,emoji?:string|null) {
 return {new_post:'さんが新しく投稿しました',mention:'さんがあなたをメンションしました',reply:'さんがあなたに返信しました',like:'さんがあなたのポストをいいねしました',repost:'さんがあなたのポストをリポストしました',reaction:`さんがあなたのポストに${emoji??''}でリアクションしました`,follow:'さんがあなたをフォローしました'}[kind]??'さんからの通知';
}
