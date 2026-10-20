vi.mock("@/api/users", async importOriginal => {
 const actual = await importOriginal<typeof import("@/api/users")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/api/users")>(), getLiveSpaces:api.live, getSpaceState:api.state, getSpaceToken:vi.fn(), spaceRpc:vi.fn()}))(importOriginal)};
});
vi.mock("@/components/spaces/SpaceProvider", async importOriginal => ({...await importOriginal<typeof import("@/components/spaces/SpaceProvider")>(), SpaceRoom:()=> <Title>スペース</Title>, SpaceEndConfirmation:()=>null, SpacePolicySelect:()=>null}));


vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:{id:'viewer'}})}));

import {useContext} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider,focusManager} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Title} from '@radix-ui/react-dialog';
const api=vi.hoisted(()=>({live:vi.fn(),state:vi.fn()}));



import {SpaceProvider} from './SpaceProvider';
import {SpaceContext} from "@/components/spaces/SpaceProvider";
function Open(){const context=useContext(SpaceContext);return <button onClick={()=>context!.open('demo')}>開く</button>;}
let client:QueryClient;
beforeEach(()=>{vi.useFakeTimers();focusManager.setFocused(true);api.live.mockReset().mockResolvedValue([]);api.state.mockReset().mockResolvedValue({space:{id:'demo',host_id:'host',profiles:{}},members:[],reactions:[],anonymous_count:0});client=new QueryClient({defaultOptions:{queries:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();focusManager.setFocused(undefined);vi.useRealTimers();});
async function mount(){render(<QueryClientProvider client={client}><SpaceProvider><Open/></SpaceProvider></QueryClientProvider>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});}
it('loads spaces initially, avoids the old 15-second refresh and refreshes at 30 seconds',async()=>{
 await mount();expect(api.live).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(api.live).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(api.live).toHaveBeenCalledTimes(2);
});
it('does not keep polling the open room while the app is in the background',async()=>{
 await mount();fireEvent.click(screen.getByRole('button',{name:'開く'}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(api.state).toHaveBeenCalledTimes(1);
 focusManager.setFocused(false);
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(api.state).toHaveBeenCalledTimes(1);
});
