import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen,cleanup,waitFor,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({follow:vi.fn(),list:vi.fn(),metadata:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'viewer'}})}));
vi.mock('@/hooks/use-mobile',()=>({useAutoPagination:()=>()=>{}}));
vi.mock('@/components/layout/Header',()=>({ProfileListHeader:()=>null}));
vi.mock('@/components/profile/FollowButton',()=>({FollowButton:(props:any)=>{state.follow(props);return <button>フォロー</button>;}}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,abortSignal:()=>q,maybeSingle:async()=>({data:{id:'owner',username:'owner',display_name:'Owner'}})};return q;}}}));
vi.mock('@/lib/bluesky',()=>({isBlueskyProfileId:(id:string)=>/^(did:|misskey-user:|x-user:)/.test(id),fetchBlueskyProfile:async()=>null}));
vi.mock('@/api/followLists',()=>({fetchFollowListPage:state.list}));
vi.mock('@/lib/externalProfileMetadata',()=>({externalProfileMetadata:state.metadata}));
import Page from './FollowersFollowingPage';
const user={id:'x-user:123',username:'google@twitter.com',displayName:'Google',avatarUrl:'https://example.test/avatar.png',bio:'',providerVerification:{provider:'twitter',type:'organization'}};
function show(tab:string){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/u/owner/follows?tab='+tab]}><Routes><Route path="/u/:username/follows" element={<Page/>}/></Routes></MemoryRouter></QueryClientProvider>);return {client,...view};}
beforeEach(()=>{vi.clearAllMocks();state.list.mockResolvedValue({users:[user],cursor:null});state.metadata.mockResolvedValue(null);});afterEach(cleanup);
it.each(['following','followers'])('passes twitter metadata to its follow button and displays the LimeNote badge in %s',async tab=>{
 show(tab);expect(await screen.findByRole('button',{name:'フォロー'})).toBeVisible();
 expect(state.follow).toHaveBeenCalledWith(expect.objectContaining({userId:'x-user:123',externalProfile:expect.objectContaining({username:'google@twitter.com'})}));
 expect(screen.getByAltText('twitter認証済み')).toHaveAttribute('src','/RaimuNoteSNS.github.io/verified.png');
});
it('refreshes a legacy twitter snapshot once and does not repeatedly fetch unverified profiles',async()=>{
 state.list.mockResolvedValue({users:[{...user,providerVerification:undefined}],cursor:null});
 state.metadata.mockResolvedValue({...user,providerVerification:undefined});
 const {client}=show('following');await screen.findByRole('button',{name:'フォロー'});
 await waitFor(()=>expect(state.metadata).toHaveBeenCalledTimes(1));
 await act(()=>client.invalidateQueries({queryKey:['follow-list']}));
 expect(state.list).toHaveBeenCalledTimes(2);expect(state.metadata).toHaveBeenCalledTimes(1);
});

it('restores a verification badge missing from an older saved follow snapshot',async()=>{
 state.list.mockResolvedValue({users:[{...user,providerVerification:undefined}],cursor:null});state.metadata.mockResolvedValue(user);
 show('following');expect(await screen.findByAltText('twitter認証済み')).toBeInTheDocument();expect(state.metadata).toHaveBeenCalledTimes(1);
});
