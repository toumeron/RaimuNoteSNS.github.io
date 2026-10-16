/** Fit inline videos just like post images. Small ratio-only metadata (16/9,
 * etc.) must not be mistaken for the video's natural pixel dimensions. */
export function inlineVideoFrame(width:number,height:number,mobile:boolean,embedded=false):{width:string;maxWidth:string}{
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){width=16;height=9;}
 const maxHeight=embedded?120:mobile?300:480;
 const naturalLimit=width>=64&&height>=64?width:Infinity;
 const displayWidth=Math.max(1,Math.floor(Math.min(naturalLimit,maxHeight*width/height)));
 return {width:`${displayWidth}px`,maxWidth:'100%'};
}
