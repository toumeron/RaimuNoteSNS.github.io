import {fetchBlueskyProfile} from './bluesky';
import type {User} from '@/types';
const profiles=new Map<string,{expires:number;promise:Promise<User|null>}>();
/** Public metadata only. Coalesce repeated authors and bound requests/cache. */
export function externalProfileMetadata(actor:string):Promise<User|null>{
 const cached=profiles.get(actor);if(cached&&cached.expires>Date.now())return cached.promise;
 const promise=fetchBlueskyProfile(actor,AbortSignal.timeout(4000)).then(profile=>profile as User|null).catch(()=>null);
 profiles.set(actor,{expires:Date.now()+300000,promise});
 if(profiles.size>100)profiles.delete(profiles.keys().next().value!);
 return promise;
}
export async function completeExternalPostAuthors<T extends {id:string;userId:string;author:any}>(posts:T[],signal?:AbortSignal):Promise<T[]>{
 const output=[...posts];let index=0;
 await Promise.all(Array.from({length:Math.min(3,posts.length)},async()=>{
  while(index<posts.length&&!signal?.aborted){const slot=index++,post=posts[slot];
   if(!/^(bsky:|misskey:)/.test(post.id)||post.author?.avatarUrl&&post.author?.displayName)continue;
   const actor=post.author?.username||post.userId;if(!actor)continue;
   const profile=await externalProfileMetadata(actor);
   if(profile&&(profile.avatarUrl&&profile.avatarUrl!==post.author?.avatarUrl||profile.displayName&&profile.displayName!==post.author?.displayName))output[slot]={...post,author:{...post.author,...profile,display_name:profile.displayName,avatar_url:profile.avatarUrl}};
  }
 }));return output;
}
