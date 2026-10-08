import {AutoProcessor,CLIPVisionModelWithProjection,RawImage,env,type Tensor} from '@huggingface/transformers';
import prototypes from './recommendationVisualPrototypes.json';

env.allowLocalModels=false;
env.backends.onnx.wasm.numThreads=1;
let engine:Promise<{processor:Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;model:CLIPVisionModelWithProjection}>|undefined;
function load(){
 engine??=Promise.all([
  AutoProcessor.from_pretrained(prototypes.model,{revision:prototypes.revision}),
  CLIPVisionModelWithProjection.from_pretrained(prototypes.model,{revision:prototypes.revision,dtype:'q8',device:'wasm'}),
 ]).then(([processor,model])=>({processor,model}));
 return engine;
}
const cancelled=new Set<number>();
const pdsHosts=new Map<string,Promise<string>>();
async function imageBlob(url:string):Promise<Blob>{
 const input=new URL(url);
 if(input.hostname==='cdn.bsky.app'){
  const segments=input.pathname.split('/'),did=segments.at(-2)??'',cid=(segments.at(-1)??'').split('@')[0];
  if(/^did:plc:[a-z2-7]{24}$/.test(did)&&/^baf[a-z2-7]+$/.test(cid)){
   let host=pdsHosts.get(did);
   if(!host){host=fetch(`https://plc.directory/${did}`,{credentials:'omit',signal:AbortSignal.timeout(12000)}).then(async response=>{
    if(!response.ok)throw new Error('Creator unavailable');const document=await response.json();
    const endpoint=new URL(document.service?.find((service:{id:string})=>service.id==='#atproto_pds')?.serviceEndpoint);
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||/^(?:localhost|127\.|10\.|192\.168\.|\[)/.test(endpoint.hostname))throw new Error('Unsupported PDS');
    return endpoint.origin;
   });pdsHosts.set(did,host);}
   // The CDN lacks pixel-reading CORS. The account's public AT Protocol blob
   // endpoint allows CORS and needs no token or LimeNote server relay.
   url=`${await host}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({did,cid})}`;
  }
 }
 const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(12000)});
 if(!response.ok||!(response.headers.get('content-type')??'').startsWith('image/'))throw new Error('Image unavailable');
 if(Number(response.headers.get('content-length'))>8*1024*1024){await response.body?.cancel();throw new Error('Image too large');}
 const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('Image too large');
 return blob;
}
let queue=Promise.resolve();
self.onmessage=({data}:{data:{id:number;url:string;cancel?:number}})=>{
 if(data.cancel!==undefined){cancelled.add(data.cancel);return;}
 queue=queue.then(async()=>{
  if(cancelled.delete(data.id))return;
  try{
   const blob=await imageBlob(data.url);
   const {processor,model}=await load();
   if(cancelled.delete(data.id))return;
   // Bound decoded pixels before converting to a JS array (large comics can
   // otherwise allocate hundreds of MiB even though CLIP needs only 224 px).
   let image:RawImage;
   if(typeof createImageBitmap==='function'&&typeof OffscreenCanvas!=='undefined'){
    const bitmap=await createImageBitmap(blob,{resizeWidth:384,resizeQuality:'high'});
    try{const scale=Math.min(1,384/bitmap.height);const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);image=RawImage.fromCanvas(canvas);canvas.width=1;canvas.height=1;}finally{bitmap.close();}
   }else image=await RawImage.fromBlob(blob);
   const inputs=await processor(image);
   let outputs:Record<string,Tensor>|undefined;
   try{
   outputs=await model(inputs) as Record<string,Tensor>;
   const {image_embeds}=outputs;
   const raw=Array.from(image_embeds.data as Float32Array),length=Math.hypot(...raw);
   const vector=raw.map(value=>Number((value/length).toFixed(5)));
   if(!cancelled.delete(data.id))self.postMessage({id:data.id,vector});
   }finally{for(const tensor of Object.values(outputs??{}) as Tensor[])tensor.dispose?.();for(const tensor of Object.values(inputs) as Tensor[])tensor.dispose?.();}
  }catch(error){if(!cancelled.delete(data.id))self.postMessage({id:data.id,error:error instanceof Error?error.message:'Image analysis unavailable'});}
 });
};
