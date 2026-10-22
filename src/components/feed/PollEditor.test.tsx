vi.mock("@/api/external-posts", async importOriginal => ({...await importOriginal<typeof import("@/api/external-posts")>(), readPoll:mocks.read, votePoll:mocks.vote}));
const mocks=vi.hoisted(()=>({read:vi.fn(),vote:vi.fn(),user:{id:'viewer'}}));

vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:mocks.user})}));
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi, beforeEach } from "vitest";
import { PollEditor, newPollDraft, ScheduleControl, PostPoll } from "@/components/feed/PostPoll";
import { validatePollDraft, pollPercent, pollRemaining } from "@/lib/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PostWithAuthor } from "@/types/index";

describe("PollEditor", () => {
describe("PollEditor", () => {
afterEach(cleanup);
function Mount(){const [draft,setDraft]=useState(newPollDraft());return <PollEditor value={draft} onChange={setDraft} onRemove={vi.fn()}/>;}
it('supports text-only answers, up to four options, and days/hours/minutes',()=>{
 render(<Mount/>);fireEvent.change(screen.getByLabelText('回答1'),{target:{value:'猫'}});fireEvent.change(screen.getByLabelText('回答2'),{target:{value:'犬'}});
 expect(screen.getByLabelText('回答1')).toHaveValue('猫');expect(screen.getByLabelText('回答2')).toHaveValue('犬');
 fireEvent.click(screen.getByRole('button',{name:'回答を追加'}));fireEvent.click(screen.getByRole('button',{name:'回答を追加'}));expect(screen.queryByRole('button',{name:'回答を追加'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'回答4を削除'}));expect(screen.getByRole('button',{name:'回答を追加'})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('投票期間・日'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('投票期間・分'),{target:{value:'15'}});expect(screen.getByLabelText('投票期間・分')).toHaveValue('15');
});
it('counts emoji as characters and validates duration and nonempty answers',()=>{
 render(<Mount/>);fireEvent.change(screen.getByLabelText('回答1'),{target:{value:'😺'.repeat(30)}});expect(screen.getByLabelText('回答1')).toHaveValue('😺'.repeat(25));
 expect(validatePollDraft({options:[{label:'猫'},{label:'犬'}],durationMinutes:1})).toBeNull();
 expect(validatePollDraft({options:[{label:''},{label:'犬'}],durationMinutes:1440})).not.toBeNull();
 expect(validatePollDraft({options:[{label:'猫'},{label:'犬'}],durationMinutes:10081})).not.toBeNull();
 expect(pollPercent(0,0)).toBe(0);expect(pollPercent(1,3)).toBe(33);expect(pollRemaining('2026-10-11T00:00:00Z',Date.parse('2026-10-12T00:00:00Z'))).toBe('投票終了');
});
});

describe("ScheduleControl", () => {
afterEach(cleanup);
it('confirms a future date in Japan time without a reservation-list screen',()=>{
 const onChange=vi.fn();render(<ScheduleControl value={null} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:'予約設定'}));expect(screen.getByText('日本標準時')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'予約投稿ポスト'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'確認する'}));expect(onChange).toHaveBeenCalledWith(expect.any(String));expect(Date.parse(onChange.mock.calls[0][0])).toBeGreaterThan(Date.now());
});
it('clears the draft schedule without changing post content',()=>{
 const onChange=vi.fn();render(<ScheduleControl value={new Date(Date.now()+3600_000).toISOString()} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:'予約設定'}));fireEvent.click(screen.getByRole('button',{name:'予約を解除する'}));expect(onChange).toHaveBeenCalledWith(null);
});
});
});

describe("PostPoll", () => {



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
});
