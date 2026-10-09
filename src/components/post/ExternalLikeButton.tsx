import {useState,useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {LikeButton} from './LikeButton';
import {useAuth} from '@/hooks/useAuth';
import {useBlueskySession} from '@/hooks/useBlueskySession';
import {getExternalLikeState,setExternalLike} from '@/api/external-likes';
import {fetchBlueskyPostViewerState,getBlueskyUriFromPostId,likeBlueskyPost,unlikeBlueskyPost} from '@/lib/bluesky';
import {recommendationIdentity,recommendationFingerprint} from '@/lib/recommendationIdentity';
import {recordRecommendationLike,addRecommendationInterest,selectRecommendationLikeSamples} from '@/lib/recommendations';
import type {PostWithAuthor} from '@/types';
export function ExternalLikeButton({post,onChange}:{post:PostWithAuthor;onChange?:(state:{liked:boolean;count:number})=>void}){
 const {user}=useAuth(),session=useBlueskySession(post.id),client=useQueryClient();
 const [sourceCount,setSourceCount]=useState(post.likesCount);
 useEffect(()=>setSourceCount(post.likesCount),[post.id,post.likesCount]);
 const key=['external-like',user?.id??null,post.id];
 const state=useQuery({queryKey:key,queryFn:()=>getExternalLikeState(post.id,user?.id??null),staleTime:30000});
 const persist=async(liked:boolean)=>{
  if(!user){toast.error('LimeNoteへのログインが必要です');throw new Error('LimeNoteへのログインが必要です');}
  let saved;try{saved=await setExternalLike(post,liked);}catch(error){toast.error('いいねを保存できませんでした');throw error;}let count=sourceCount;
  // Cloud persistence owns the LimeNote state. Provider errors must never
  // undo a successful save or require an external account for a local like.
  recordRecommendationLike(post,liked,user.id);
  if(session){
   try{
    const uri=getBlueskyUriFromPostId(post.id);if(!uri)throw new Error('投稿URLが無効です');
    const remote=await fetchBlueskyPostViewerState(uri);
    if(liked){
     if(!remote.likeUri){const cid=remote.cid??post.cid;if(!cid)throw new Error('投稿情報が取得できません');await likeBlueskyPost(uri,cid);count++;}
     saved=await setExternalLike(post,true,true);
    }else if(remote.likeUri){await unlikeBlueskyPost(remote.likeUri);count=Math.max(0,count-1);}
   }catch{toast.info(liked?'LimeNoteにいいねを保存しました。外部SNSへの反映に失敗しました。':'LimeNoteのいいねを解除しました。外部SNSへの反映に失敗しました。');}
  }
  setSourceCount(count);client.setQueryData(key,saved);
  void client.invalidateQueries({queryKey:['posts','likes',user.id]});
  void client.invalidateQueries({queryKey:['recommendation-preferences',user.id]});
  // New likes affect future recommendation pages without rearranging the
  // timeline the reader already has open.
  client.setQueriesData<any>({predicate:query=>query.queryKey[0]==='feed'&&query.queryKey[1]==='recommended'&&query.queryKey[3]===user.id},current=>current?{...current,pages:current.pages.map((page:any)=>{
   const preferences={...page.preferences,authors:{...page.preferences.authors},terms:{...page.preferences.terms},recentAuthors:{...page.preferences.recentAuthors},recentTerms:{...page.preferences.recentTerms},authorTopics:Object.fromEntries(Object.entries(page.preferences.authorTopics??{}).map(([id,topics])=>[id,{...topics as object}]))};
   if(liked&&!preferences.likedPostIds?.includes(post.id))addRecommendationInterest(preferences,post,2);
   if(liked)preferences.feedback=(preferences.feedback??[]).filter((row:any)=>row.id!==recommendationIdentity(post)&&(!row.fingerprint||row.fingerprint!==recommendationFingerprint(post)));
   preferences.likedPostIds=[...(preferences.likedPostIds??[]).filter((id:string)=>id!==post.id),...(liked?[post.id]:[])];
   preferences.likedSamples=selectRecommendationLikeSamples([...(liked?[{...post,engagedAt:new Date().toISOString()}]:[]),...(preferences.likedSamples??[]).filter((row:PostWithAuthor)=>row.id!==post.id)]);
   return {...page,preferences,next:page.next?{...page.next,preferences}:undefined};
  })}:current);
  return {liked:saved.liked,count:count+saved.unmirroredCount};
 };
 return <LikeButton postId={post.id} liked={state.data?.liked??false} count={sourceCount+(state.data?.unmirroredCount??0)} syncState persistLike={persist} onChange={onChange}/>;
}
