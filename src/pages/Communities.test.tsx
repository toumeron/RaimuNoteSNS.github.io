import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const f=vi.hoisted(()=>({id:'11111111-1111-4111-8111-111111111111',my:vi.fn(),detail:vi.fn(),find:vi.fn(),members:vi.fn(),action:vi.fn(),save:vi.fn(),upload:vi.fn(),posts:vi.fn(),createPost:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'viewer'}})}));
vi.mock('@/components/feed/PostCard',()=>({PostCard:({post}:{post:{content:string}})=><article>{post.content}</article>}));
vi.mock('@/components/feed/PostComposer',()=>({PostComposer:({imageEditor,communityId}:{communityId?:string;imageEditor?:{src:string;onApply:(url:string)=>void;onClose:()=>void}})=>!imageEditor?<div data-testid="shared-post-composer" data-community-id={communityId}/>:<div role="dialog" aria-label="メディアをトリミング"><button onClick={()=>{imageEditor.onApply('blob:cropped');imageEditor.onClose();}}>切り抜きを保存</button><button onClick={imageEditor.onClose}>編集を閉じる</button></div>}));
vi.mock('@/components/profile/ProfileHeader',()=>({FollowButton:()=> <button>フォロー</button>}));
vi.mock('@/api/posts',()=>({getCommunityPosts:f.posts,createPost:f.createPost}));
vi.mock('@/api/communities',()=>({communityKeys:{all:['communities'],detail:(id:string)=>['communities','detail',id],mine:(uid:string)=>['communities','mine',uid]},getMyCommunities:f.my,getCommunity:f.detail,findCommunities:f.find,getCommunityMembers:f.members,communityAction:f.action,saveCommunity:f.save,uploadCommunityImage:f.upload,deleteCommunity:vi.fn(),removeCommunityPost:vi.fn(),getCommunitySpotlight:vi.fn()}));
import Communities,{CommunityHeaderActions} from './Communities';
const community=()=>({id:f.id,name:'写真を共有する会',owner_id:'owner',description:'旅行の写真を共有しよう',cover_url:'https://res.cloudinary.com/demo/image/upload/cover.jpg',join_mode:'approval',member_count:3,created_at:'2026-10-23T00:00:00Z'});
function show(path:string){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter initialEntries={[path]}><CommunityHeaderActions/><Routes><Route path="/communities" element={<Communities/>}/><Route path="/communities/:communityId" element={<Communities/>}/><Route path="/communities/:communityId/members" element={<Communities/>}/></Routes></MemoryRouter></QueryClientProvider>)}
beforeEach(()=>{vi.clearAllMocks();f.my.mockResolvedValue({memberships:[],communities:[]});f.detail.mockResolvedValue(community());f.find.mockResolvedValue([]);f.members.mockResolvedValue([]);f.posts.mockResolvedValue([]);f.save.mockResolvedValue(community());f.action.mockResolvedValue(undefined);vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});URL.createObjectURL=vi.fn(()=>'blob:preview');URL.revokeObjectURL=vi.fn();});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('shows empty cloud data without invented communities or posts',async()=>{show('/communities');expect(await screen.findByText('参加中のコミュニティはありません。')).toBeInTheDocument();fireEvent.click(screen.getByRole('tab',{name:'話題を検索'}));expect(await screen.findByText('コミュニティが見つかりません。')).toBeInTheDocument();expect(f.find).toHaveBeenCalled();});
it('requests membership before allowing a nonmember to compose posts',async()=>{show(`/communities/${f.id}`);expect(await screen.findByText('旅行の写真を共有しよう')).toBeInTheDocument();expect(screen.queryByTestId('shared-post-composer')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'参加を申請'}));await waitFor(()=>expect(f.action).toHaveBeenCalledWith(f.id,'join'));});
it('uses the shared composer for active members with the community destination',async()=>{
 f.my.mockResolvedValue({memberships:[{community_id:f.id,user_id:'viewer',role:'member',status:'active'}],communities:[community()]});
 const view=show(`/communities/${f.id}?tab=latest`);expect(await screen.findByTestId('shared-post-composer')).toHaveAttribute('data-community-id',f.id);expect(view.container.querySelector('.community-compose')).toBeNull();
});
it('loads the member and moderator views independently',async()=>{
 f.members.mockResolvedValue([{user:{id:'member',username:'photographer',displayName:'写真好き',avatarUrl:''},role:'moderator',status:'active'}]);show(`/communities/${f.id}/members`);
 expect(await screen.findByText('写真好き')).toBeInTheDocument();expect(screen.getByRole('tablist').parentElement).not.toHaveAttribute('data-lime-profile-tabs-header');expect(screen.getByRole('tablist').parentElement).toHaveClass('relative');fireEvent.click(screen.getByRole('tab',{name:'モデレーター'}));await waitFor(()=>expect(f.members).toHaveBeenCalledWith(f.id,0,'moderators','',expect.any(AbortSignal)));
});


