import {useQuery,useQueryClient,useMutation} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {getNotificationPreferences,setNotificationPreference,notificationLabels,getNotificationSubscriptions,removeNotificationSubscription,type NotificationPreference} from '@/api/notifications';
import {Switch} from '@/components/ui/switch';
import {Avatar,AvatarFallback,AvatarImage} from '@/components/ui/avatar';
import {Button} from '@/components/ui/button';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {requestPermissionAndSubscribe} from '@/hooks/useOSNotification';
export function NotificationSettings(){
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
