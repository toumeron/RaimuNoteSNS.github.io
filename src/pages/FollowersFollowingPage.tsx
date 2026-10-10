import {useEffect} from 'react';
import {externalProfileMetadata} from '@/lib/externalProfileMetadata';
import {useParams,useSearchParams,useNavigate,Link} from 'react-router-dom';
import {useQuery,useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/lib/supabase';
import {fetchBlueskyProfile} from '@/lib/bluesky';
import {useAuth} from '@/hooks/useAuth';
import {fetchFollowListPage,type FollowListTab} from '@/api/followLists';
import {FollowButton} from '@/components/profile/FollowButton';
import {PrivateAccountBadge} from '@/components/common/PrivateAccountBadge';
import {Avatar,AvatarFallback,AvatarImage} from '@/components/ui/avatar';
import {ProfileListHeader} from '@/components/layout/Header';
import {Loader2,AlertTriangle} from 'lucide-react';
import type {User} from '@/types';
import './follow-lists.css';
function Bio({text}:{text:string}){
 return <p className="follow-list-bio">{text.split(/(https?:\/\/[^\s]+)/g).map((part,i)=>/^https?:\/\//.test(part)?<a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>:part)}</p>;
}
export default function FollowersFollowingPage(){
 const client=useQueryClient();const {username}=useParams();const {user:viewer}=useAuth();const navigate=useNavigate();const [params,setParams]=useSearchParams();
 const tab:FollowListTab=params.get('tab')==='known'?'known':params.get('tab')==='followers'?'followers':'following';
 const target=useQuery({queryKey:['follow-list-profile',username],queryFn:async({signal})=>{
  const {data,error}=await supabase.from('profiles').select('*').eq('username',username!).abortSignal(signal).maybeSingle();
  if(error)throw error;
  if(data)return {id:data.id,username:data.username,displayName:data.display_name||data.username,avatarUrl:data.avatar_url||'',coverUrl:data.cover_url||'',bio:data.bio||'',createdAt:data.created_at||'',isOfficial:data.is_official,isPrivate:data.is_private} as User;
  return await fetchBlueskyProfile(username!,signal) as User|null;
 },enabled:!!username});
 const list=useInfiniteQuery({queryKey:['follow-list',target.data?.id,tab,viewer?.id],enabled:!!target.data&&!!viewer,initialPageParam:null as string|null,queryFn:({pageParam,signal})=>fetchFollowListPage(target.data!,tab,viewer!.id,pageParam,signal),getNextPageParam:page=>page.cursor??undefined});
 const users=[...new Map((list.data?.pages.flatMap(page=>page.users)??[]).map(user=>[user.id,user])).values()];
 useEffect(()=>{
  const missing=users.filter(user=>/^(did:|misskey-user:)/.test(user.id)&&(!user.avatarUrl||user.displayName===user.username));if(!missing.length)return;
  let cancelled=false,index=0;const resolved=new Map<string,User>();
  void Promise.all(Array.from({length:Math.min(3,missing.length)},async()=>{while(index<missing.length&&!cancelled){const row=missing[index++];const profile=await externalProfileMetadata(row.username);if(profile)resolved.set(row.id,profile);}})).then(()=>{if(cancelled||!resolved.size)return;client.setQueryData(['follow-list',target.data?.id,tab,viewer?.id],(data:typeof list.data)=>data?{...data,pages:data.pages.map(page=>({...page,users:page.users.map(row=>resolved.get(row.id)??row)}))}:data);});
  return()=>{cancelled=true};
 },[list.data,target.data?.id,tab,viewer?.id,client]);
 const changeTab=(tab:FollowListTab)=>{setParams(previous=>{const next=new URLSearchParams(previous);next.set('tab',tab);return next});};
 return <section className="follow-list-page" aria-label="フォロー一覧">
  <ProfileListHeader name={target.data?.displayName??username??''} username={target.data?.username??username??''} back={()=>window.history.state?.idx>0?navigate(-1):navigate(`/u/${encodeURIComponent(username??'')}`)}/>
  <div className="follow-list-tabs" role="tablist" aria-label="フォロー一覧の種類">{([{id:'known',label:'知り合いのフォロワー'},{id:'followers',label:'フォロワー'},{id:'following',label:'フォロー中'}] as const).map(item=><button key={item.id} id={`follow-tab-${item.id}`} type="button" role="tab" aria-selected={tab===item.id} aria-controls="follow-list-panel" onClick={()=>changeTab(item.id)}><span>{item.label}</span></button>)}</div>
  <div id="follow-list-panel" role="tabpanel" aria-labelledby={`follow-tab-${tab}`} aria-busy={target.isPending||list.isFetching}>
   {target.isPending||target.data&&list.isPending?<div className="follow-list-status" role="status"><Loader2 className="animate-spin" size={24}/><p>読み込み中…</p></div>:target.isError||list.isError?<div className="follow-list-status" role="alert"><AlertTriangle size={24}/><p>一覧を読み込めませんでした。</p><button onClick={()=>void (target.isError?target.refetch():list.refetch())}>再試行</button></div>:!target.data?<div className="follow-list-status"><p>ユーザーが見つかりませんでした。</p></div>:<>
    {users.map(user=><article key={user.id} className="follow-list-row" aria-label={user.displayName}>
     <Link className="follow-list-avatar" to={`/u/${encodeURIComponent(user.username)}`} aria-label={`${user.displayName}のプロフィール`}><Avatar><AvatarImage src={user.avatarUrl} alt=""/><AvatarFallback>{user.displayName.slice(0,1)}</AvatarFallback></Avatar></Link>
     <div className="follow-list-user"><div className="follow-list-identity"><Link to={`/u/${encodeURIComponent(user.username)}`}><span className="follow-list-name"><span className="follow-list-display">{user.displayName}</span>{user.isPrivate&&<PrivateAccountBadge/>}{user.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み"/>}</span><span className="follow-list-handle">@{user.username}</span></Link>{user.id!==viewer?.id&&<div className="follow-list-action"><FollowButton userId={user.id} externalProfile={user.id.startsWith('did:')||user.id.startsWith('misskey-user:')?user:undefined}/></div>}</div>{user.bio&&<Bio text={user.bio}/>}</div>
    </article>)}
    {!users.length&&!list.hasNextPage&&<div className="follow-list-status"><p>{tab==='known'?'知り合いのフォロワーはいません':tab==='following'?'まだ誰もフォローしていません':'まだフォロワーはいません'}</p></div>}
    {list.hasNextPage&&<button className="follow-list-more" disabled={list.isFetchingNextPage} onClick={()=>void list.fetchNextPage()}>{list.isFetchingNextPage?'読み込み中…':'もっと見る'}</button>}
   </>}
  </div>
 </section>;
}