it('places creation beside search and keeps Home as a plain tab',async()=>{
 show('/communities');const search=await screen.findByRole('button',{name:'コミュニティを検索'}),create=screen.getByRole('button',{name:'コミュニティを作成'});expect(search.nextElementSibling).toBe(create);expect(screen.getByRole('tab',{name:'ホーム'})).not.toHaveAttribute('aria-haspopup');fireEvent.click(create);expect(await screen.findByRole('dialog',{name:'コミュニティを作成'})).toBeInTheDocument();
});

it('shows a single empty state without category buttons or an unrelated empty post feed',async()=>{
 show('/communities?tab=discover');expect(await screen.findByText('コミュニティが見つかりません。')).toBeInTheDocument();expect(screen.queryByText(/まだポスト/)).toBeNull();expect(screen.queryByRole('combobox',{name:'カテゴリー'})).toBeNull();expect(f.posts).not.toHaveBeenCalled();
});
it('replaces the header title with one search field and closes it using back',async()=>{
 show('/communities');fireEvent.click(await screen.findByRole('button',{name:'コミュニティを検索'}));
 const search=screen.getByRole('searchbox',{name:'コミュニティを検索'});expect(screen.getAllByRole('searchbox')).toHaveLength(1);expect(screen.queryByRole('button',{name:'検索を実行'})).toBeNull();expect(screen.queryByRole('button',{name:'コミュニティを検索'})).toBeNull();
 fireEvent.change(search,{target:{value:'写真'}});fireEvent.submit(screen.getByRole('search'));expect(screen.getByRole('tab',{name:'ホーム'})).toHaveAttribute('aria-selected','true');fireEvent.click(screen.getByRole('tab',{name:'話題を検索'}));await waitFor(()=>expect(f.find).toHaveBeenCalledWith('写真',0,expect.any(AbortSignal)));
 fireEvent.click(screen.getByRole('button',{name:'コミュニティの検索を閉じる'}));expect(screen.queryByRole('searchbox')).toBeNull();expect(screen.getByRole('heading',{name:'コミュニティ'})).toBeInTheDocument();
});
it('omits category filters and rules from discovery, details and the editor',async()=>{
 f.find.mockResolvedValue([community()]);const view=show('/communities?tab=discover');expect(await screen.findByRole('link',{name:'写真を共有する会'})).toBeInTheDocument();expect(screen.queryByRole('combobox',{name:'カテゴリー'})).toBeNull();view.unmount();
 show('/communities?create=1');expect(await screen.findByLabelText('名前')).toBeInTheDocument();expect(screen.queryByLabelText('カテゴリー')).toBeNull();expect(screen.queryByLabelText(/ルール/)).toBeNull();
});
it('moves secondary community actions into the existing more menu',async()=>{
 f.my.mockResolvedValue({memberships:[{community_id:f.id,user_id:'viewer',role:'member',status:'active',notifications:false,pinned:false,spotlight:false}],communities:[community()]});show(`/communities/${f.id}`);await screen.findByRole('button',{name:'参加済み'});
 expect(screen.queryByRole('button',{name:'コミュニティの通知'})).toBeNull();expect(screen.queryByRole('button',{name:'コミュニティの表示設定'})).toBeNull();expect(screen.queryByRole('menuitem',{name:'通知をオン'})).toBeNull();
 fireEvent.keyDown(screen.getByRole('button',{name:'コミュニティのその他のメニュー'}),{key:'ArrowDown'});expect(await screen.findByRole('menuitem',{name:'ホームに固定'})).toBeInTheDocument();expect(screen.queryByRole('menuitem',{name:/通知/})).toBeNull();expect(screen.getByRole('menu')).toHaveClass('z-[600]');fireEvent.click(screen.getByRole('menuitem',{name:'ホームに固定'}));await waitFor(()=>expect(f.action).toHaveBeenCalledWith(f.id,'pin',undefined,true));
});

