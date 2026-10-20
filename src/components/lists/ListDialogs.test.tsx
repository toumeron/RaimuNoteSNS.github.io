vi.mock("@/api/users", async importOriginal => {
 const actual = await importOriginal<typeof import("@/api/users")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/api/users")>(), saveList:mocks.save, setListMember:mocks.member, searchListUsers:mocks.search, discardListCover:vi.fn()}))(importOriginal)};
});
vi.mock("@/hooks/useTopics", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useTopics")>(), useLists:()=>({data:[list],isLoading:false,isError:false}), useInvalidateLists:()=>mocks.invalidate}));

vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:{id:'owner'}})}));


import {MemoryRouter} from 'react-router-dom';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({save:vi.fn(),member:vi.fn(),search:vi.fn(),invalidate:vi.fn()}));
const list={id:'list',owner_id:'owner',name:'いつもの',description:'',is_private:true,members:[{id:'alice',username:'alice',displayName:'Alice'}],owner:{username:'owner',display_name:'Owner',avatar_url:''}};



import {ListEditor,ListMembers,ProfileListPicker,ListMemberRow} from './ListDialogs';
function mount(ui:React.ReactNode){return render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{ui}</QueryClientProvider></MemoryRouter>);}
beforeEach(()=>{vi.clearAllMocks();mocks.save.mockResolvedValue(list);mocks.member.mockResolvedValue(undefined);mocks.invalidate.mockResolvedValue(undefined);});afterEach(cleanup);
it('creates a text-only private list without requiring an image',async()=>{const saved=vi.fn();mount(<ListEditor onClose={vi.fn()} onSaved={saved}/>);expect(screen.getByRole('button',{name:'作成する'})).toBeDisabled();fireEvent.change(screen.getByLabelText('リストの名前'),{target:{value:'いつもの'}});fireEvent.click(screen.getByLabelText('非公開にする'));fireEvent.click(screen.getByRole('button',{name:'作成する'}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({name:'いつもの',is_private:true,file:undefined})));expect(saved).toHaveBeenCalledWith(list);});
it('saves only membership changes selected from the profile',async()=>{const close=vi.fn();mount(<ProfileListPicker member={{id:'alice',username:'alice',displayName:'Alice',avatarUrl:'',bio:''}} onClose={close}/>);const item=screen.getByRole('checkbox');expect(item).toHaveAttribute('aria-checked','true');fireEvent.click(item);fireEvent.click(screen.getByRole('button',{name:'保存'}));await waitFor(()=>expect(mocks.member).toHaveBeenCalledWith('list',expect.objectContaining({id:'alice'}),false));expect(close).toHaveBeenCalled();});
it('removes a member only from its list and does not delete the user',async()=>{mount(<ListMembers list={list as any} editable onClose={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'削除'}));await waitFor(()=>expect(mocks.member).toHaveBeenCalledWith('list',expect.objectContaining({id:'alice'}),false));});
it('keeps another owner list read-only',()=>{mount(<ListMembers list={list as any} editable={false} onClose={vi.fn()}/>);expect(screen.getByText('Alice')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'削除'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'ユーザーを追加'})).not.toBeInTheDocument();});

it('links member accounts to profiles and displays official/private badges',()=>{
 mount(<ListMemberRow member={{id:'native',username:'friend@misskey.io',displayName:'Friend',avatarUrl:'',bio:'',isOfficial:true,isPrivate:true}}/>);
 expect(screen.getByRole('link')).toHaveAttribute('href','/u/friend%40misskey.io');
 expect(screen.getByRole('img',{name:'認証済み'})).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'非公開アカウント'})).toBeInTheDocument();
});
it('keeps list editing above page controls and follows the keyboard viewport',()=>{
 const original=Object.getOwnPropertyDescriptor(window,'visualViewport');
 const viewport=Object.assign(new EventTarget(),{height:640,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
 try{
  const view=mount(<ListEditor onClose={vi.fn()} onSaved={vi.fn()}/>);
  const dialog=screen.getByRole('dialog');expect(dialog).toHaveClass('z-[2147483200]');expect(dialog.style.getPropertyValue('--list-dialog-height')).toBe('640px');
  viewport.height=360;viewport.offsetTop=20;viewport.dispatchEvent(new Event('resize'));
  expect(dialog.style.getPropertyValue('--list-dialog-height')).toBe('360px');expect(dialog.style.getPropertyValue('--list-dialog-top')).toBe('20px');
  expect(dialog.querySelector('[data-list-dialog-scroll]')).toHaveClass('min-h-0','overflow-y-auto');
  view.unmount();
 }finally{if(original)Object.defineProperty(window,'visualViewport',original);else delete window.visualViewport;}
});
it('allows new members below 500 and disables only additions at capacity',()=>{
 const original=list.members;
 try{
  const member={id:'new',username:'new',displayName:'New',avatarUrl:'',bio:''};
  list.members=Array.from({length:499},(_,i)=>({id:`member-${i}`,username:`member-${i}`,displayName:`Member ${i}`}));
  const view=mount(<ProfileListPicker member={member} onClose={vi.fn()}/>);
  expect(screen.getByRole('checkbox')).toBeEnabled();view.unmount();
  list.members=[...list.members,{id:'new',username:'new',displayName:'New'}];
  const full=mount(<ProfileListPicker member={{...member,id:'another'}} onClose={vi.fn()}/>);
  expect(screen.getByRole('checkbox')).toBeDisabled();full.unmount();
  mount(<ProfileListPicker member={member} onClose={vi.fn()}/>);
  expect(screen.getByRole('checkbox')).toBeEnabled();
 }finally{list.members=original;}
});
