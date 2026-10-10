export const FRIEND_REACTION_EMOJIS=['👍','😢','👩‍💻','🆗','🙏','😮','😋','😭','🎉','👎','❤️','🔥','🤠','😂','🤩','🙃','💯','🧠','⭕'] as const;
export const FRIEND_REACTION_INSTRUCTION=`返答の先頭に、直前の相手のメッセージへのリアクションを <reaction>絵文字</reaction> の形式で必ず1つ出力し、改行して通常の返答を続けてください。絵文字は ${FRIEND_REACTION_EMOJIS.join(' ')} から会話内容に合うものを選んでください。このタグは画面に表示されません。`;
export function parseFriendResponse(text:string):{reply:string;reaction:string|null}{
 const trimmed=text.trimStart();
 if(!trimmed||'<reaction>'.startsWith(trimmed))return {reply:'',reaction:null};
 if(!trimmed.startsWith('<reaction>'))return {reply:text,reaction:null};
 const end=trimmed.indexOf('</reaction>');if(end<0)return {reply:'',reaction:null};
 const emoji=trimmed.slice(10,end).trim();return {reply:trimmed.slice(end+11).trimStart(),reaction:(FRIEND_REACTION_EMOJIS as readonly string[]).includes(emoji)?emoji:null};
}
