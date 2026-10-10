import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ posts: vi.fn(), replies: vi.fn(), removed: vi.fn(), callbacks: [] as (() => void)[] }));
vi.mock('@/api/posts', () => ({ getPostLikers: state.posts, getPostQuotes: vi.fn().mockResolvedValue([]), getPostReposters: vi.fn().mockResolvedValue([]) }));
vi.mock('@/api/comments', () => ({ getCommentLikers: state.replies }));
vi.mock('@/components/profile/FollowButton', () => ({ FollowButton: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  channel: () => { const channel = { on: (_event: string, _filter: unknown, callback: () => void) => { state.callbacks.push(callback); return channel; }, subscribe: () => channel }; return channel; },
  removeChannel: state.removed,
} }));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'viewer'}})}));
vi.mock('@/components/feed/PostCard',()=>({PostCard:()=>null}));
import PostActivity from './PostActivity';
beforeEach(() => { state.posts.mockReset().mockResolvedValue([]); state.replies.mockReset().mockResolvedValue([{ id: 'person', username: 'person', displayName: 'Reply liker' }]); state.removed.mockReset(); state.callbacks = []; });
afterEach(cleanup);
function mount(search = '?tab=likes') { return render(<MemoryRouter initialEntries={['/post/root/activity' + search]}><Routes><Route path="/post/:postId/activity" element={<PostActivity />} /></Routes></MemoryRouter>); }
describe('reply activity', () => {
  it('shows the selected reply likers without reading the root post likes', async () => {
    mount('?reply=selected'); await screen.findByText('Reply liker');
    expect(state.replies).toHaveBeenCalledWith('selected'); expect(state.posts).not.toHaveBeenCalled();
  });
  it('retains the existing original post activity', async () => {
    mount(); await screen.findByText('まだいいねはありません');
    expect(state.posts).toHaveBeenCalledWith('root'); expect(state.replies).not.toHaveBeenCalled();
  });
  it('updates the open reply activity on live like changes and cleans up', async () => {
    const view = mount('?reply=selected'); await screen.findByText('Reply liker');
    state.replies.mockResolvedValue([]); state.callbacks[1]();
    await screen.findByText('まだいいねはありません');
    view.unmount(); expect(state.removed).toHaveBeenCalledTimes(1);
  });
  it('does not show a failed read as an empty like list', async () => {
    state.replies.mockRejectedValue(new Error('offline')); mount('?reply=selected');
    await screen.findByText('アクティビティの読み込みに失敗しました。');
    expect(screen.queryByText('まだいいねはありません')).toBeNull();
    await waitFor(() => expect(state.replies).toHaveBeenCalledTimes(1));
  });
});
