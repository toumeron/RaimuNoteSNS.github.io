vi.mock('@/hooks/usePostDraft',()=>({usePostDraft:()=>({ready:true,readyRef:{current:true},markEdited:()=>{},beginSubmission:()=> 'draft',completeSubmission:async()=>true})}));
vi.mock('@/api/communities',async original=>({...await original<typeof import('@/api/communities')>(),getMyCommunities:()=>Promise.resolve({communities:[{id:'11111111-1111-4111-8111-111111111111',name:'写真の会'},{id:'22222222-2222-4222-8222-222222222222',name:'申請中の会'}],memberships:[{community_id:'11111111-1111-4111-8111-111111111111',status:'active'},{community_id:'22222222-2222-4222-8222-222222222222',status:'pending'}]})}));
vi.mock("@/lib/mediaThumbnail", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/mediaThumbnail")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/lib/mediaThumbnail")>(), preparePostVideo:(...args:unknown[])=>mocks.prepare(...args)}))(importOriginal)};
});
vi.mock("@/hooks/useFeed", async importOriginal => {
 const actual = await importOriginal<typeof import("@/hooks/useFeed")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/hooks/useFeed")>(), useCreatePost:()=>({mutateAsync:mocks.submit,isPending:false})}))(importOriginal)};
});
vi.mock("@/components/layout/AppLayout", async importOriginal => ({...await importOriginal<typeof import("@/components/layout/AppLayout")>(), AppLayout:()=>null}));

vi.mock("@/components/video/PostVideoPlayer", async importOriginal => ({...await importOriginal<typeof import("@/components/video/PostVideoPlayer")>(), PostVideoPlayer:()=> <div aria-label="動画プレビュー"/>}));



vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), AuthProvider:()=>null, useAuth:()=>({user:{id:'viewer',username:'viewer',displayName:'Viewer'}})}));

import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({submit:vi.fn(),prepare:vi.fn(),mobile:false}));
vi.mock('@/hooks/useViewportWidth',async original=>({...await original<typeof import('@/hooks/useViewportWidth')>(),useIsMobile:()=>mocks.mobile}));




vi.mock('@/pages/Feed',()=>({default:()=>null}));

import {PostComposer} from './PostComposer';
import {PostComposer as OverlayComposer} from './OverlayPostComposer';
beforeEach(()=>{vi.clearAllMocks();mocks.mobile=false;mocks.submit.mockResolvedValue({});});afterEach(cleanup);
it('submits a text-only poll through the normal composer and resets it after success',async()=>{
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><PostComposer/></MemoryRouter></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'投票を追加'}));
 fireEvent.change(screen.getByLabelText('投票の質問'),{target:{value:'どちらが良い？'}});expect(screen.getByRole('button',{name:'ポスト'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('回答1'),{target:{value:'猫'}});fireEvent.change(screen.getByLabelText('回答2'),{target:{value:'犬'}});expect(screen.getByRole('button',{name:'ポスト'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'ポスト'}));
 await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({content:'どちらが良い？',poll:{durationMinutes:1440,options:[{label:'猫'},{label:'犬'}]}})));
 await waitFor(()=>expect(screen.queryByRole('region',{name:'投票を作成'})).not.toBeInTheDocument());expect(screen.getByLabelText('ポスト本文')).toHaveValue('');
});
it('removes the poll without clearing the question or posting',()=>{
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><PostComposer/></MemoryRouter></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'投票を追加'}));fireEvent.change(screen.getByLabelText('投票の質問'),{target:{value:'質問'}});fireEvent.click(screen.getByRole('button',{name:'投票を削除する'}));expect(screen.getByLabelText('ポスト本文')).toHaveValue('質問');expect(mocks.submit).not.toHaveBeenCalled();
});

it.each([false,true])('submits a poll through the overlay composer (fullScreen=%s)',async(fullScreen)=>{
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><OverlayComposer fullScreen={fullScreen}/></MemoryRouter></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'投票を追加'}));
 fireEvent.change(screen.getByLabelText('投票の質問'),{target:{value:'質問'}});
 fireEvent.change(screen.getByLabelText('回答1'),{target:{value:'猫'}});fireEvent.change(screen.getByLabelText('回答2'),{target:{value:'犬'}});
 fireEvent.click(screen.getByRole('button',{name:fullScreen?'ポストする':'ポスト'}));
 await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({content:'質問',poll:{durationMinutes:1440,options:[{label:'猫'},{label:'犬'}]}})));
 await waitFor(()=>expect(screen.queryByLabelText('投票を作成')).not.toBeInTheDocument());
});

