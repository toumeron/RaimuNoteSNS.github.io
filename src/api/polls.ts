import {supabase} from '@/lib/supabase';
import {getCurrentUserId} from '@/lib/currentUser';
import {validatePollDraft,type PollDraft,type Poll} from '@/lib/polls';
export async function discardPollImages(refs:string[]) {if(refs.length)await supabase.functions.invoke('poll-media',{body:{action:'discard',refs}});}
export async function preparePoll(draft:PollDraft,postId:string):Promise<PollDraft> {
 const message=validatePollDraft(draft);if(message)throw new Error(message);
 const refs:string[]=[];
 try{
 const options=[];
 for(const option of draft.options){
  let image:string|undefined;
  if(option.image){
   if(!option.image.startsWith('blob:'))throw new Error('投票画像は端末から選んでください');
   const response=await fetch(option.image);if(!response.ok)throw new Error('画像を読み込めませんでした');
   const file=await response.blob();if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)||!file.size||file.size>8*1024*1024)throw new Error('投票画像は対応形式で8MB以内にしてください');
   const body=new FormData();body.set('postId',postId);body.set('file',file,'poll-image');
   const {data,error}=await supabase.functions.invoke('poll-media',{body});if(error||typeof data?.ref!=='string'||!data.ref.startsWith('cloudinary:polls/'))throw new Error('投票画像のアップロードに失敗しました');
   image=data.ref;refs.push(image!);
  }
  options.push({label:option.label.trim(),...(image?{image}:{})});
 }
 return {durationMinutes:draft.durationMinutes,options};
 }catch(error){await discardPollImages(refs);throw error;}
}
export async function readPoll(postId:string,viewer:string|null):Promise<{poll:Poll;selected:number|null;urls:Record<string,string>}> {
 const {data,error}=await supabase.from('posts').select('poll').eq('id',postId).single();if(error||!data?.poll)throw error??new Error('投票が見つかりません');
 let selected:number|null=null;
 if(viewer){const result=await supabase.from('poll_votes').select('option_index').eq('post_id',postId).eq('user_id',viewer).maybeSingle();if(result.error)throw result.error;selected=result.data?.option_index??null;}
 let urls:Record<string,string>={};
 if(data.poll.options.some((option:{image?:string})=>!!option.image)){const result=await supabase.functions.invoke('poll-media',{body:{action:'resolve',postIds:[postId]}});if(result.error)throw result.error;urls=result.data?.urls??{};}
 return {poll:data.poll as Poll,selected,urls};
}
export async function votePoll(postId:string,option:number) {
 const viewer=await getCurrentUserId();if(!viewer)throw new Error('ログインして投票してください');
 const {error}=await supabase.from('poll_votes').insert({post_id:postId,user_id:viewer,option_index:option});
 if(error&&error.code!=='23505')throw error;
 return viewer;
}
