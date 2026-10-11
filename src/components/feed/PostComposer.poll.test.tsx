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
