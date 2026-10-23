import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {makeDraftStore} from '@/test/draftStore';
import {flushPostDrafts} from '@/lib/postDrafts';
const f=vi.hoisted(()=>({owner:'viewer',submit:vi.fn()}));
vi.mock('@/hooks/useAuth',async original=>({...await original<typeof import('@/hooks/useAuth')>(),useAuth:()=>({user:{id:f.owner,username:'viewer',displayName:'Viewer'}})}));
vi.mock('@/hooks/useFeed',async original=>({...await original<typeof import('@/hooks/useFeed')>(),useCreatePost:()=>({mutateAsync:f.submit,isPending:false}),useCreateComment:()=>({mutateAsync:f.submit,isPending:false})}));
vi.mock('@/api/communities',async original=>({...await original<typeof import('@/api/communities')>(),getMyCommunities:async()=>({communities:[],memberships:[]})}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:()=>null}));
vi.mock('@/pages/Feed',()=>({default:()=>null}));
import {PostComposer} from './PostComposer';
import {CommentForm} from '@/components/post/CommentForm';
import {PostComposer as OverlayComposer} from './OverlayPostComposer';
const store=makeDraftStore();let counter=0;
beforeEach(()=>{localStorage.clear();store.data.clear();store.control.delay=0;store.control.failWrites=false;f.owner='viewer';f.submit.mockReset().mockResolvedValue({});vi.stubGlobal('indexedDB',store.factory);vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});URL.createObjectURL=vi.fn(()=>`blob:draft-${++counter}`);URL.revokeObjectURL=vi.fn();});
afterEach(async()=>{cleanup();await flushPostDrafts();vi.unstubAllGlobals();vi.restoreAllMocks();});
function mount(mode:string){
 const Composer=mode==='inline'?PostComposer:OverlayComposer;
 const element=()=> <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Composer onSuccess={()=>{}} {...(mode==='fullscreen'?{fullScreen:true}:{})}/></MemoryRouter></QueryClientProvider>;
 return {...render(element()),element};
}
const ready=()=>waitFor(()=>expect(screen.getByRole('button',{name:'画像を追加'})).toBeEnabled());
const text=()=>screen.getByLabelText('ポスト本文');
function attach(container:HTMLElement){fireEvent.change(container.querySelector('input[type=file][multiple]')!,{target:{files:[new File(['photo bytes'],'photo.png',{type:'image/png'})]}});}
const images=(container:HTMLElement)=>container.querySelectorAll('img[src^="blob:"]');
it.each(['inline','overlay','fullscreen'])('restores text and image bytes after closing the editor (%s)',async mode=>{
 const first=mount(mode);await ready();fireEvent.change(text(),{target:{value:'消さない下書き'}});attach(first.container);
 await waitFor(()=>expect(images(first.container)).toHaveLength(1));const previous=images(first.container)[0].getAttribute('src');
 first.unmount();await flushPostDrafts();expect(URL.revokeObjectURL).toHaveBeenCalledWith(previous);
 const second=mount(mode);await ready();expect(text()).toHaveValue('消さない下書き');expect(images(second.container)).toHaveLength(1);expect(images(second.container)[0].getAttribute('src')).not.toBe(previous);
});
it.each(['inline','overlay','fullscreen'])('keeps failed submissions, and deletes a draft only after success (%s)',async mode=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});f.submit.mockRejectedValueOnce(new Error('offline'));
 let view=mount(mode);await ready();fireEvent.change(text(),{target:{value:'失敗しても保持'}});attach(view.container);
 fireEvent.click(screen.getByRole('button',{name:mode==='fullscreen'?'ポストする':'ポスト'}));await waitFor(()=>expect(f.submit).toHaveBeenCalledOnce());expect(text()).toHaveValue('失敗しても保持');
 view.unmount();await flushPostDrafts();view=mount(mode);await ready();expect(text()).toHaveValue('失敗しても保持');expect(images(view.container)).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:mode==='fullscreen'?'ポストする':'ポスト'}));await waitFor(()=>expect(text()).toHaveValue(''));expect(images(view.container)).toHaveLength(0);
 view.unmount();await flushPostDrafts();view=mount(mode);await ready();expect(text()).toHaveValue('');expect(images(view.container)).toHaveLength(0);
});
it.each(['inline','overlay','fullscreen'])('preserves edits made while submission is in flight (%s)',async mode=>{
 let resolve!:(value:unknown)=>void;f.submit.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
 const view=mount(mode);await ready();fireEvent.change(text(),{target:{value:'送信した本文'}});
 fireEvent.click(screen.getByRole('button',{name:mode==='fullscreen'?'ポストする':'ポスト'}));await waitFor(()=>expect(f.submit).toHaveBeenCalledOnce());
 fireEvent.change(text(),{target:{value:'送信中に書いた新しい本文'}});await act(async()=>{resolve({});});
 expect(text()).toHaveValue('送信中に書いた新しい本文');view.unmount();await flushPostDrafts();mount(mode);await ready();expect(text()).toHaveValue('送信中に書いた新しい本文');
});
it('clears visible input on account switch and restores only that account’s draft',async()=>{
 const view=mount('inline');await ready();fireEvent.change(text(),{target:{value:'本人だけの下書き'}});attach(view.container);await act(async()=>{await flushPostDrafts();});
 f.owner='other';view.rerender(view.element());await ready();expect(text()).toHaveValue('');expect(images(view.container)).toHaveLength(0);
 fireEvent.change(text(),{target:{value:'別アカウントの下書き'}});await act(async()=>{await flushPostDrafts();});
 f.owner='viewer';view.rerender(view.element());await ready();expect(text()).toHaveValue('本人だけの下書き');expect(images(view.container)).toHaveLength(1);
});
it('does not replace typing with a late asynchronous restore',async()=>{
 let view=mount('inline');await ready();fireEvent.change(text(),{target:{value:'前の本文'}});attach(view.container);view.unmount();await flushPostDrafts();
 store.control.delay=40;view=mount('inline');fireEvent.change(await screen.findByLabelText('ポスト本文'),{target:{value:'復元待ちの間に入力した本文'}});
 await ready();expect(text()).toHaveValue('復元待ちの間に入力した本文');expect(images(view.container)).toHaveLength(1);
});

