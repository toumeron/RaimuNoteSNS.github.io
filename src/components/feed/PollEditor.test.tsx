import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {PollEditor,newPollDraft} from './PollEditor';
import {validatePollDraft,pollPercent,pollRemaining} from '@/lib/polls';
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
