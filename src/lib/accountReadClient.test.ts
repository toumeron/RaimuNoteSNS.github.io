import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({tokens:{access_token:'access',refresh_token:'refresh'} as {access_token:string;refresh_token:string}|null,create:vi.fn(),save:vi.fn(),session:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:state.create}));
vi.mock('./savedAccounts',()=>({getSavedAccountTokens:()=>state.tokens,saveAccountSession:state.save}));
import { getAccountReadClient } from './accountReadClient';
beforeEach(()=>{state.tokens={access_token:'access',refresh_token:'refresh'};state.save.mockReset();state.session.mockReset().mockResolvedValue({data:{session:{user:{id:'other'},refresh_token:'refresh'}},error:null});state.create.mockReset().mockReturnValue({auth:{setSession:state.session}});});
it('isolates concurrent reads and does not replace the application session or persist its own session',async()=>{
 const [a,b]=await Promise.all([getAccountReadClient('other'),getAccountReadClient('other')]);
 expect(a).toBe(b);expect(state.create).toHaveBeenCalledTimes(1);
 expect(state.create.mock.calls[0][2].auth).toMatchObject({persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
 expect(state.save).not.toHaveBeenCalled();
});
it('rejects a mismatched authenticated owner before returning a reader',async()=>{
 state.session.mockResolvedValue({data:{session:{user:{id:'wrong'},refresh_token:'refresh'}},error:null});
 await expect(getAccountReadClient('other')).rejects.toThrow('確認');
});
it('cannot read a logged-out account using previously cached credentials',async()=>{
 await getAccountReadClient('other');state.tokens=null;
 await expect(getAccountReadClient('other')).rejects.toThrow('ログイン');
});
it('retains a refreshed session for the same owner without editing any list data',async()=>{
 state.session.mockResolvedValue({data:{session:{user:{id:'other'},refresh_token:'new-refresh'}},error:null});
 await getAccountReadClient('other');expect(state.save).toHaveBeenCalledWith(expect.objectContaining({user:{id:'other'},refresh_token:'new-refresh'}));
});
