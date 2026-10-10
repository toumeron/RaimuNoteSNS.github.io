/** A complete reply appears after a bounded, length-dependent typing interval. */
export function friendTypingDuration(text:string):number {
 return Math.min(12000,1200+Array.from(text.trim()).length*65);
}
export async function waitForFriendReply(text:string,startedAt:number,signal?:AbortSignal):Promise<void>{
 const remaining=Math.max(0,friendTypingDuration(text)-(Date.now()-startedAt));
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(!remaining)return;
 await new Promise<void>((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},remaining);
  signal?.addEventListener('abort',abort,{once:true});
 });
}
export const GROUP_FRIEND_PARTICIPATION_INSTRUCTION='グループの会話では全発言に返信する必要はありません。自分への質問・呼びかけ、話題への有益な補足がある場合だけ返信してください。相づちの重複、他の参加者同士の会話、挨拶の繰り返し、会話が終わった場合など返信が不要なら <skip/> だけを出力してください。この場合リアクションタグも出力しません。';
export function friendDeclinedReply(text:string):boolean{return /^\s*<skip\s*\/?>\s*$/.test(text);}