it('keeps the editor above the shared header and puts scrollable fields between fixed heading and save controls',async()=>{
 show('/communities?create=1');const dialog=await screen.findByRole('dialog',{name:'コミュニティを作成'});expect(dialog).toHaveClass('z-[701]');expect(dialog.querySelector('.community-editor-heading')).toBeInTheDocument();expect(dialog.querySelector('.community-editor-body')).toContainElement(screen.getByLabelText('名前'));expect(dialog.querySelector('.community-editor-body')).not.toContainElement(screen.getByRole('button',{name:'作成'}));expect(dialog.querySelector('.community-editor-footer')).toContainElement(screen.getByRole('button',{name:'作成'}));expect(screen.getByLabelText('カバー画像')).toHaveAttribute('title','カバー画像を選択');
});

it('crops a cover with the existing composer editor before uploading, and preserves the form',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob(['cropped'],{type:'image/jpeg'})})));f.upload.mockResolvedValue('https://res.cloudinary.com/demo/image/upload/cropped.jpg');
 show('/communities?create=1');fireEvent.change(await screen.findByLabelText('名前'),{target:{value:'切り抜きのテスト'}});
 fireEvent.change(screen.getByLabelText('カバー画像'),{target:{files:[new File(['original'],'cover.png',{type:'image/png'})]}});
 expect(await screen.findByRole('dialog',{name:'メディアをトリミング'})).toBeInTheDocument();expect(screen.queryByRole('dialog',{name:'コミュニティを作成'})).toBeNull();expect(f.upload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'切り抜きを保存'}));await waitFor(()=>expect(screen.getByRole('button',{name:'作成'})).toBeEnabled());expect(screen.getByLabelText('名前')).toHaveValue('切り抜きのテスト');
 fireEvent.click(screen.getByRole('button',{name:'作成'}));await waitFor(()=>expect(f.upload).toHaveBeenCalledWith(expect.any(File),'viewer','community-cover'));const savedFile=f.upload.mock.calls[0][0];expect(savedFile.type).toBe('image/jpeg');expect(savedFile.size).toBe(7);expect(f.save).toHaveBeenCalledWith(expect.objectContaining({cover_url:'https://res.cloudinary.com/demo/image/upload/cropped.jpg'}),undefined);
});
it('leaves the previous cover unchanged when cropping is cancelled',async()=>{
 show('/communities?create=1');fireEvent.change(await screen.findByLabelText('名前'),{target:{value:'変更しない'}});fireEvent.change(screen.getByLabelText('カバー画像'),{target:{files:[new File(['image'],'cover.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'編集を閉じる'}));expect(await screen.findByLabelText('名前')).toHaveValue('変更しない');expect(screen.queryByAltText('カバー画像のプレビュー')).toBeNull();expect(f.upload).not.toHaveBeenCalled();
});

it('keeps the current tab while opening live search and omits basic info and invite actions',async()=>{
 const view=show('/communities');fireEvent.click(await screen.findByRole('button',{name:'コミュニティを検索'}));expect(screen.getByRole('tab',{name:'ホーム'})).toHaveAttribute('aria-selected','true');expect(f.find).not.toHaveBeenCalled();view.unmount();
 f.my.mockResolvedValue({memberships:[{community_id:f.id,user_id:'viewer',role:'owner',status:'active'}],communities:[community()]});show(`/communities/${f.id}/members`);expect(await screen.findByRole('tab',{name:'モデレーター'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'メンバーを招待'})).toBeNull();
});
it('uses the existing sliding tab indicator and supports keyboard selection without a dropdown',async()=>{
 show(`/communities/${f.id}`);expect(await screen.findByRole('tab',{name:'話題のポスト'})).toBeInTheDocument();expect(screen.queryByRole('tab',{name:'基本情報'})).toBeNull();expect(screen.getByRole('tablist').parentElement).toHaveClass('community-detail-tabs');expect(screen.getByRole('tablist').parentElement).toHaveAttribute('data-lime-profile-tabs-header');const first=screen.getByRole('tab',{name:'話題のポスト'});const indicator=first.parentElement!.querySelector('.profile-tabs-underline');expect(indicator).toBeInTheDocument();expect(first).not.toHaveAttribute('aria-haspopup');fireEvent.keyDown(first,{key:'ArrowRight'});expect(screen.getByRole('tab',{name:'最新'})).toHaveAttribute('aria-selected','true');expect(screen.getByRole('tab',{name:'最新'}).parentElement!.querySelector('.profile-tabs-underline')).toBe(indicator);
});
