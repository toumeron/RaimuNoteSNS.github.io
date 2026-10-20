// friendImages
const FRIEND_REPLY_INSTRUCTION='画像検索タグやリアクションタグは補助情報です。タグを出力する場合も、必ずその後にユーザーの質問に答える自然な文章を続けてください。タグだけを返して終了してはいけません。説明文を省略せず、実際の画像取得前に画像が見つかったと断言しないでください。';
type FriendPhoto={url:string;sourceUrl:string;title:string;artist:string;license:string};
const FRIEND_IMAGE_INSTRUCTION='具体的な食べ物・動植物・建物・観光スポット・物の説明、紹介、おすすめ、旅行や料理の話では写真を積極的に添えてください。具体物の説明・紹介に対しては、文章だけで返答せず画像検索タグを付けてください。見た目が分かると役立つ具体的な対象がある場合は毎回画像を選び、ユーザーが画像や写真を求めた場合は必ず画像検索語を出してください。リアクションタグの後・本文の前に <image-query>具体的な英語の画像検索語</image-query> を1つ出力してください（例: 担々麺の説明なら dandan noodles）。雑談・感情・抽象的な相談には画像は不要です。URLや画像Markdownは絶対に生成せず、画像が見つかったと断言しないでください。画像検索語は80文字以下にしてください。'+FRIEND_REPLY_INSTRUCTION;
function stripImageQuery(text:string):{reply:string;imageQuery?:string}{
 const match=text.match(/<image-query>([^<\n]{1,80})<\/image-query>/);
 const start=text.lastIndexOf('<');
 const complete=text.replace(/<image-query>[\s\S]*?(?:<\/image-query>|$)/g,'').replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/<friend-photo>[\s\S]*?(?:<\/friend-photo>|$)/g,'');
 const reply=(start>=0&&'<image-query>'.startsWith(text.slice(start))?complete.slice(0,start):complete).trimStart();
 return {reply,...(match?.[1].trim()?{imageQuery:match[1].trim()}: {})};
}
const plain=(value:unknown)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').slice(0,300):'';
const validImage=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname)&&!u.username&&!u.password;}catch{return false}};
function validFriendPhoto(value:unknown):value is FriendPhoto{
 if(!value||typeof value!=='object')return false;const p=value as FriendPhoto;
 return typeof p.url==='string'&&validImage(p.url)&&typeof p.sourceUrl==='string'&&p.sourceUrl.startsWith('https://commons.wikimedia.org/wiki/File:')&&['title','artist','license'].every(key=>typeof (p as unknown as Record<string,unknown>)[key]==='string');
}
/** Only the provider chooses URLs; model output can supply a bounded search term. */
async function findFriendPhoto(query:string,transport:typeof fetch=fetch):Promise<FriendPhoto|null>{
 if(!query.trim()||query.length>80)return null;
 const signal=AbortSignal.timeout(12000);
 try{
  const search=async(term:string)=>{
   const url=new URL('https://commons.wikimedia.org/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:term,gsrnamespace:'6',gsrlimit:'8',prop:'imageinfo',iiprop:'url|mime|extmetadata',iiurlwidth:'960',iiextmetadatafilter:'Artist|LicenseShortName',origin:'*'}).toString();
   const response=await transport(url,{signal});if(!response.ok)return null;const data=await response.json();
   const pages=Object.values(data.query?.pages??{}) as {index?:number;title:string;imageinfo?:{url:string;thumburl?:string;descriptionurl:string;mime:string;extmetadata?:Record<string,{value:string}>}[]}[];
   for(const page of pages.sort((a,b)=>(a.index??0)-(b.index??0))){
    const info=page.imageinfo?.[0];if(!info||!['image/jpeg','image/png','image/webp'].includes(info.mime))continue;
    for(const imageUrl of [...new Set([info.thumburl,info.url].filter(Boolean))]){
     const photo={url:imageUrl!,sourceUrl:info.descriptionurl,title:plain(page.title.replace(/^File:/,'')),artist:plain(info.extmetadata?.Artist?.value),license:plain(info.extmetadata?.LicenseShortName?.value)};
     if(!validFriendPhoto(photo)||!photo.license)continue;
     try{const check=await transport(photo.url,{method:'HEAD',signal,redirect:'error'});if(check.ok&&/^image\/(jpeg|png|webp)(?:;|$)/i.test(check.headers.get('content-type')??''))return photo;}catch{if(signal.aborted)return null;}
    }
   }
   return null;
  };
  const found=await search(query);if(found)return found;
  // Commons file names often use English. Resolve the actual topic through Wikipedia
  // rather than relying on the model to translate or invent an image URL.
  if(/[ぁ-んァ-ヶ一-龯]/.test(query)&&!signal.aborted){
   const wiki=new URL('https://ja.wikipedia.org/w/api.php');wiki.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:query,gsrlimit:'1',prop:'langlinks',lllang:'en',origin:'*'}).toString();
   const response=await transport(wiki,{signal});if(response.ok){const data=await response.json();const pages=Object.values(data.query?.pages??{}) as {langlinks?:{'*':string}[]}[];const english=pages[0]?.langlinks?.[0]?.['*'];if(english&&english.length<=80)return await search(english);}
  }
 }catch{/* A missing photo must never suppress the text reply. */}
 return null;
}
function appendFriendPhoto(reply:string,photo:FriendPhoto|null,maxLength=Infinity):string{
 if(!photo||!validFriendPhoto(photo))return reply.slice(0,maxLength);
 const metadata=`\n<friend-photo>${JSON.stringify(photo)}</friend-photo>`;
 return metadata.length>=maxLength?reply.slice(0,maxLength):reply.slice(0,maxLength-metadata.length)+metadata;
}
function readFriendPhoto(content:string):{text:string;photo:FriendPhoto|null}{
 const match=content.match(/\n<friend-photo>([^\n]+)<\/friend-photo>$/);if(!match)return {text:content,photo:null};
 let photo:FriendPhoto|null=null;try{const value=JSON.parse(match[1]);if(validFriendPhoto(value))photo=value;}catch{}return {text:content.slice(0,match.index),photo};
}
/** Recover visual explanation requests even when the model omits its metadata tag. */
function chooseFriendImageQuery(query:string|undefined,question:string,reply:string):string|undefined{
 if(query?.trim()&&query.length<=80)return query.trim();
 const text=question.trim().slice(0,1000);
 const match=text.match(/^(.{1,60}?)(?:って|とは|は)(?:どんな(?:食べ物|料理|動物|植物|建物|物|もの|見た目)|何ですか|なんですか|なに|何|どんなもの)/)||text.match(/^(.{1,60}?)(?:の)?(?:写真|画像|見た目)(?:を|が|は)?(?:見せ|教え|知り|どんな|見たい|ください|お願い)/)||text.match(/^(.{1,60}?)(?:について|を)(?:教えて|知りたい|紹介して|説明して|見せて)/);
 if(!match)return undefined;

 const topic=match[1].replace(/^[「『\s]+|[」』\s?？。！!]+$/g,'').trim();
 if(!topic||/(気持ち|人生|愛|友情|幸せ|意味|エラー|プログラム|コード|設定|機能|方法|使い方)/.test(topic))return undefined;
 return topic;
}

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
export { stripImageQuery };
export { validFriendPhoto };
export { findFriendPhoto };
export { appendFriendPhoto };
export { readFriendPhoto };
export { chooseFriendImageQuery };
export { FRIEND_REPLY_INSTRUCTION };
export type { FriendPhoto };
export { FRIEND_IMAGE_INSTRUCTION };
