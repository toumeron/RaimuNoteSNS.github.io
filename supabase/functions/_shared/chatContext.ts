import { stripImageQuery } from "./friendImages.ts";

// chatContext
type ContextItem = {role:string;parts?:{text?:string;inlineData?:unknown}[]};
/** Bound text before upstream requests. Keep instruction separate from the latest turn. */
function boundedChatContext<T extends ContextItem>(items:T[]):T[]{
 const instructions=items.filter(i=>i.parts?.some(p=>p.text?.startsWith('【システム命令:'))).slice(0,1).map(i=>({...i,parts:i.parts?.map(p=>p.text?{...p,text:p.text.slice(0,2000)}:p)}));
 const history=items.filter(i=>!i.parts?.some(p=>p.text?.startsWith('【システム命令:'))).slice(-24);
 let remaining=4000;const kept:T[]=[];
 for(let n=history.length-1;n>=0;n--){const item=history[n];const parts=item.parts?.map(p=>{if(typeof p.text!=='string')return p;const limit=Math.min(remaining,n===history.length-1?3000:1000);const text=p.text.slice(0,limit);remaining-=text.length;return {...p,text}});if(parts?.some(p=>p.text||!('text'in p)))kept.unshift({...item,parts});if(remaining<=0)break;}
 return [...instructions,...kept] as T[];
}

// friendPacing
/** A complete reply appears after a bounded, length-dependent typing interval. */
function friendTypingDuration(text:string):number {
 return Math.min(12000,1200+Array.from(text.trim()).length*65);
}
async function waitForFriendReply(text:string,startedAt:number,signal?:AbortSignal):Promise<void>{
 const remaining=Math.max(0,friendTypingDuration(text)-(Date.now()-startedAt));
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(!remaining)return;
 await new Promise<void>((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},remaining);
  signal?.addEventListener('abort',abort,{once:true});
 });
}
const GROUP_FRIEND_PARTICIPATION_INSTRUCTION='グループの会話では全発言に返信する必要はありません。自分への質問・呼びかけ、話題への有益な補足がある場合だけ返信してください。相づちの重複、他の参加者同士の会話、挨拶の繰り返し、会話が終わった場合など返信が不要なら <skip/> だけを出力してください。この場合リアクションタグも出力しません。';
function friendDeclinedReply(text:string):boolean{return /^\s*<skip\s*\/?>\s*$/.test(text);}

// friendReaction
const FRIEND_REACTION_EMOJIS=['👍','😢','👩‍💻','🆗','🙏','😮','😋','😭','🎉','👎','❤️','🔥','🤠','😂','🤩','🙃','💯','🧠','⭕'] as const;
const FRIEND_REACTION_INSTRUCTION=`返答の先頭に、直前の相手のメッセージへのリアクションを <reaction>絵文字</reaction> の形式で必ず1つ出力し、改行して通常の返答を続けてください。絵文字は ${FRIEND_REACTION_EMOJIS.join(' ')} から会話内容に合うものを選んでください。このタグは画面に表示されません。`;
function parseReaction(text:string):{reply:string;reaction:string|null}{
 const trimmed=text.trimStart();
 if(!trimmed||'<reaction>'.startsWith(trimmed))return {reply:'',reaction:null};
 if(!trimmed.startsWith('<reaction>'))return {reply:text,reaction:null};
 const end=trimmed.indexOf('</reaction>');if(end<0)return {reply:'',reaction:null};
 const emoji=trimmed.slice(10,end).trim();return {reply:trimmed.slice(end+11).trimStart(),reaction:(FRIEND_REACTION_EMOJIS as readonly string[]).includes(emoji)?emoji:null};
}

function parseFriendResponse(text:string):{reply:string;reaction:string|null;imageQuery?:string}{const result=parseReaction(text);return {...result,...stripImageQuery(result.reply)};}

// groupFriendParticipation
type Friend={id:string;name:string};
/** Invitations are checked before generation; a helpful model cannot opt itself into every turn. */
function invitedGroupFriends(text:string,friends:Friend[],messageId:string,replyFriend?:string|null):Set<string>{
 if(replyFriend!==undefined)return new Set(replyFriend?[replyFriend]:[]);
 const normalized=text.normalize('NFKC').trim();
 if(!normalized)return new Set();
 const named=friends.filter(f=>f.name.trim()&&normalized.includes(f.name.normalize('NFKC').trim()));
 if(named.length)return new Set(named.map(f=>f.id));
 // Statements such as "眠すぎる" or "醤油を買うのを忘れたかも" are not requests for advice.
 const question=/[?？]|(?:教えて|教え下さい|教えてください|どう思う|どうすれば|どうしたら|知ってる|知っていますか|分かる|わかる|手伝って|助けて|おすすめ.*(?:ある|は)|誰か.*(?:いる|お願い))/.test(normalized);
 if(!question)return new Set();
 const all=/(?:みんな|皆さん|皆んな|全員|二人とも|ふたりとも|三人とも|さんにんとも|フレンドたち)/.test(normalized);
 if(all)return new Set(friends.map(f=>f.id));
 // An open question invites one friend, preventing duplicate answers from every friend.
 let hash=0;for(const char of messageId)hash=(hash*31+char.charCodeAt(0))>>>0;
 return new Set(friends.length?[friends[hash%friends.length].id]:[]);
}

