import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {User} from '@/types';
vi.mock('@/components/ui/avatar',()=>({ProviderVerificationBadge:()=>null}));
vi.mock('@/lib/utils',()=>({displayUsername:(value:string)=>value}));
import {MobileSearchRecents} from './MobileSearchRecents';
afterEach(cleanup);
it('distinguishes opening a recent account, repeating a search, filling the input, and clearing history',()=>{
 const onClear=vi.fn(),onAccount=vi.fn(),onSearch=vi.fn(),onFill=vi.fn();
 const account={id:'artist',username:'artist@misskey.io',displayName:'絵描き'} as User;
 render(<MobileSearchRecents accounts={[account]} history={['猫の写真']} {...{onClear,onAccount,onSearch,onFill}}/>);
 fireEvent.click(screen.getByText('絵描き'));expect(onAccount).toHaveBeenCalledWith(account);
 fireEvent.click(screen.getByLabelText('猫の写真を検索欄に入力'));expect(onFill).toHaveBeenCalledWith('猫の写真');expect(onSearch).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('猫の写真'));expect(onSearch).toHaveBeenCalledWith('猫の写真');
 fireEvent.click(screen.getByLabelText('最近の検索をすべて消去'));expect(onClear).toHaveBeenCalledOnce();
});
it('does not invent recent accounts or searches when history is empty',()=>{
 render(<MobileSearchRecents accounts={[]} history={[]} onClear={vi.fn()} onAccount={vi.fn()} onSearch={vi.fn()} onFill={vi.fn()}/>);
 expect(screen.queryByRole('region',{name:'最近の検索'})).toBeNull();
 expect(screen.queryByText('最近')).toBeNull();
 expect(screen.queryByRole('button')).toBeNull();
});
