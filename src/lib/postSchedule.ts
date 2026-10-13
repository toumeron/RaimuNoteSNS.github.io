export function validSchedule(value:string,now=Date.now()) {
 const time=Date.parse(value);return Number.isFinite(time)&&time>=now+60_000&&time<=now+366*86400_000;
}
export function scheduleLabel(value:string) {return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit',hour12:false}).format(new Date(value));}
export type ScheduledPost={id:string;scheduledAt:string;status:'pending'|'failed';error?:string;payload:{content:string;image_urls:string[]}};