it('preserves a committed draft when the editor closes again before hydration completes',async()=>{
 let view=mount('inline');await ready();fireEvent.change(text(),{target:{value:'元の本文'}});attach(view.container);view.unmount();await flushPostDrafts();
 store.control.delay=40;view=mount('inline');view.unmount();await act(async()=>{await new Promise(done=>setTimeout(done,60));});
 store.control.delay=0;view=mount('inline');await ready();expect(text()).toHaveValue('元の本文');expect(images(view.container)).toHaveLength(1);
});
it('saves an intentional text deletion before image hydration finishes',async()=>{
 let view=mount('inline');await ready();fireEvent.change(text(),{target:{value:'削除する本文'}});attach(view.container);view.unmount();await flushPostDrafts();
 store.control.delay=40;view=mount('inline');fireEvent.change(await screen.findByLabelText('ポスト本文'),{target:{value:''}});view.unmount();await act(async()=>{await new Promise(done=>setTimeout(done,60));});
 store.control.delay=0;view=mount('inline');await ready();expect(text()).toHaveValue('');expect(images(view.container)).toHaveLength(1);
});

const replyElement=(variant:'default'|'mobileDock'|'bottomNav'|'desktopReply'|'mediaViewer'|'mediaViewerMobile',parent='one')=><QueryClientProvider client={new QueryClient()}><MemoryRouter><CommentForm postId="post" parentCommentId={parent} variant={variant}/></MemoryRouter></QueryClientProvider>;
const replyReady=async()=>{const launcher=screen.queryByRole('button',{name:'返信を入力'});if(launcher)fireEvent.click(launcher);fireEvent.focus(screen.getByPlaceholderText('返信をポスト'));await waitFor(()=>expect(screen.getByRole('button',{name:'返信に画像を添付'})).toBeEnabled());};
it.each(['default','mobileDock','bottomNav','desktopReply','mediaViewer','mediaViewerMobile'] as const)('preserves reply text and images across close/reopen (%s)',async variant=>{
 let view=render(replyElement(variant));await replyReady();fireEvent.change(screen.getByPlaceholderText('返信をポスト'),{target:{value:'返信の下書き'}});attach(document.body);await waitFor(()=>expect(images(document.body)).toHaveLength(1));
 view.unmount();await flushPostDrafts();view=render(replyElement(variant));await replyReady();expect(screen.getByPlaceholderText('返信をポスト')).toHaveValue('返信の下書き');expect(images(document.body)).toHaveLength(1);
 fireEvent.click(screen.getAllByRole('button',{name:'コメントを送信'})[0]);if(variant==='mediaViewerMobile'){await waitFor(()=>expect(screen.getByRole('button',{name:'返信を入力'})).toBeInTheDocument());await replyReady();}await waitFor(()=>expect(screen.getByPlaceholderText('返信をポスト')).toHaveValue(''));expect(images(document.body)).toHaveLength(0);
 view.unmount();await flushPostDrafts();view=render(replyElement(variant));await replyReady();expect(screen.getByPlaceholderText('返信をポスト')).toHaveValue('');
});
it('restores the original reply draft when returning from another reply target',async()=>{
 const view=render(replyElement('default'));await replyReady();fireEvent.change(screen.getByPlaceholderText('返信をポスト'),{target:{value:'元の返信先の本文'}});attach(document.body);await act(async()=>{await flushPostDrafts();});
 view.rerender(replyElement('default','two'));await replyReady();expect(screen.getByPlaceholderText('返信をポスト')).toHaveValue('');expect(images(document.body)).toHaveLength(0);
 fireEvent.change(screen.getByPlaceholderText('返信をポスト'),{target:{value:'別の返信先の本文'}});await act(async()=>{await flushPostDrafts();});
 view.rerender(replyElement('default'));await replyReady();expect(screen.getByPlaceholderText('返信をポスト')).toHaveValue('元の返信先の本文');expect(images(document.body)).toHaveLength(1);
});

