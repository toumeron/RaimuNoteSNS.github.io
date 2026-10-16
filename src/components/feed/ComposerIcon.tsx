import { type SVGProps, type DragEvent } from "react";

// ComposerIcon
type ComposerIconKind = 'image' | 'poll' | 'smile' | 'globe' | 'users' | 'members' | 'send';

/** Original toolbar drawings: common 32-unit canvas and 20px toolbar scale. */
function ComposerIcon({kind,...props}:SVGProps<SVGSVGElement>&{kind:ComposerIconKind}) {
 const drawings={
  image:<><rect x="4" y="4" width="24" height="24" rx="5"/><circle cx="21" cy="11" r="2.2" fill="currentColor" stroke="none"/><path d="m5 21 6.5-6.5L25 28"/></>,
  poll:<><circle cx="7.5" cy="9" r="3.5"/><circle cx="7.5" cy="23" r="3.5"/><path d="M17 9h11M17 23h11"/></>,
  smile:<><circle cx="16" cy="16" r="12"/><ellipse cx="11.5" cy="12.5" rx="1.6" ry="2.1" fill="currentColor" stroke="none"/><ellipse cx="20.5" cy="12.5" rx="1.6" ry="2.1" fill="currentColor" stroke="none"/><path d="M10 20q6 6 12 0"/></>,
  globe:<path fill="currentColor" stroke="none" fillRule="evenodd" d="M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26ZM15 5.6l-5.3 1.6-2.1 4.2 4.2 1.8 3.6 2.2-2.4 3.4.5 4.7 2.4 2.9 1.6-7 2.9-2.6-3.4-3.2-3.8-1.4 1.8-6.6ZM22.4 9.1l-3.1 2.8 1.9 4.8 3.5 2.2 1.3 3.4A10.5 10.5 0 0 0 26.7 12l-4.3-2.9Z"/>,
  users:<><circle cx="12" cy="9" r="4.5"/><path d="M3 27a9 9 0 0 1 18 0ZM23 13l3 3 4-7"/></>,
  members:<><path d="m4 9 6 5 6-9 6 9 6-5-3 15H7ZM8 28h16"/><circle cx="4" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="28" cy="7" r="1" fill="currentColor" stroke="none"/></>,
  send:<><path d="m4 5 24 11L4 27l4-11ZM8 16h20"/></>,
 };
 return <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-composer-icon={kind} {...props}>{drawings[kind]}</svg>;
}

function PollIcon(props:SVGProps<SVGSVGElement>) {
 return <ComposerIcon kind="poll" {...props}/>;
}

// Opposing vertical arrows with rounded bends, matching the supplied reference.
function RepostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5 4v12a4 4 0 0 0 4 4h5M2 7l3-3 3 3M10 4h5a4 4 0 0 1 4 4v12m-3-3 3 3 3-3" />
    </svg>
  );
}

// composerMediaDrop
/** Finder and some mobile file providers omit a file's MIME type. Parse the bytes later. */
function isVideoAttachment(file:Pick<File,'type'|'name'>):boolean {
 return file.type.startsWith('video/')||/\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
}
function composerMediaDrop(attach:(files:File[])=>unknown,disabled:boolean){
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

// postSchedule
function validSchedule(value:string,now=Date.now()) {
 const time=Date.parse(value);return Number.isFinite(time)&&time>=now+60_000&&time<=now+366*86400_000;
}
function scheduleLabel(value:string) {return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit',hour12:false}).format(new Date(value));}
type ScheduledPost={id:string;scheduledAt:string;status:'pending'|'failed';error?:string;payload:{content:string;image_urls:string[]}};

export { ComposerIcon };
export { PollIcon };
export { RepostIcon };
export type { ComposerIconKind };
export { isVideoAttachment };
export { composerMediaDrop };
export { validSchedule };
export { scheduleLabel };
export type { ScheduledPost };
