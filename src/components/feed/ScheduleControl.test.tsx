import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {ScheduleControl} from './ScheduleControl';
afterEach(cleanup);
it('confirms a future date in Japan time without a reservation-list screen',()=>{
 const onChange=vi.fn();render(<ScheduleControl value={null} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:'予約設定'}));expect(screen.getByText('日本標準時')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'予約投稿ポスト'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'確認する'}));expect(onChange).toHaveBeenCalledWith(expect.any(String));expect(Date.parse(onChange.mock.calls[0][0])).toBeGreaterThan(Date.now());
});
it('clears the draft schedule without changing post content',()=>{
 const onChange=vi.fn();render(<ScheduleControl value={new Date(Date.now()+3600_000).toISOString()} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:'予約設定'}));fireEvent.click(screen.getByRole('button',{name:'予約を解除する'}));expect(onChange).toHaveBeenCalledWith(null);
});
