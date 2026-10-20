import type {User} from '@/types';
import {accountHandleKey} from './accountSearchRanking';
export const RECENT_SEARCH_ACCOUNTS_EVENT='lime:recent-search-accounts';
const key=(owner:string)=>`search:recent-accounts:${owner}`;
export function recentSearchAccounts(owner?:string):User[]{
 if(!owner)return [];
 try{const value=JSON.parse(localStorage.getItem(key(owner))??'[]');return Array.isArray(value)?value.filter(user=>user&&typeof user.id==='string'&&typeof user.username==='string'&&typeof user.displayName==='string').slice(0,10):[];}catch{return [];}
}
export function rememberSearchAccount(owner:string|undefined,user:User){
 if(!owner)return;
 const {id,username,displayName,avatarUrl,isOfficial,isPrivate,providerVerification}=user;
 const next=[{id,username,displayName,avatarUrl,isOfficial,isPrivate,providerVerification},...recentSearchAccounts(owner).filter(previous=>accountHandleKey(previous.username)!==accountHandleKey(username))].slice(0,10);
 try{localStorage.setItem(key(owner),JSON.stringify(next));window.dispatchEvent(new Event(RECENT_SEARCH_ACCOUNTS_EVENT));}catch{/* Storage may be unavailable. */}
}
export function clearRecentSearchAccounts(owner?:string){
 if(!owner)return;
 try{localStorage.removeItem(key(owner));window.dispatchEvent(new Event(RECENT_SEARCH_ACCOUNTS_EVENT));}catch{/* Storage may be unavailable. */}
}