it.each(['inline','overlay','fullscreen'])('submits an image without requiring body text (%s)',async variant=>{
 const original=URL.createObjectURL;URL.createObjectURL=()=> 'blob:only-image';
 try{
  const view=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{variant==='inline'?<PostComposer/>:<OverlayComposer fullScreen={variant==='fullscreen'}/>}</MemoryRouter></QueryClientProvider>);
  const submit=screen.getByRole('button',{name:variant==='fullscreen'?'ポストする':'ポスト'});expect(submit).toBeDisabled();
  fireEvent.change(view.container.querySelector('input[type="file"][accept^="image/*"]')!,{target:{files:[new File(['image'],'photo.png',{type:'image/png'})]}});
  await waitFor(()=>expect(submit).toBeEnabled());expect(screen.getByLabelText('ポスト本文')).toHaveValue('');fireEvent.click(submit);
  await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({content:'',imageUrls:['blob:only-image']})));
 }finally{URL.createObjectURL=original;}
});

it.each(['inline','overlay','fullscreen'])('saves a scheduled post from the %s composer',async mode=>{
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{mode==='inline'?<PostComposer/>:<OverlayComposer fullScreen={mode==='fullscreen'}/>}</MemoryRouter></QueryClientProvider>);fireEvent.change(screen.getByLabelText('ポスト本文'),{target:{value:'予約する本文'}});
 fireEvent.click(screen.getByRole('button',{name:'予約設定'}));
 expect(screen.getByRole('dialog')).toBeInTheDocument();expect(screen.getByText('日本標準時')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'確認する'}));
 fireEvent.click(screen.getByRole('button',{name:mode==='inline'?'ポスト':'予約する'}));
 await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({content:'予約する本文',scheduledAt:expect.any(String)})));
});

it.each(['inline','overlay','fullscreen'])('submits a video without body text through the image button (%s)',async variant=>{
 const video={file:new File(['encoded'],'video.mp4',{type:'video/mp4'}),url:'blob:prepared-video',duration:8,width:1280,height:720};mocks.prepare.mockResolvedValue(video);
 const view=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{variant==='inline'?<PostComposer/>:<OverlayComposer fullScreen={variant==='fullscreen'}/>}</MemoryRouter></QueryClientProvider>);
 const input=view.container.querySelector('input[type="file"][accept^="image/*"]')!;expect(input.getAttribute('accept')).toContain('video/mp4');
 fireEvent.change(input,{target:{files:[new File(['source'],'clip.mov',{type:'video/quicktime'})]}});
 await waitFor(()=>expect(screen.getByLabelText('動画プレビュー')).toBeInTheDocument());expect(screen.getByRole('button',{name:'投票を追加'})).toBeDisabled();
 const submit=screen.getByRole('button',{name:variant==='fullscreen'?'ポストする':'ポスト'});expect(submit).toBeEnabled();fireEvent.click(submit);
 await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({content:'',imageUrls:[],video})));
 await waitFor(()=>expect(screen.queryByLabelText('動画プレビュー')).not.toBeInTheDocument());
});
it('rejects a mixed image/video selection before conversion',async()=>{
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostComposer/></MemoryRouter></QueryClientProvider>);
 fireEvent.change(view.container.querySelector('input[type="file"][accept^="image/*"]')!,{target:{files:[new File(['v'],'v.mp4',{type:'video/mp4'}),new File(['i'],'i.png',{type:'image/png'})]}});
 expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
});
it.each(['inline','overlay','fullscreen'])('accepts a dropped video with missing MIME type through the same conversion (%s)',async variant=>{
 const file=new File(['source'],'clip.MOV'),video={file:new File(['encoded'],'video.mp4',{type:'video/mp4'}),url:'blob:dropped-video',duration:16,width:1280,height:720};mocks.prepare.mockResolvedValue(video);
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{variant==='inline'?<PostComposer/>:<OverlayComposer fullScreen={variant==='fullscreen'}/>}</MemoryRouter></QueryClientProvider>);
 const zone=view.container.querySelector('[data-lime-media-dropzone]')!;expect(zone).toContainElement(screen.getByLabelText('ポスト本文'));
 const transfer={files:[file],types:['Files'],items:[{kind:'file'}],dropEffect:'none'};
 expect(fireEvent.dragOver(zone,{dataTransfer:transfer})).toBe(false);expect(transfer.dropEffect).toBe('copy');
 expect(fireEvent.drop(screen.getByLabelText('ポスト本文'),{dataTransfer:transfer})).toBe(false);
 await waitFor(()=>expect(screen.getByLabelText('動画プレビュー')).toBeInTheDocument());expect(mocks.prepare).toHaveBeenCalledWith(file,expect.any(Function),expect.any(AbortSignal));
 fireEvent.click(screen.getByRole('button',{name:variant==='fullscreen'?'ポストする':'ポスト'}));await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({video,content:''})));
});
it('prevents another dropped file while conversion is in progress',async()=>{
 let finish!:(value:unknown)=>void;mocks.prepare.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostComposer/></MemoryRouter></QueryClientProvider>);
 const drop=()=>fireEvent.drop(view.container.querySelector('[data-lime-media-dropzone]')!,{dataTransfer:{files:[new File(['v'],'clip.mp4',{type:'video/mp4'})],types:['Files']}});
 drop();await waitFor(()=>expect(screen.getByRole('status')).toBeInTheDocument());drop();expect(mocks.prepare).toHaveBeenCalledTimes(1);
 finish({file:new File(['v'],'compressed.mp4'),url:'blob:pending',duration:16,width:1280,height:720});await waitFor(()=>expect(screen.getByLabelText('動画プレビュー')).toBeInTheDocument());
});

