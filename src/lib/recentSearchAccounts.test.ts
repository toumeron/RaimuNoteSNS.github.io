import {beforeEach,expect,it} from 'vitest';
import type {User} from '@/types';
import {recentSearchAccounts,rememberSearchAccount,clearRecentSearchAccounts} from './recentSearchAccounts';
const account=(id:string,username=id)=>({id,username,displayName:`名前${id}`,avatarUrl:'avatar'} as User);
beforeEach(()=>localStorage.clear());
it('keeps recent accounts in selection order, deduplicates handles and scopes history to the viewer',()=>{
 rememberSearchAccount('viewer',account('old','artist@x.com'));
 rememberSearchAccount('viewer',account('other'));
 rememberSearchAccount('viewer',account('new','artist@twitter.com'));
 expect(recentSearchAccounts('viewer').map(user=>user.id)).toEqual(['new','other']);
 expect(recentSearchAccounts('another-viewer')).toEqual([]);
 clearRecentSearchAccounts('viewer');expect(recentSearchAccounts('viewer')).toEqual([]);
});
it('bounds the history and handles unavailable or malformed entries',()=>{
 for(let i=0;i<12;i++)rememberSearchAccount('viewer',account(String(i)));
 expect(recentSearchAccounts('viewer')).toHaveLength(10);
 localStorage.setItem('search:recent-accounts:viewer','{"bad":true}');
 expect(recentSearchAccounts('viewer')).toEqual([]);
 rememberSearchAccount(undefined,account('guest'));expect(recentSearchAccounts()).toEqual([]);
});
