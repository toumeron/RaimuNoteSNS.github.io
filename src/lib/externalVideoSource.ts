/** MP4/GIF sources without HLS variants need a referrer-free read as well. */
export async function resolveExternalMp4(url:string,signal:AbortSignal){
 const response=await fetch(url,{signal,referrerPolicy:'no-referrer'});
 if(!response.ok)throw new Error('動画を読み込めませんでした');
 const blob=await response.blob();
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 return URL.createObjectURL(blob);
}
