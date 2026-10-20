import {ArrowUpLeft,X} from 'lucide-react';
import type {User} from '@/types';
import {ProviderVerificationBadge} from '@/components/ui/avatar';
import {displayUsername} from '@/lib/utils';

export function MobileSearchRecents({accounts,history,onClear,onAccount,onSearch,onFill}:{accounts:User[];history:string[];onClear:()=>void;onAccount:(user:User)=>void;onSearch:(value:string)=>void;onFill:(value:string)=>void}){
 if(!accounts.length&&!history.length)return null;
 return <section aria-label="最近の検索" className="pb-6">
  <div className="flex items-center justify-between px-4 py-5"><h2 className="text-2xl font-bold">最近</h2>{(accounts.length>0||history.length>0)&&<button type="button" aria-label="最近の検索をすべて消去" onClick={onClear} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><X className="h-5 w-5"/></button>}</div>
  {accounts.length>0&&<div className="flex gap-3 overflow-x-auto px-4 pb-5" aria-label="最近検索したアカウント">{accounts.map(account=><button type="button" key={account.id} onClick={()=>onAccount(account)} className="flex w-24 shrink-0 flex-col items-center gap-1 text-center">
   {account.avatarUrl?<img src={account.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover"/>:<span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-xl">{account.displayName.slice(0,1)}</span>}
   <span className="flex w-full min-w-0 items-center justify-center gap-1"><span className="truncate text-sm font-semibold">{account.displayName}</span><ProviderVerificationBadge verification={account.providerVerification} className="h-4 w-4 shrink-0"/>{account.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="公式" className="h-4 w-4 shrink-0"/>}</span>
   <span className="w-full truncate text-xs text-muted-foreground">@{displayUsername(account.username)}</span>
  </button>)}</div>}
  {history.map(value=><div key={value} className="flex items-center px-4"><button type="button" onClick={()=>onSearch(value)} className="min-w-0 flex-1 py-4 text-left text-lg font-semibold"><span className="block truncate">{value}</span></button><button type="button" aria-label={`${value}を検索欄に入力`} onClick={()=>onFill(value)} className="flex h-11 w-11 shrink-0 items-center justify-center text-primary"><ArrowUpLeft className="h-6 w-6"/></button></div>)}
 </section>;
}
