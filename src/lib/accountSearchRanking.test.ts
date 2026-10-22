import {expect,it} from 'vitest';
import type {User} from '@/types';
import {rankAccountSearch,followedAccountMatcher} from "@/lib/utils";
const user=(id:string,displayName:string,username=id,bio='')=>({id,displayName,username,bio} as User);
it('ranks followed native and external accounts ahead of unfollowed matches in one suggestion list',()=>{
 const local=user('local','ねこ'),external=user('x-user:2','ねこの投稿','cat@twitter.com');
 const result=rankAccountSearch([local],[external],[external],'ねこ',5);
 expect(result.map(u=>u.id)).toEqual([external.id,local.id]);
});
it('matches saved follows by provider handle when their cached ID differs',()=>{
 const saved=user('x-user:legacy','Artist','artist@x.com'),fresh=user('x-user:123','Artist','artist@twitter.com');
 expect(followedAccountMatcher([saved])(fresh)).toBe(true);
 expect(followedAccountMatcher([saved])(user('local','Artist','artist'))).toBe(false);
});
it('retains API alias results even when the literal profile does not contain the query',()=>{
 const alias=user('x-user:alias','正式名称','official@twitter.com');
 expect(rankAccountSearch([], [alias], [],'愛称')).toEqual([alias]);
 expect(rankAccountSearch([alias], [], [],'無関係')).toEqual([]);
});
it('uses kana, width, case and profile bio matches without adding unrelated followed accounts',()=>{
 const followed=user('cat','ネコの日記','Cat','写真家'),other=user('other','犬');
 expect(rankAccountSearch([other],[],[followed],'ねこ')).toEqual([followed]);
 expect(rankAccountSearch([],[],[followed],'ＣＡＴ')).toEqual([followed]);
 expect(rankAccountSearch([],[],[followed],'写真家')).toEqual([followed]);
 expect(rankAccountSearch([],[],[followed],'')).toEqual([]);
});
it('deduplicates native, API and saved follow profiles before limiting suggestions',()=>{
 const saved=user('same','ねこ'),fresh={...saved,displayName:'ねこの新しい名前'};
 expect(rankAccountSearch([saved],[fresh],[saved],'ねこ',1)).toEqual([fresh]);
});
it('replaces a saved Misskey placeholder by handle even when the live provider ID differs',()=>{
 const saved=user('misskey-user:km170','User','km170@misskey.io');
 const fresh={...user('misskey-user:9c3jecs715','たんたんめん','km170@misskey.io'),avatarUrl:'https://example.com/avatar.png'};
 expect(rankAccountSearch([saved],[fresh],[saved],'km170')).toEqual([fresh]);
});