it('commits pending image bytes before an automatic PWA reload',async()=>{
 const {preparePwaReload}=await import('@/lib/pwaReload');
 const view=mount('fullscreen');await ready();store.control.delay=40;
 fireEvent.change(text(),{target:{value:'更新しても残す本文'}});attach(view.container);
 await act(async()=>{await preparePwaReload();});
 view.unmount();await flushPostDrafts();store.control.delay=0;
 const restored=mount('fullscreen');await ready();expect(text()).toHaveValue('更新しても残す本文');expect(images(restored.container)).toHaveLength(1);
});
it('postpones an automatic update when an attachment cannot be persisted, and retries after recovery',async()=>{
 const {preparePwaReload}=await import('@/lib/pwaReload');
 const view=mount('fullscreen');await ready();store.control.failWrites=true;
 fireEvent.change(text(),{target:{value:'保存失敗でも消さない'}});attach(view.container);
 await act(async()=>{await expect(preparePwaReload()).rejects.toThrow('Draft is not committed');});
 expect(text()).toHaveValue('保存失敗でも消さない');expect(images(view.container)).toHaveLength(1);
 store.control.failWrites=false;await act(async()=>{await preparePwaReload();});
 view.unmount();await flushPostDrafts();const restored=mount('fullscreen');await ready();expect(text()).toHaveValue('保存失敗でも消さない');expect(images(restored.container)).toHaveLength(1);
});
