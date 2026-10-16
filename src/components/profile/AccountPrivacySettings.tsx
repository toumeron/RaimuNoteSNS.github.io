import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { getUserById, updateProfile } from "@/api/users";
import { getFollowRequests, respondFollowRequest } from "@/api/accountPrivacy";
import { PrivateAccountBadge } from "@/components/common/OfficialBadge";
import { Button, Checkbox, Switch } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { getNotificationPreferences, setNotificationPreference, notificationLabels, getNotificationSubscriptions, removeNotificationSubscription, type NotificationPreference } from "@/api/notifications";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { requestPermissionAndSubscribe } from "@/hooks/useOSNotification";

// AccountPrivacySettings
function AccountPrivacySettings({userId}:{userId:string}) {
 const qc=useQueryClient();
 const profile=useQuery({queryKey:['account-privacy',userId],queryFn:()=>getUserById(userId)});
 const requests=useQuery({queryKey:['follow-requests',userId],queryFn:getFollowRequests});
 const refresh=async()=>{await Promise.all([qc.invalidateQueries({queryKey:['account-privacy']}),qc.invalidateQueries({queryKey:['profile']}),qc.invalidateQueries({queryKey:['follow-stats']}),qc.invalidateQueries({queryKey:['posts']}),qc.invalidateQueries({queryKey:['auth-user']}),qc.invalidateQueries({queryKey:['desktop-account-profile']}),qc.invalidateQueries({queryKey:['saved-account-profiles']}),qc.invalidateQueries({queryKey:['author-badges']}),qc.invalidateQueries({queryKey:['notifications']}),qc.invalidateQueries({queryKey:['follow-requests']})]);};
 const privacy=useMutation({mutationFn:(enabled:boolean)=>updateProfile(userId,{isPrivate:enabled}),onSuccess:refresh,onError:()=>toast.error('プライバシー設定を保存できませんでした')});
 const respond=useMutation({mutationFn:({id,accept}:{id:string;accept:boolean})=>respondFollowRequest(id,accept),onSuccess:refresh,onError:()=>toast.error('フォローリクエストを更新できませんでした')});
 return <div className="w-full min-w-0 space-y-6 p-5" data-account-privacy-settings>
  <h2 className="font-display text-base font-bold">プライバシー</h2>
  <label className="flex cursor-pointer items-center justify-between gap-4">
   <span className="font-semibold">ポストを非公開</span>
   <Checkbox checked={profile.data?.isPrivate===true} disabled={!profile.data||privacy.isPending} onCheckedChange={checked=>privacy.mutate(checked===true)}/>
  </label>
  {profile.isError&&<p role="alert" className="text-sm text-destructive">設定を取得できませんでした。</p>}
  <div className="space-y-3">
   <h3 className="font-bold">フォローリクエスト</h3>
   {requests.isError?<p role="alert" className="text-sm text-destructive">リクエストを取得できませんでした。</p>:requests.data?.length===0?<p className="text-sm text-muted-foreground">フォローリクエストはありません</p>:null}
   {requests.data?.map(request=><div key={request.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
    <div className="h-10 w-10 shrink-0">{request.avatarUrl&&<img src={request.avatarUrl} alt="" className="h-full w-full rounded-full object-cover"/>}</div>
    <Link to={`/u/${encodeURIComponent(request.username)}`} className="min-w-0 flex-1">
     <span className="flex items-center gap-1 font-bold"><span className="truncate">{request.displayName||request.username}</span>{request.isPrivate&&<PrivateAccountBadge/>}{request.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="Official" className="h-4 w-4 shrink-0"/>}</span>
     <span className="block truncate text-sm text-muted-foreground">@{request.username}</span>
    </Link>
    <div className="col-span-2 flex flex-wrap justify-end gap-2">
    <Button size="sm" variant="outline" disabled={respond.isPending} onClick={()=>respond.mutate({id:request.id,accept:false})}>拒否</Button>
    <Button size="sm" disabled={respond.isPending} onClick={()=>respond.mutate({id:request.id,accept:true})}>承認</Button>
    </div>
   </div>)}
  </div>
 </div>;
}

// NotificationSettings
function NotificationSettings(){
 const {user}=useAuth();const client=useQueryClient();
 const prefs=useQuery({queryKey:['notification-preferences',user?.id],queryFn:()=>getNotificationPreferences(user!.id),enabled:!!user?.id});
 const targets=useQuery({queryKey:['notification-subscriptions',user?.id],queryFn:()=>getNotificationSubscriptions(user!.id),enabled:!!user?.id});
 const save=useMutation({mutationFn:({kind,enabled}:{kind:NotificationPreference;enabled:boolean})=>setNotificationPreference(kind,enabled),onSuccess:()=>void client.invalidateQueries({queryKey:['notification-preferences',user?.id]}),onError:()=>toast.error('通知設定を保存できませんでした')});
 const remove=useMutation({mutationFn:(id:string)=>removeNotificationSubscription(user!.id,id),onSuccess:()=>{void client.invalidateQueries({queryKey:['notification-subscriptions',user?.id]});void client.invalidateQueries({queryKey:['post-notification-subscription',user?.id]});},onError:()=>toast.error('投稿通知を解除できませんでした')});
 return <section id="notifications" className="scroll-mt-32 rounded-3xl border border-border/60 bg-card p-5 shadow-soft" aria-labelledby="notification-settings-title">
  <h2 id="notification-settings-title" className="mb-3 font-display text-base font-bold">通知設定</h2>
  {prefs.isError?<Button variant="ghost" onClick={()=>void prefs.refetch()}>通知設定を再読み込み</Button>:prefs.isPending?<p className="text-sm text-muted-foreground">読み込み中...</p>:Object.entries(notificationLabels).map(([kind,label])=><div key={kind} className="flex min-h-11 items-center justify-between gap-4 py-2"><label htmlFor={`notify-${kind}`} className="text-sm">{label}</label><Switch id={`notify-${kind}`} checked={prefs.data[kind as NotificationPreference]} disabled={save.isPending} onCheckedChange={enabled=>save.mutate({kind:kind as NotificationPreference,enabled})}/></div>)}
  <Button variant="ghost" className="mt-2 h-auto px-0 py-2 text-sm text-muted-foreground" onClick={()=>{void requestPermissionAndSubscribe(user!.id).then(ok=>toast(ok?'端末への通知を有効にしました':'端末の通知許可を確認してください'));}}>この端末で通知を受け取る</Button>
  <h3 className="mb-2 mt-6 text-sm font-bold">新着ポスト通知をONにしているユーザー</h3>
  {targets.isPending?<p className="text-sm text-muted-foreground">読み込み中...</p>:targets.isError?<Button variant="ghost" onClick={()=>void targets.refetch()}>ユーザー一覧を再読み込み</Button>:targets.data?.length===0?<p className="text-sm text-muted-foreground">通知をONにしているユーザーはいません</p>:targets.data?.map(target=>{const handle=target.profiles?.username??target.external_actor??'';const name=target.profiles?.display_name||target.target_name||handle;return <div key={target.id} className="flex items-center gap-3 border-b border-border/40 py-3"><Link to={`/u/${encodeURIComponent(handle)}`} className="flex min-w-0 flex-1 items-center gap-3"><Avatar className="h-9 w-9"><AvatarImage src={target.profiles?.avatar_url??target.target_avatar_url??undefined}/><AvatarFallback>{name[0]}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate text-sm font-bold">{name}</p><p className="truncate text-xs text-muted-foreground">@{handle} · {target.provider==='limenote'?'LimeNote':target.provider==='bluesky'?'Bluesky':'Misskey'}</p></div></Link><Button size="sm" variant="outline" disabled={remove.isPending} onClick={()=>remove.mutate(target.id)}>通知をOFF</Button></div>;})}
 </section>;
}

export { AccountPrivacySettings };
export { NotificationSettings };
