import { expect, it, vi } from 'vitest';
import { runGroupFriendTurn, type FriendCallUtterance } from './groupFriendCall';
import { listAssistants } from './aiFriends';
it('waits for completed speech before the next friend thinks and shares that speech', async () => {
  const friends = listAssistants('test'); const history: FriendCallUtterance[] = [];
  let finish!: () => void;
  const ask = vi.fn().mockResolvedValueOnce('一緒に行こう').mockResolvedValueOnce('[LISTEN]');
  const speak = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const turn = runGroupFriendTurn({ participants: friends, history, userName: 'ユーザー', text: '明日遊ぼう', signal: new AbortController().signal, ask, speak });
  await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
  expect(ask).toHaveBeenCalledOnce(); expect(history).toEqual([{ name: 'ユーザー', content: '明日遊ぼう' }]);
  finish(); await turn;
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1][1]).toContainEqual({ name: friends[0].name, content: '一緒に行こう' });
  expect(speak).toHaveBeenCalledOnce(); expect(history).toHaveLength(2);
});
it('does not speak stale responses or advance to another participant after an interruption', async () => {
  const controller = new AbortController(); const history: FriendCallUtterance[] = [];
  const ask = vi.fn(async () => { controller.abort(); return '返答'; }); const speak = vi.fn();
  await runGroupFriendTurn({ participants: listAssistants('test'), history, userName: 'ユーザー', text: '質問', signal: controller.signal, ask, speak });
  expect(ask).toHaveBeenCalledOnce(); expect(speak).not.toHaveBeenCalled(); expect(history).toHaveLength(1);
});
it('stops the remaining queue if voice playback fails', async () => {
  const ask = vi.fn().mockResolvedValue('返答'); const speak = vi.fn().mockRejectedValue(Error('音声エラー')); const history: FriendCallUtterance[] = [];
  await expect(runGroupFriendTurn({ participants: listAssistants('test'), history, userName: 'ユーザー', text: '質問', signal: new AbortController().signal, ask, speak })).rejects.toThrow('音声エラー');
  expect(ask).toHaveBeenCalledOnce(); expect(history).toHaveLength(1);
});