it.each(['image','poll','scheduled'])('keeps shared %s posting features when targeting a community',async feature=>{
 const communityId='11111111-1111-4111-8111-111111111111';URL.createObjectURL=()=> 'blob:community-image';URL.revokeObjectURL=vi.fn();
 const view=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/communities/'+communityId+'?tab=latest']}><PostComposer communityId={communityId} homeInline/></MemoryRouter></QueryClientProvider>);
 expect(view.container.querySelector('[data-lime-community-composer]')).toBeInTheDocument();expect(screen.getByRole('button',{name:'公開範囲を選択'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'予約設定'})).toBeInTheDocument();
 if(feature==='image'){
  fireEvent.change(view.container.querySelector('input[type="file"][accept^="image/*"]')!,{target:{files:[new File(['photo'],'photo.png',{type:'image/png'})]}});expect(await screen.findByRole('button',{name:'編集'})).toBeInTheDocument();
 }else if(feature==='poll'){
  fireEvent.click(screen.getByRole('button',{name:'投票を追加'}));fireEvent.change(screen.getByLabelText('投票の質問'),{target:{value:'質問'}});fireEvent.change(screen.getByLabelText('回答1'),{target:{value:'猫'}});fireEvent.change(screen.getByLabelText('回答2'),{target:{value:'犬'}});
 }else{
  fireEvent.change(screen.getByLabelText('ポスト本文'),{target:{value:'予約する本文'}});fireEvent.click(screen.getByRole('button',{name:'予約設定'}));fireEvent.click(screen.getByRole('button',{name:'確認する'}));
 }
 fireEvent.click(screen.getByRole('button',{name:'ポスト'}));await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({communityId,visibility:'public',...(feature==='image'?{imageUrls:['blob:community-image']}:feature==='poll'?{poll:expect.any(Object)}:{scheduledAt:expect.any(String)})})));
});


