import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({submit:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({AuthProvider:()=>null,useAuth:()=>({user:{id:'viewer',username:'viewer',displayName:'Viewer'}})}));
vi.mock('@/hooks/useFeed',()=>({useCreatePost:()=>({mutateAsync:mocks.submit,isPending:false})}));
vi.mock('@/pages/Feed',()=>({default:()=>null}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:()=>null}));
import {PostComposer} from './PostComposer';
import {PostComposer as OverlayComposer} from '@/App';
beforeEach(()=>{vi.clearAllMocks();mocks.submit.mockResolvedValue({});});afterEach(cleanup);
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
  fireEvent.change(view.container.querySelector('input[type="file"][accept="image/*"]')!,{target:{files:[new File(['image'],'photo.png',{type:'image/png'})]}});
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
