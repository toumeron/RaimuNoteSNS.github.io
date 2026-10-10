type Friend={id:string;name:string};
/** Invitations are checked before generation; a helpful model cannot opt itself into every turn. */
export function invitedGroupFriends(text:string,friends:Friend[],messageId:string,replyFriend?:string|null):Set<string>{
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
