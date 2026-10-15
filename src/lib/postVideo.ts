export const MAX_VIDEO_SECONDS = 90;
export const MAX_VIDEO_BYTES = 36 * 1024 * 1024;
export type PostVideo = {key:string;duration:number;width:number;height:number;size:number;mimeType:'video/mp4';posterKey?:string};
export type PreparedVideo = {file:File;poster?:Blob;url:string;duration:number;width:number;height:number};
export function videoDimensions(width:number,height:number,maxLong=1920,maxShort=1080) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('動画の解像度を読み取れませんでした');
  const scale=Math.min(1,maxLong/Math.max(width,height),maxShort/Math.min(width,height));
  return {width:Math.max(2,Math.floor(width*scale/2)*2),height:Math.max(2,Math.floor(height*scale/2)*2)};
}
export function validateVideoDuration(duration:number) {
  if(!Number.isFinite(duration)||duration<=0)throw new Error('動画の長さを読み取れませんでした');
  if(duration>MAX_VIDEO_SECONDS)throw new Error('動画は90秒以内にしてください');
}
/** Transcode before upload; never send the original to a remote service. */
export async function preparePostVideo(file:File,onProgress:(progress:number)=>void,signal?:AbortSignal):Promise<PreparedVideo> {
  if(file.size>512*1024*1024)throw new Error('元の動画は512MB以内にしてください');
  const {Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,BufferTarget,Conversion,Quality,CanvasSink}=await import('mediabunny');
  signal?.throwIfAborted();
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  let conversion:Awaited<ReturnType<typeof Conversion.init>>|undefined;
  const cancel=()=>{void conversion?.cancel();};signal?.addEventListener('abort',cancel,{once:true});
  try{
    const duration=await input.computeDuration();validateVideoDuration(duration);
    const track=await input.getPrimaryVideoTrack();if(!track)throw new Error('映像のある動画を選択してください');
    const candidates=[[1920,1080],[1280,720],[854,480]].map(([long,short])=>videoDimensions(track.displayWidth,track.displayHeight,long,short)).filter((size,index,all)=>all.findIndex(other=>other.width===size.width&&other.height===size.height)===index);
    let prepared:{file:File;width:number;height:number}|undefined,progress=0;
    for(const dimensions of candidates){
      const output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target:new BufferTarget()});
      // Explicit bitrate, not a qualitative Quality number. Keep the encoded file within the storage limit.
      conversion=await Conversion.init({input,output,tracks:'primary',trim:{end:Math.min(duration,89.75)},video:{...dimensions,fit:'contain',codec:'avc',quality:new Quality({bitrate:2_000_000,bitrateMode:'constant'}),frameRate:30,forceTranscode:true,allowTransformationMetadata:false},audio:{codec:'aac',quality:new Quality({bitrate:96_000})}});
      signal?.throwIfAborted();
      if(!conversion.isValid||conversion.discardedTracks.some(t=>t.track.type==='video'||t.track.type==='audio'))throw new Error('このブラウザーでは動画を変換できません。MP4形式の動画を対応するブラウザーで選択してください');
      conversion.onProgress=value=>{progress=Math.max(progress,value*.9);onProgress(progress);};
      await conversion.execute();signal?.throwIfAborted();
      const buffer=output.target.buffer;if(!buffer)throw new Error('圧縮した動画を生成できませんでした。もう一度お試しください');
      if(buffer.byteLength>MAX_VIDEO_BYTES)continue;
      prepared={file:new File([buffer],file.name.replace(/\.[^.]+$/,'')+'.mp4',{type:'video/mp4'}),...dimensions};break;
    }
    if(!prepared)throw new Error('圧縮した動画が保存できるサイズを超えました');
    const {file:result,...dimensions}=prepared;
    const frame=await new CanvasSink(track,{width:Math.min(480,dimensions.width)}).getCanvas(0);
    let poster:Blob|undefined;
    if(frame){const canvas=frame.canvas;poster='convertToBlob' in canvas?await canvas.convertToBlob({type:'image/jpeg',quality:.7}):await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!), 'image/jpeg',.7));}
    signal?.throwIfAborted();
    // AAC and frame boundaries may add padding: validate the actual encoded file too.
    const encoded=new Input({source:new BlobSource(result),formats:ALL_FORMATS});
    let encodedDuration:number;try{encodedDuration=await encoded.computeDuration();validateVideoDuration(encodedDuration);}finally{encoded.dispose();}
    onProgress(1);return {poster,file:result,url:URL.createObjectURL(result),duration:encodedDuration,...dimensions};
  }finally{signal?.removeEventListener('abort',cancel);input.dispose();}
}
