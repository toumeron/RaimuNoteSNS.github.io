import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {getUserById,updateProfile} from '@/api/users';
import {getFollowRequests,respondFollowRequest} from '@/api/accountPrivacy';
import {PrivateAccountBadge} from '@/components/common/PrivateAccountBadge';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';

export function AccountPrivacySettings({userId}:{userId:string}) {
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
