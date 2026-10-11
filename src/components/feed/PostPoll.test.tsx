import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
const mocks=vi.hoisted(()=>({read:vi.fn(),vote:vi.fn(),user:{id:'viewer'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mocks.user})}));
vi.mock('@/api/polls',()=>({readPoll:mocks.read,votePoll:mocks.vote}));
import {PostPoll} from './PostPoll';
const initial={poll:{options:[{label:'猫',votes:0},{label:'犬',votes:0}],endsAt:new Date(Date.now()+86400000).toISOString()},selected:null,urls:{}};
const post={id:'post',userId:'owner',poll:initial.poll} as PostWithAuthor;
function mount(row=post){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><PostPoll post={row}/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mocks.read.mockResolvedValue(initial);mocks.vote.mockResolvedValue('viewer');});afterEach(cleanup);
it('casts one vote then displays totals, percentages and the selected option',async()=>{
 mount();await waitFor(()=>expect(screen.getByRole('button',{name:'猫に投票'})).toBeEnabled());
 mocks.read.mockResolvedValue({...initial,poll:{...initial.poll,options:[{label:'猫',votes:1},{label:'犬',votes:0}]},selected:0});
 fireEvent.click(screen.getByRole('button',{name:'猫に投票'}));await screen.findByText('100%');expect(mocks.vote).toHaveBeenCalledWith('post',0);expect(screen.getByLabelText('投票した回答')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'猫に投票'})).not.toBeInTheDocument();expect(screen.getByText(/1票/)).toBeInTheDocument();
});
it('shows owner and closed poll results without vote controls',async()=>{
 mount({...post,userId:'viewer'});await waitFor(()=>expect(screen.getAllByText('0%')).toHaveLength(2));expect(screen.queryByRole('button',{name:/に投票/})).not.toBeInTheDocument();cleanup();
 const closed={...initial,poll:{...initial.poll,endsAt:new Date(Date.now()-1000).toISOString()}};mocks.read.mockResolvedValue(closed);mount({...post,poll:closed.poll});await screen.findByText(/投票終了/);expect(screen.queryByRole('button',{name:/に投票/})).not.toBeInTheDocument();
});
it('shows image cards before voting and thumbnail result rows afterwards',async()=>{
 const withImages={...initial,poll:{...initial.poll,options:[{label:'猫',image:'cloudinary:cat',votes:0},{label:'犬',image:'cloudinary:dog',votes:0}]},urls:{'cloudinary:cat':'https://example.test/cat.png','cloudinary:dog':'https://example.test/dog.png'}};
 mocks.read.mockResolvedValue(withImages);mount({...post,poll:withImages.poll});await screen.findByAltText('猫');expect(screen.getByAltText('猫')).toHaveAttribute('src','https://example.test/cat.png');expect(screen.getByRole('button',{name:'猫に投票'}).parentElement).toHaveClass('grid-cols-2');
 mocks.read.mockResolvedValue({...withImages,poll:{...withImages.poll,options:withImages.poll.options.map((option,index)=>({...option,votes:index===0?1:0}))},selected:0});fireEvent.click(screen.getByRole('button',{name:'猫に投票'}));await screen.findByText('100%');expect(screen.getByAltText('猫').parentElement).toHaveClass('h-14','w-14');
});
