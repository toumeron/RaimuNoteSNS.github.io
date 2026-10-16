vi.mock('@/api/post-activity',()=>({hasExternalActivity:(id:string)=>id.startsWith('bsky:')||id.startsWith('x:'),getExternalPostActivity:state.external}));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ external:vi.fn(),posts: vi.fn(), replies: vi.fn(), removed: vi.fn(), callbacks: [] as (() => void)[] }));
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
beforeEach(() => { state.external.mockReset().mockResolvedValue({posts:[],users:[],next:undefined}); state.posts.mockReset().mockResolvedValue([]); state.replies.mockReset().mockResolvedValue([{ id: 'person', username: 'person', displayName: 'Reply liker' }]); state.removed.mockReset(); state.callbacks = []; });
afterEach(cleanup);
function mount(search = '?tab=likes',id='root') { return render(<MemoryRouter initialEntries={['/post/'+encodeURIComponent(id)+'/activity' + search]}><Routes><Route path="/post/:postId/activity" element={<PostActivity />} /></Routes></MemoryRouter>); }
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

it.each(['','?tab=likes','?tab=quotes','?tab=reposts'])('hides every twitter activity tab while retaining the activity list for URL %s',async(search)=>{
 mount(search,'x:2110766445940572599');
 await screen.findByText('まだリポストはありません');
 expect(screen.queryByRole('tab')).toBeNull();expect(screen.queryByRole('tablist')).toBeNull();expect(screen.getByRole('region',{name:'リポスト一覧'})).toBeInTheDocument();
 expect(state.external).toHaveBeenCalledWith('x:2110766445940572599','reposts','top',undefined,expect.any(AbortSignal));
 expect(state.external.mock.calls.every(call=>call[1]==='reposts')).toBe(true);
 expect(state.posts).not.toHaveBeenCalled();expect(state.callbacks).toHaveLength(0);
});
it('keeps all three tabs for Bluesky and displays external activity users',async()=>{
 state.external.mockResolvedValue({posts:[],users:[{id:'did:plc:actor',username:'actor.bsky.social',displayName:'Bluesky liker'}],next:undefined});
 mount('?tab=likes','bsky:at://did:plc:owner/app.bsky.feed.post/record');
 await screen.findByText('Bluesky liker');expect(screen.getAllByRole('tab')).toHaveLength(3);expect(state.external.mock.calls[0][1]).toBe('likes');expect(state.posts).not.toHaveBeenCalled();expect(state.callbacks).toHaveLength(0);
 expect(screen.getByRole('link',{name:'Bluesky liker @actor.bsky.social'})).toHaveAttribute('href','/u/actor.bsky.social');
});

it('stops after an empty twitter activity page even if a source incorrectly offers another cursor',async()=>{
 const observe=vi.fn();vi.stubGlobal('IntersectionObserver',class{observe=observe;disconnect(){}});
 state.external.mockResolvedValue({posts:[],users:[],next:{remote:'next',remoteDone:false,localPage:1,localDone:true}});
 mount('?tab=reposts','x:90105');await screen.findByText('まだリポストはありません');
 await waitFor(()=>expect(screen.getByRole('region')).toHaveAttribute('aria-busy','false'));
 expect(state.external).toHaveBeenCalledTimes(1);expect(observe).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
