export type PollOption={label:string;image?:string;votes:number};
export type Poll={options:PollOption[];endsAt:string};
export type PollDraft={options:{label:string;image?:string}[];durationMinutes:number};
export function validatePollDraft(poll:PollDraft):string|null {
 if(poll.options.length<2||poll.options.length>4)return '回答は2〜4個にしてください';
 if(poll.options.some(option=>!option.label.trim()||Array.from(option.label.trim()).length>25))return '回答は1〜25文字で入力してください';
 if(!Number.isInteger(poll.durationMinutes)||poll.durationMinutes<1||poll.durationMinutes>10080)return '投票期間は1分〜7日で設定してください';
 return null;
}
export function pollRemaining(endsAt:string,now=Date.now()):string {
 const minutes=Math.ceil((Date.parse(endsAt)-now)/60000);
 return minutes<=0?'投票終了':minutes>=1440?`残り${Math.ceil(minutes/1440)}日`:minutes>=60?`残り${Math.ceil(minutes/60)}時間`:`残り${minutes}分`;
}
export function pollPercent(votes:number,total:number):number {return total?Math.round(votes*100/total):0;}