it.each(['inline','overlay','fullscreen'])('offers joined communities and submits to the selected destination (%s)',async(mode)=>{
 const Composer=mode==='inline'?PostComposer:OverlayComposer;
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Composer {...(mode==='fullscreen'?{fullScreen:true}:{})}/></MemoryRouter></QueryClientProvider>);
 fireEvent.keyDown(screen.getByRole('button',{name:'公開範囲を選択'}),{key:'ArrowDown'});
 const community=await screen.findByRole('menuitem',{name:'写真の会'});expect(screen.queryByRole('menuitem',{name:'申請中の会'})).toBeNull();fireEvent.click(community);
 fireEvent.change(screen.getByLabelText('ポスト本文'),{target:{value:'コミュニティへ投稿'}});
 fireEvent.click(screen.getByRole('button',{name:mode==='fullscreen'?'ポストする':'ポスト'}));
 await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({communityId:'11111111-1111-4111-8111-111111111111',visibility:'public',content:'コミュニティへ投稿'})));
});

it.each(['inline','overlay','fullscreen'])('returns to the public destination after clearing a community (%s)',async(mode)=>{
 const Composer=mode==='inline'?PostComposer:OverlayComposer;
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Composer {...(mode==='fullscreen'?{fullScreen:true}:{})}/></MemoryRouter></QueryClientProvider>);
 fireEvent.keyDown(screen.getByRole('button',{name:'公開範囲を選択'}),{key:'ArrowDown'});fireEvent.click(await screen.findByRole('menuitem',{name:'写真の会'}));
 fireEvent.keyDown(screen.getByRole('button',{name:'公開範囲を選択'}),{key:'ArrowDown'});fireEvent.click(await screen.findByRole('menuitem',{name:'全員'}));
 fireEvent.change(screen.getByLabelText('ポスト本文'),{target:{value:'通常の投稿'}});fireEvent.click(screen.getByRole('button',{name:mode==='fullscreen'?'ポストする':'ポスト'}));
 await waitFor(()=>expect(mocks.submit).toHaveBeenCalled());expect(mocks.submit.mock.calls[0][0]).not.toHaveProperty('communityId');
});

it.each(['inline','overlay','fullscreen'])('keeps a community quote inside its community (%s)',async(mode)=>{
 const Composer=mode==='inline'?PostComposer:OverlayComposer;
 const quoted={id:'quoted',userId:'author',communityId:'11111111-1111-4111-8111-111111111111',content:'引用する本文',imageUrls:[],createdAt:'2026-10-23T00:00:00Z',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id:'author',username:'author',displayName:'Author',avatarUrl:'',bio:'',coverUrl:'',createdAt:'2026-10-23T00:00:00Z'}};
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Composer initialQuotedPost={quoted} {...(mode==='fullscreen'?{fullScreen:true}:{})}/></MemoryRouter></QueryClientProvider>);
 fireEvent.keyDown(screen.getByRole('button',{name:'公開範囲を選択'}),{key:'ArrowDown'});expect(await screen.findByRole('menuitem',{name:'全員'})).toHaveAttribute('aria-disabled','true');expect(screen.getByRole('menuitem',{name:'フォロー中'})).toHaveAttribute('aria-disabled','true');
 fireEvent.click(await screen.findByRole('menuitem',{name:'写真の会'}));
 fireEvent.change(screen.getByLabelText('ポスト本文'),{target:{value:'コメント'}});fireEvent.click(screen.getByRole('button',{name:'引用ポスト'}));
 await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({communityId:quoted.communityId,parentId:'quoted',isQuote:true,visibility:'public'})));
});

it.each([false,true])('limits the independent timeline toolbar row to mobile (mobile=%s)',mobile=>{
 mocks.mobile=mobile;
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostComposer timelineInline homeInline/></MemoryRouter></QueryClientProvider>);
 const root=view.container.querySelector('[data-lime-post-composer]')!;
 const actions=view.container.querySelector('[data-lime-composer-actions]')!;
 expect(actions.parentElement===root).toBe(mobile);
 expect(root).toHaveClass('rounded-3xl','bg-card');
 expect(screen.getByRole('button',{name:'ポスト'}).querySelector('[data-composer-icon]')).toBeNull();
});
it('uses the normal desktop timeline card when a pinned community tab is selected',()=>{
 const view=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PostComposer communityId="11111111-1111-4111-8111-111111111111" timelineInline homeInline/></MemoryRouter></QueryClientProvider>);
 expect(view.container.querySelector('[data-lime-community-composer]')).toBeNull();
 expect(view.container.querySelector('[data-lime-timeline-composer]')).toHaveClass('rounded-3xl','bg-card');
});
