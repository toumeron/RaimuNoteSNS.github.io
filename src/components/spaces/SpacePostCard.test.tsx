import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { SpaceContext } from './SpaceContext';
import { SpacePostCard } from './SpacePostCard';
import { spaceLinkIn } from '@/lib/spaceLinks';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/api/spaces', () => ({ spaceRpc: rpc }));
const room = { id: 'demo', title: '夜の雑談', host_id: 'host', speaker_policy: 'host' as const, profiles: { display_name: 'ホスト', username: 'lime', avatar_url: '' }, is_active: true };
beforeEach(() => rpc.mockResolvedValue(room));
function mount(joinedId?: string) {
  const open = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SpaceContext.Provider value={{ spaces: [], open, create: vi.fn(), joinedId }}><SpacePostCard content="https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/demo" /></SpaceContext.Provider></QueryClientProvider>);
  return open;
}
it('opens the linked live space from the announcement card', async () => {
  const open = mount(); fireEvent.click(await screen.findByRole('button', { name: 'スペースを聞く' }));
  expect(open).toHaveBeenCalledWith('demo'); expect(screen.getByText('夜の雑談')).toBeInTheDocument();
});
it('shows joined state for the current space', async () => { mount('demo'); expect(await screen.findByRole('button', { name: '参加済み' })).toBeInTheDocument(); });
it('retains host and theme after ending without a join button', async () => {
  rpc.mockResolvedValue({ ...room, is_active: false }); mount(); await screen.findByText('終了しました');
  expect(screen.getByText('夜の雑談')).toBeInTheDocument(); expect(screen.queryByRole('button')).toBeNull();
});
it('does not convert unrelated or spoofed links into a space card', async () => {
  expect(spaceLinkIn('https://example.com/RaimuNoteSNS.github.io/spaces/demo')).toBeNull();
  expect(spaceLinkIn('https://toumeron.github.io.example.com/RaimuNoteSNS.github.io/spaces/demo')).toBeNull();
  expect(spaceLinkIn('話そう https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/demo')?.text).toBe('話そう');
});
