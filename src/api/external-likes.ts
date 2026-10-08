import {getCurrentUserId} from '@/lib/currentUser';
import {supabase} from '@/lib/supabase';
import type {PostWithAuthor} from '@/types';
import {isExternalPostId} from './external-posts';
export type ExternalLikeState={liked:boolean;count:number;unmirroredCount:number};
/** Keep a public rendering snapshot, never account tokens or private settings. */
export function externalLikeSnapshot(post:PostWithAuthor){
 if(!isExternalPostId(post.id)||post.visibility&&post.visibility!=='public')throw new Error('公開された外部投稿のみいいねできます');
 return {id:post.id,userId:post.userId,source:post.source,visibility:'public',content:post.content,imageUrls:post.imageUrls,imageAltTexts:post.imageAltTexts,createdAt:post.createdAt,likesCount:post.likesCount,commentsCount:post.commentsCount,repostsCount:post.repostsCount,likedByMe:false,repostedByMe:false,blueskyUri:post.blueskyUri,blueskyUrl:post.blueskyUrl,cid:post.cid,languages:post.languages,recommendationLanguages:post.recommendationLanguages,recommendationTopics:post.recommendationTopics,recommendationAuthorTopics:post.recommendationAuthorTopics,recommendationSources:post.recommendationSources,recommendationVisual:post.recommendationVisual,contentLabels:post.contentLabels,linkPreview:post.linkPreview,author:{id:post.author.id,username:post.author.username,displayName:post.author.displayName,bio:post.author.bio,avatarUrl:post.author.avatarUrl,coverUrl:post.author.coverUrl,createdAt:post.author.createdAt,isOfficial:false}};
}
export async function setExternalLike(post:PostWithAuthor,liked:boolean,mirrored=false):Promise<ExternalLikeState>{
 const {data,error}=await supabase.rpc('set_external_like',{snapshot:externalLikeSnapshot(post),enabled:liked,mirrored});
 if(error)throw error;return data as ExternalLikeState;
}
// Coalesce the visible cards' state reads into one RPC; opening a timeline
// must not issue two queries per external post.
const requests=new Map<string,{resolve:(state:ExternalLikeState)=>void;reject:(error:unknown)=>void;viewer?:string|null}[]>();
let flush:ReturnType<typeof setTimeout>|undefined;
export function getExternalLikeState(postId:string,viewer?:string|null):Promise<ExternalLikeState>{
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
export async function enrichExternalLike(post:PostWithAuthor,viewerId:string){
 if(!post.recommendationVisual||!isExternalPostId(post.id)||await getCurrentUserId()!==viewerId)return;
 const {error}=await supabase.from('likes').update({post_snapshot:externalLikeSnapshot(post)}).eq('user_id',viewerId).eq('external_post_id',post.id);
 if(error)throw error;
}
