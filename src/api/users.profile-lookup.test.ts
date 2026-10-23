import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({data:null as Record<string,unknown>|null,error:null as {code:string}|null}));
vi.mock('@/lib/supabase',async original=>({...await original<typeof import('@/lib/supabase')>(),supabase:{from:()=>{
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:state.data,error:state.error})};return query;
}}}));
import {getUserByUsername} from './users';
beforeEach(()=>{state.data=null;state.error=null;});
it('returns absence only for a successful lookup with no profile',async()=>{
 expect(await getUserByUsername('LimeNote')).toBeNull();
});
it('does not mistake a periodic failed lookup for a missing native account',async()=>{
 state.error={code:'NETWORK_ERROR'};await expect(getUserByUsername('LimeNote')).rejects.toEqual(state.error);
});
it('preserves the native identity when a profile is returned',async()=>{
 state.data={id:'owner',username:'LimeNote',display_name:'LimeNote',birth_date:'1998-05-10',website_url:'https://Example.com/日本語'};
 expect(await getUserByUsername('LimeNote')).toMatchObject({id:'owner',username:'LimeNote',birthDate:'1998-05-10',websiteUrl:'https://Example.com/日本語'});
});
