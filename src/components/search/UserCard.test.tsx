import {MemoryRouter} from 'react-router-dom';
import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const follow=vi.hoisted(()=>vi.fn());
vi.mock('../profile/FollowButton',()=>({FollowButton:(props:any)=>{follow(props);return <button>フォロー</button>;}}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'viewer'}));
import UserCard from './UserCard';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('retains the twitter follow button metadata and provider badge in user search results',()=>{
 const user={id:'x-user:123',username:'google@twitter.com',displayName:'Google',avatarUrl:'',providerVerification:{provider:'twitter',type:'organization'}} as any;
 render(<MemoryRouter><UserCard user={user}/></MemoryRouter>);
 expect(follow).toHaveBeenCalledWith(expect.objectContaining({externalProfile:user}));
 expect(screen.getByAltText('twitter認証済み')).toBeInTheDocument();
});
