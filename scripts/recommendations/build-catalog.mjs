// Public feed ingestion and the identical pinned image model run before a feed
// is opened. No account tokens, private follows or feedback enter this artifact.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {env,AutoProcessor,CLIPVisionModelWithProjection,RawImage} from '@huggingface/transformers';

const output=process.env.RECOMMENDATION_CATALOG_OUTPUT||'public/recommendations/catalog.json';
const limit=Math.min(1000,Math.max(20,Number(process.env.RECOMMENDATION_CATALOG_LIMIT)||120));
const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
globalThis.window={location:{origin:'http://localhost:8080',href:'http://localhost:8080'},localStorage,addEventListener(){},removeEventListener(){}};
// Mapping public posts does not need a Supabase project or an authenticated
// session. Placeholders prevent accidental database use in the CI process.
const server=await createServer({server:{middlewareMode:true},appType:'custom',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://catalog.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('public-catalog-no-authentication')}});
try{
 const bsky=await server.ssrLoadModule('/src/lib/bluesky.ts');
 const {mapXPost}=await server.ssrLoadModule('/src/lib/fxTwitter.ts');
 const {normalizeTimelineBlueskyPost}=await server.ssrLoadModule('/src/lib/utils.ts');
 const {classifyRecommendationVisual}=await server.ssrLoadModule('/src/lib/recommendationVisual.ts');
 const prototypes=JSON.parse(await readFile('src/lib/recommendationVisualPrototypes.json','utf8'));
 env.cacheDir=process.env.RECOMMENDATION_MODEL_CACHE||'/private/tmp/lime-clip-cache';
 const [processor,model]=await Promise.all([AutoProcessor.from_pretrained(prototypes.model,{revision:prototypes.revision}),CLIPVisionModelWithProjection.from_pretrained(prototypes.model,{revision:prototypes.revision,dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1}})]);
 const get=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`Public source HTTP ${response.status}`);return response.json();};
 const candidates=new Map(),authors=new Map();
 const add=post=>{if(post?.imageUrls?.length&&post.imageUrls.every(raw=>{try{const url=new URL(raw);return url.protocol==='https:'&&['cdn.bsky.app','pbs.twimg.com'].includes(url.hostname);}catch{return false;}})&&!post.externalReplyToId&&!post.profileRepostedBy&&post.visibility==='public')candidates.set(post.id,post);};
 const configuredFeeds=process.env.RECOMMENDATION_CATALOG_FEEDS?.split(',').filter(Boolean)??[];
 const feeds=configuredFeeds.length?configuredFeeds:[...bsky.BLUESKY_DIGITAL_ILLUSTRATION_FEEDS,...bsky.BLUESKY_ART_FEEDS];
 for(const feed of feeds){
  let cursor;
  for(let page=0;page<3;page++){
   try{
    const data=await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?${new URLSearchParams({feed,limit:'100',...(cursor?{cursor}:{})})}`);
    for(const row of data.feed??[]){const post=bsky.mapBlueskyFeedItemToPost(row);if(post){add(normalizeTimelineBlueskyPost(post));authors.set(row.post.author.did,row.post.author);}}
    if(!data.cursor||data.cursor===cursor)break;cursor=data.cursor;
   }catch(error){console.error('Feed unavailable',String(error.message));break;}
  }
 }
 // Linked twitter accounts are identity links provided by creators, not a word
 // search for a post's supposed subject. Images still require visual evidence.
 const twitter=new Set((process.env.RECOMMENDATION_CATALOG_AUTHORS??'').split(',').filter(handle=>/^[a-z0-9_]{1,15}$/i.test(handle)));
 const linked=description=>{
  for(const match of (description??'').matchAll(/https:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-z0-9_]{1,15})(?=[/?#\s]|$)/gi))if(!['intent','share','home','search','i'].includes(match[1].toLowerCase()))twitter.add(match[1]);
 };
 for(const author of authors.values())linked(author.description);
 const dids=[...authors.keys()].slice(0,200);
 for(let i=0;i<dids.length;i+=25){try{const params=new URLSearchParams();dids.slice(i,i+25).forEach(did=>params.append('actors',did));const data=await get(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${params}`);for(const author of data.profiles??[])linked(author.description);}catch{/* Another source can still supply candidates. */}}
 const handles=[...twitter].slice(0,80);let index=0;
 await Promise.all(Array.from({length:4},async()=>{while(index<handles.length){const handle=handles[index++];try{const data=await get(`https://api.fxtwitter.com/2/profile/${handle}/media?count=20`);for(const row of data.results??[]){const post=mapXPost(row);if(post)add(normalizeTimelineBlueskyPost(post));}}catch{/* Never substitute keyword-search results. */}}}));
 console.log(`Public candidates: ${candidates.size}; linked twitter creators: ${handles.length}`);
 const pools=[...candidates.values()].reduce((pools,post)=>{pools[post.source==='x'?0:1].push(post);return pools;},[[],[]]);
 const ordered=[];
 for(let i=0;i<Math.max(...pools.map(pool=>pool.length));i++)for(const pool of pools)if(pool[i])ordered.push(pool[i]);
 let previous=[];try{const old=JSON.parse(await readFile(output,'utf8'));if(old.model===prototypes.model&&old.revision===prototypes.revision)previous=old.posts??[];}catch{/* First generation. */}
 const byImage=new Map(previous.flatMap(post=>post.recommendationVisual?[[post.imageUrls[0],post.recommendationVisual]]:[]));
 const checked=[],counts=new Map();
 for(const post of ordered){
  if(checked.length>=limit)break;
  if((counts.get(post.userId)??0)>=4)continue;
  const url=post.imageUrls[0];let visual=byImage.get(url);
  try{
   if(!visual){
    const response=await fetch(url.replace('/img/feed_fullsize/','/img/feed_thumbnail/'),{signal:AbortSignal.timeout(8000)});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('image/')||Number(response.headers.get('content-length'))>8*1024*1024)continue;
    const blob=await response.blob();if(blob.size>8*1024*1024)continue;
    let image=await RawImage.fromBlob(blob);const scale=384/Math.max(image.width,image.height);image=await image.resize(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
    const inputs=await processor(image);let outputs;
    try{outputs=await model(inputs);const raw=Array.from(outputs.image_embeds.data),norm=Math.hypot(...raw);visual=classifyRecommendationVisual(raw.map(value=>Number((value/norm).toFixed(5))));}
    finally{for(const tensor of Object.values(outputs??{}))tensor.dispose?.();for(const tensor of Object.values(inputs))tensor.dispose?.();}
   }
   if(visual.kind==='unknown'||visual.confidence<.25||visual.similarity<.24)continue;
   checked.push({...post,recommendationVisual:visual,recommendationVisualStatus:'checked'});counts.set(post.userId,(counts.get(post.userId)??0)+1);
   if(checked.length%20===0)console.log(`Analysed catalog entries: ${checked.length}`);
  }catch{/* Unavailable images are withheld; the last published artifact stays intact. */}
 }
 const twitterCount=checked.filter(post=>post.source==='x').length;
 if(twitterCount<10||checked.length-twitterCount<10)throw new Error(`Insufficient verified source coverage (${twitterCount} twitter, ${checked.length-twitterCount} other); catalog was not replaced`);
 if([true,false].some(twitter=>new Set(checked.filter(post=>(post.source==='x')===twitter).map(post=>post.userId)).size<10))throw new Error('Insufficient creator diversity; catalog was not replaced');
 await mkdir(path.dirname(output),{recursive:true});
 const temporary=`${output}.${process.pid}.tmp`;
 await writeFile(temporary,JSON.stringify({version:1,model:prototypes.model,revision:prototypes.revision,generatedAt:new Date().toISOString(),posts:checked}));
 await rename(temporary,output);
 console.log(`Catalog written: ${checked.length} public, visually analysed posts (${twitterCount} twitter)`);
 await model.dispose();
}finally{await server.close();}
