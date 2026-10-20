vi.mock("@/components/profile/ProfileHeader", async importOriginal => ({...await importOriginal<typeof import("@/components/profile/ProfileHeader")>(), FollowButton:(props:any)=>{follow(props);return <button>フォロー</button>;}}));
import {MemoryRouter} from 'react-router-dom';
import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const follow=vi.hoisted(()=>vi.fn());

vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'viewer'}));
import { UserCard } from "@/components/search/SearchExploreContent";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('retains the twitter follow button metadata and provider badge in user search results',()=>{
 const user={id:'x-user:123',username:'google@twitter.com',displayName:'Google',avatarUrl:'',providerVerification:{provider:'twitter',type:'organization'}} as any;
 render(<MemoryRouter><UserCard user={user}/></MemoryRouter>);
 expect(follow).toHaveBeenCalledWith(expect.objectContaining({externalProfile:user}));
 expect(screen.getByAltText('twitter認証済み')).toBeInTheDocument();
});

it('uses the flat account result layout with full-row bio, follow action and both badges',()=>{
 const user:any={id:'x-user:456',username:'artist@twitter.com',displayName:'Artist',bio:'イラスト https://shop.example/art',isPrivate:true,isOfficial:true,providerVerification:{provider:'twitter',type:'individual'}};
 const view=render(<MemoryRouter><UserCard user={user} result/></MemoryRouter>);
 expect(view.container.querySelector('[data-lime-search-account]')).not.toBeNull();
 expect(screen.getByRole('link',{name:'shop.example/art'})).toHaveAttribute('href','https://shop.example/art');
 expect(screen.getByAltText('twitter認証済み')).toBeInTheDocument();expect(screen.getByAltText('認証済み')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'フォロー'})).toBeInTheDocument();
});
