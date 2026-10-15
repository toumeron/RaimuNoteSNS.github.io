import type {DragEvent} from 'react';
/** Finder and some mobile file providers omit a file's MIME type. Parse the bytes later. */
export function isVideoAttachment(file:Pick<File,'type'|'name'>):boolean {
 return file.type.startsWith('video/')||/\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
}
export function composerMediaDrop(attach:(files:File[])=>unknown,disabled:boolean){
 return {
  'data-lime-media-dropzone':true,
  onDragOver(event:DragEvent<HTMLElement>){
   if(!Array.from(event.dataTransfer.types).includes('Files')&&!Array.from(event.dataTransfer.items??[]).some(item=>item.kind==='file'))return;
   event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=disabled?'none':'copy';
  },
  onDrop(event:DragEvent<HTMLElement>){
   const files=Array.from(event.dataTransfer.files);if(!files.length)return;
   event.preventDefault();event.stopPropagation();if(!disabled)void attach(files);
  },
 };
}