// modelFailover
const CLOUDFLARE_FALLBACK_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
type CloudflareAIConfig = { token?: string; accountId?: string; model?: string };
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Credentials stay on the server. Cloudflare is called only after a failed Groq response. */
async function requestModelWithFailover(groqKey: string, input: Record<string, unknown>, cloudflare: CloudflareAIConfig, signal?: AbortSignal, validation: {acceptText?: (text:string)=>boolean} = {}): Promise<Response> {
  const run = async (url: string, token: string, body: Record<string, unknown>) => {
    const timeout = AbortSignal.timeout(45000);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`AI provider HTTP ${response.status}`); }
    // Stage the response before publishing: a broken primary stream cannot mix with the fallback.
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('AI response exceeded limit');
    if (body.stream) {
      let complete = false, answered = false, toolCall = false, answer='';
      for (const line of text.split('\n')) {
        if (!line.trim().startsWith('data:')) continue;
        const data = line.trim().slice(5).trim();
        if (data === '[DONE]') { complete = true; continue; }
        let event; try { event = JSON.parse(data); } catch { throw new Error('Invalid AI stream'); }
        if (event.error) throw new Error('AI stream error');
        for(const choice of event.choices??[]){if(typeof choice.delta?.content==='string')answer+=choice.delta.content;toolCall ||= Boolean(choice.delta?.tool_calls?.length);}
        answered ||= Boolean(event.choices?.some((choice: {delta?: {content?: string; tool_calls?: unknown[]}}) => choice.delta?.content || choice.delta?.tool_calls?.length));
      }
      if (!complete || !answered) throw new Error('Incomplete AI stream');
      if(validation.acceptText&&!toolCall&&!validation.acceptText(answer))throw new Error('AI response has no displayable answer');
    } else {
      const result = JSON.parse(text);
      if (result.error || !result.choices?.length) throw new Error('Invalid AI completion');
      if(validation.acceptText&&!result.choices.some((choice:any)=>choice.message?.tool_calls?.length||validation.acceptText!(typeof choice.message?.content==='string'?choice.message.content:'')))throw new Error('AI response has no displayable answer');
    }
    return new Response(text, { headers: { 'Content-Type': body.stream ? 'text/event-stream' : 'application/json' } });
  };
  try {
    return await run(GROQ_URL, groqKey, input);
  } catch (error) {
    signal?.throwIfAborted();
    if (!cloudflare.token || !cloudflare.accountId || !/^[a-f0-9]{32}$/i.test(cloudflare.accountId)) throw error;
    const body: Record<string, unknown> = { ...input, model: cloudflare.model || CLOUDFLARE_FALLBACK_MODEL };
    delete body.reasoning_effort;
    if (body.max_completion_tokens !== undefined) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
    return await run(`https://api.cloudflare.com/client/v4/accounts/${cloudflare.accountId}/ai/v1/chat/completions`, cloudflare.token, body);
  }
}

// aiVoice
// Fish Audio's Japanese “落ち着いた女性” from its official soft-voice library:
// https://fish.audio/ja/app/m/0089dce5fefb4c6ba9b9f2f0debe1ddc/
const CALM_FEMALE_VOICE_ID = '0089dce5fefb4c6ba9b9f2f0debe1ddc';
const CALM_FEMALE_VOICE_NAME = '落ち着いた女性';
const PCM_SAMPLE_RATE = 24000;

// Japanese conversational male voice: https://fish.audio/ja/m/de5f57933d304c8faedb8244e3f991d9/
const JAPANESE_MALE_VOICE_ID = 'de5f57933d304c8faedb8244e3f991d9';
function resolveVoiceId(opts: { voiceURI?: string; gender?: 'female' | 'male' }) {
  return opts.voiceURI || (opts.gender === 'male' ? JAPANESE_MALE_VOICE_ID : CALM_FEMALE_VOICE_ID);
}

export { boundedChatContext };
export type { ContextItem };
export { friendTypingDuration };
export { waitForFriendReply };
export { friendDeclinedReply };
export { GROUP_FRIEND_PARTICIPATION_INSTRUCTION };
export { parseFriendResponse };
export { FRIEND_REACTION_EMOJIS };
export { FRIEND_REACTION_INSTRUCTION };
export { invitedGroupFriends };
export { requestModelWithFailover };
export { CLOUDFLARE_FALLBACK_MODEL };
export type { CloudflareAIConfig };
export { resolveVoiceId };
export { CALM_FEMALE_VOICE_ID };
export { CALM_FEMALE_VOICE_NAME };
export { PCM_SAMPLE_RATE };
export { JAPANESE_MALE_VOICE_ID };
