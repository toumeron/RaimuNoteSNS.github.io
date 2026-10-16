import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PollEditor, newPollDraft, ScheduleControl } from "@/components/feed/PostPoll";
import { validatePollDraft, pollPercent, pollRemaining } from "@/lib/polls";

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
