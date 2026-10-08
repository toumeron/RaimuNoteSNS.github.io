import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({handles:[] as string[],save:vi.fn(),fail:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'lime-owner'}})}));
vi.mock('@/hooks/useBlueskySession',()=>({useBlueskySession:()=>null}));
vi.mock('@/hooks/useProfile',()=>({useFollowStats:()=>({data:{followedByMe:false}}),useToggleFollow:()=>({mutate:vi.fn(),isPending:false})}));
vi.mock('@/lib/bluesky',()=>({isBlueskyProfileId:(id:string)=>id.startsWith('did:')||id.startsWith('misskey-user:')}));
vi.mock('@/lib/externalAccounts',()=>({setExternalAccountOwner:()=>{},initialiseExternalAccounts:async()=>{},cloudExternalHandles:()=>state.handles,setExternalAccountAdded:async(...args:any[])=>{state.save(...args);if(state.fail)throw new Error('offline');state.handles=args[2]?[args[1]]:[];window.dispatchEvent(new Event('lime-bluesky-handles-changed'));}}));
import {FollowButton} from './FollowButton';
beforeEach(()=>{state.handles=[];state.save.mockClear();state.fail=false;});
afterEach(cleanup);
function show(id:string,username:string){return render(<QueryClientProvider client={new QueryClient()}><FollowButton userId={id} externalProfile={{id,username,displayName:'作者',avatarUrl:''} as any}/></QueryClientProvider>);}
it.each([['did:plc:artist','artist.bsky.social','bluesky'],['misskey-user:artist','artist@misskey.io','misskey']])('follows %s in Lime without provider login and can unfollow',async(id,username,provider)=>{
 show(id,username);fireEvent.click(screen.getByRole('button',{name:'フォロー'}));
 await waitFor(()=>expect(state.save).toHaveBeenCalledWith(provider,username,true,expect.objectContaining({id,username})));
 await waitFor(()=>expect(screen.getByRole('button',{name:/^フォロー中/})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:/^フォロー中/}));await waitFor(()=>expect(state.save).toHaveBeenLastCalledWith(provider,username,false,expect.anything()));
 await waitFor(()=>expect(screen.getByRole('button',{name:'フォロー'})).not.toBeDisabled());
});
it('does not show a failed cloud save as followed',async()=>{
 state.fail=true;show('did:plc:artist','artist.bsky.social');fireEvent.click(screen.getByRole('button',{name:'フォロー'}));
 await waitFor(()=>expect(state.save).toHaveBeenCalled());await waitFor(()=>expect(screen.getByRole('button',{name:'フォロー'})).not.toBeDisabled());expect(state.handles).toEqual([]);
});
