import {AnnictCatalog,animeEntry,animeEpisodeNumber,animeTitleQueries,parseAnimeImport,fetchAnimeArtwork,type AnimeHistoryState,type AnimeHistoryEntry} from '../_shared/animeHistory.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:cors});

const positiveId=(id:unknown):id is number=>Number.isSafeInteger(id)&&Number(id)>0&&Number(id)<1e10;
type AnimeHandlerDependencies={
 catalog:AnnictCatalog;
 authenticate:(request:Request,allowReadOnly:boolean)=>Promise<{userId:string}|Response>;
 limit:(userId:string)=>Promise<Response|null>;
 client:(request:Request)=>any;
};
export function createAnimeHistoryHandler(deps:AnimeHandlerDependencies){return async(request:Request):Promise<Response>=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return reply(405,{error:'Method not allowed'});
 try{
  let body:any;try{const reader=request.body?.getReader();let bytes=0,text='';if(reader){const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>256*1024)throw new Error('Too large');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}}body=JSON.parse(text);}catch{return reply(400,{error:'入力を確認してください'});}
  if(!body||!['search','episodes','save','detect','scan','resolve','import'].includes(body.op))return reply(400,{error:'操作を確認してください'});
  const actor=await deps.authenticate(request,['search','episodes','resolve'].includes(body.op));if(actor instanceof Response)return actor;
  const limited=await deps.limit(actor.userId);if(limited)return limited;
  const catalog=deps.catalog;
  const client=deps.client(request);
  const save=async(entries:AnimeHistoryEntry[])=>{const {data,error}=await client.rpc('update_anime_history',{operation:'save',records:entries});if(error)throw new Error(error.message);return data;};
  if(body.op==='search'){
   if(typeof body.query!=='string'||body.query.trim().length<2||body.query.length>100)return reply(400,{error:'作品名を2文字以上で入力してください'});
   return reply(200,{works:await catalog.suggest(body.query.trim())});
  }
  if(body.op==='episodes'){
   if(!positiveId(body.workId)||!Number.isInteger(body.page??1)||(body.page??1)<1||(body.page??1)>100)return reply(400,{error:'作品・ページを確認してください'});
   return reply(200,await catalog.episodes(body.workId,body.page??1));
  }
  if(body.op==='save'){
   if(!positiveId(body.workId)||body.episodeId!=null&&!positiveId(body.episodeId))return reply(400,{error:'作品・エピソードを確認してください'});
   const date=body.watchedAt==null?null:typeof body.watchedAt==='string'&&Number.isFinite(Date.parse(body.watchedAt))?new Date(body.watchedAt).toISOString():undefined;
   if(date===undefined||date&&Date.parse(date)>Date.now()+86400000)return reply(400,{error:'視聴日時を確認してください'});
   const original=await catalog.work(body.workId);const work=original.image?original:{...original,...await fetchAnimeArtwork(original)};const episode=body.episodeId?await catalog.episode(work.id,body.episodeId):null;
   if(body.importItem){
    const [item]=parseAnimeImport({format:'limenote-anime-history',version:1,items:[body.importItem]});
    return reply(200,{state:await save([animeEntry(work,episode,{...item,watchedAt:item.watchedAt})])});
   }
   return reply(200,{state:await save([animeEntry(work,episode,{source:'manual',watchedAt:date})])});
  }
  if(body.op==='import'){
   if(!Array.isArray(body.items)||body.items.length>10)return reply(400,{error:'取り込みは10件ずつ実行してください'});
   const entries:AnimeHistoryEntry[]=[];
   for(const row of body.items){
    if(!positiveId(row?.workId)||row.episodeId!=null&&!positiveId(row.episodeId))return reply(400,{error:'作品・エピソードを確認してください'});
    const [item]=parseAnimeImport({format:'limenote-anime-history',version:1,items:[row.item]});
    const work=await catalog.work(row.workId),episode=row.episodeId?await catalog.episode(work.id,row.episodeId):null;
    entries.push(animeEntry(work,episode,item));
   }
   return reply(200,{state:await save(entries)});
  }
  if(body.op==='resolve'){
   const items=parseAnimeImport({format:'limenote-anime-history',version:1,items:body.items});if(items.length>10)return reply(400,{error:'照合は10件ずつ実行してください'});
   const rows=[];for(const item of items)rows.push({item,...await catalog.resolveImport(item)});
   // Resolution is read-only. The user chooses which records to save.
   return reply(200,{rows});
  }
  const {data:state,error:stateError}=await client.rpc('get_anime_history');if(stateError)throw new Error(stateError.message);
  const history=state as AnimeHistoryState;if(!history.autoAdd)return reply(200,{state,scanned:0});
  let query=client.from('posts').select('id,content,created_at,visibility').eq('user_id',actor.userId).eq('visibility','public').order('created_at',{ascending:false});
  if(body.op==='detect'){
   if(typeof body.postId!=='string'||!/^[a-f\d-]{36}$/i.test(body.postId))return reply(400,{error:'ポストを確認してください'});query=query.eq('id',body.postId);
  }
  if(body.op==='scan'&&body.before!=null){if(typeof body.before!=='string'||!Number.isFinite(Date.parse(body.before)))return reply(400,{error:'日時を確認してください'});query=query.lt('created_at',body.before);}
  // Bounded catch-up for posts made from other clients or scheduled publishing; no timer/job.
  const {data:posts,error:postError}=await query.limit(body.op==='detect'?1:5);if(postError)throw new Error(postError.message);
  if(body.op==='detect'&&!posts?.length)return reply(404,{error:'本人のポストが見つかりません'});
  const known=[...new Map(history.entries.map(entry=>[entry.work.id,entry.work])).values()];const entries:AnimeHistoryEntry[]=[];
  // A request scans at most five unprocessed title-bearing posts. Further pages are explicit.
  const candidates=(posts??[]).filter((post:{id:string;content:string;created_at:string})=>!history.entries.some(entry=>entry.postId===post.id));let scanned=0;
  for(const post of candidates){
   if(scanned>=5)break;if(!animeTitleQueries(post.content).length&&!/https:\/\/annict\.com\/works\//.test(post.content))continue;
   scanned++;for(const work of await catalog.mentionWorks(post.content,known)){
    const titleIndex=post.content.indexOf(work.title),near=titleIndex>=0?post.content.slice(titleIndex,titleIndex+work.title.length+80):post.content;
    const number=animeEpisodeNumber(near);const episode=number?await catalog.episodeForText(work.id,near):null;
    entries.push(animeEntry(work,episode,{source:'post',postId:post.id,watchedAt:post.created_at,episodeText:number&&!episode?`第${number}話`:'',sourceUrl:''}));
   }
  }
  return reply(200,{state:entries.length?await save(entries):state,scanned,nextBefore:posts?.length===5?posts[posts.length-1].created_at:null});
 }catch(error){
  // Never include upstream URLs, authorization headers, private post contents or raw request bodies.
  const message=error instanceof Error?error.message:'視聴履歴を処理できませんでした';
  return reply(/正しく|形式|選択|確認|無効|一致/.test(message)?400:502,{error:message.startsWith('Annict')||/視聴|ポスト|作品|ログイン|凍結/.test(message)?message:'視聴履歴を処理できませんでした。時間をおいて再試行してください'});
 }
};}
