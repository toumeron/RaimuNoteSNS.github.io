import type {User} from '@/types';

export const normalizeAccountText=(value:string|null|undefined)=>(value??'').normalize('NFKC').toLocaleLowerCase().replace(/^@+/, '').replace(/:[a-z0-9_]+:/gi,' ').replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60)).trim();
const normalize=normalizeAccountText;
export const accountHandleKey=(username:string)=>normalize(username).replace(/@x\.com$/,'@twitter.com');
export function followedAccountMatcher(following:readonly User[]){
 const ids=new Set(following.map(user=>user.id)),handles=new Set(following.map(user=>accountHandleKey(user.username)).filter(Boolean));
 return (user:Pick<User,'id'|'username'>)=>ids.has(user.id)||handles.has(accountHandleKey(user.username));
}
export function accountQueryScore(user:User,query:string):number{
 const terms=normalize(query.trim()).split(/\s+/).filter(Boolean);if(!terms.length)return 0;
 const fields=[normalize(user.displayName),normalize(user.username)],bio=normalize(user.bio??'');
 let score=0;
 for(const term of terms){
  if(fields.includes(term))score+=100;
  else if(fields.some(field=>field.startsWith(term)))score+=60;
  else if(fields.some(field=>field.includes(term)))score+=30;
  else if(bio.includes(term))score+=10;
  else return 0;
 }
 return score;
}
/** API matches may resolve aliases absent from the profile's literal display name. */
export function rankAccountSearch(local:readonly User[],remote:readonly User[],following:readonly User[],query:string,limit=Infinity):User[]{
 if(!query.trim().replace(/^@+/,''))return [];
 const remoteIds=new Set(remote.map(user=>user.id)),isFollowed=followedAccountMatcher(following);
 const users=[...new Map([...following,...local,...remote].map(user=>[accountHandleKey(user.username)||user.id,user])).values()];
 return users.map((user,index)=>({user,index,score:accountQueryScore(user,query)}))
  .filter(item=>item.score>0||remoteIds.has(item.user.id))
  .sort((a,b)=>Number(isFollowed(b.user))-Number(isFollowed(a.user))||b.score-a.score||a.index-b.index)
  .map(item=>item.user).slice(0,limit);
}
