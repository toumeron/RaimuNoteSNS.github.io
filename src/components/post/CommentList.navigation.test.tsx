vi.mock("@/hooks/useFeed", async importOriginal => {
 const actual = await importOriginal<typeof import("@/hooks/useFeed")>();
 const overrides = [
  await (() => ({ useComments: () => ({ data: [], isLoading: false }) }))(),
  await (() => ({ useFollowStats: () => ({ data: {} }) }))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});
vi.mock("@/components/feed/RepostButton", async importOriginal => ({...await importOriginal<typeof import("@/components/feed/RepostButton")>(), Commentlikebutton: ({ commentId }: { commentId: string }) => <button onClick={() => db.likes(commentId)}>いいね</button>}));
vi.mock("@/components/profile/ProfileHeader", async importOriginal => ({...await importOriginal<typeof import("@/components/profile/ProfileHeader")>(), FollowButton: () => null}));
vi.mock("@/components/feed/QuotedPost", async importOriginal => ({...await importOriginal<typeof import("@/components/feed/QuotedPost")>(), PostImages: ({ urls }: { urls: string[] }) => <img src={urls[0]} alt="返信画像" />}));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ likes: vi.fn() }));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'author' }));





vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) }; return query;
  },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));
import { CommentCard } from './CommentList';
const comment = { id: 'reply-id', postId: 'original', userId: 'author', content: '返信本文をクリック', createdAt: '2026-10-02T00:00:00Z', likesCount: 1, likedByMe: false, imageUrls: ['https://example.com/image.png'], author: { id: 'author', username: 'author', displayName: 'Author', avatarUrl: '', createdAt: '' } };
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function mount(detail = false) { return renderWithQuery(<MemoryRouter initialEntries={['/post/original']}><CommentCard comment={comment} currentUserId="author" mobileFlat thread detail={detail} /><Location /></MemoryRouter>); }
const navigationRender = render;
function renderWithQuery(ui: React.ReactNode) { return navigationRender(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{ui}</QueryClientProvider>); }
afterEach(cleanup);
describe('reply card interactions', () => {
  it('uses the existing detail typography and full-width body for a selected reply', async () => {
    mount(true);
    await waitFor(() => expect(screen.getByText('Author')).toBeInTheDocument());
    expect(screen.getByText('Author')).toHaveClass('post-detail-mobile-name');
    expect(screen.getByText('@author')).toHaveClass('post-detail-mobile-username');
    expect(screen.getByText('返信本文をクリック')).toHaveClass('post-detail-mobile-content');
    expect(screen.getByText('返信本文をクリック').parentElement?.parentElement).toHaveClass('col-span-2');
    expect(screen.getByTitle('2026/10/02 09:00')).toHaveClass('post-detail-mobile-meta');
    expect(screen.getByRole('link', { name: 'この返信に返信する' }).querySelector('span')).toHaveClass('font-bold', 'tabular-nums', 'text-[15px]');
    expect(screen.getByRole('link', { name: 'この返信に返信する' })).not.toHaveTextContent('0');
  });
  it('shows the saved client alongside the selected reply timestamp', async () => {
    renderWithQuery(<MemoryRouter><CommentCard comment={{ ...comment, clientName: 'LimeNote for iPhone' }} currentUserId="author" mobileFlat thread detail /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('LimeNote for iPhone')).toBeInTheDocument());
    expect(screen.getByText('LimeNote for iPhone').closest('p')).toHaveClass('post-detail-mobile-meta');
  });
  it('navigates when clicking the reply body', () => {
    mount(); fireEvent.click(screen.getByText('返信本文をクリック'));
    expect(screen.getByTestId('location')).toHaveTextContent('/post/original?reply=reply-id');
  });
  it('navigates to the same reply from the reply icon', () => {
    mount(); fireEvent.click(screen.getByRole('link', { name: 'この返信に返信する' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/post/original?reply=reply-id');
  });
  it('keeps functional action clicks from navigating the card', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'いいね' }));
    expect(db.likes).toHaveBeenCalledWith('reply-id');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/post\/original$/);
  });
  it('opens the selected reply activity instead of the original post activity', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'コメントのメニュー' }));
    fireEvent.click(screen.getByRole('button', { name: 'ポストアクティビティ' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/post/original/activity?reply=reply-id');
  });
  it('opens the real comment menu and image overlay', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'コメントのメニュー' }));
    expect(screen.getAllByRole('button', { name: '返信を共有' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '返信を共有' }).closest('[data-lime-comment-actions]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
    const opened = vi.fn();
    window.addEventListener('lime-open-media-viewer', opened);
    fireEvent.click(screen.getByAltText('返信画像'));
    expect(opened).toHaveBeenCalledOnce();
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toMatchObject({url:comment.imageUrls[0],post:{id:'reply:reply-id',replyPostId:'original'}});
    window.removeEventListener('lime-open-media-viewer', opened);
  });
});

it.each(['x:2110766445940572599','bsky:at://did:plc:actor/app.bsky.feed.post/record'])('opens the external reply activity for %s',async(id)=>{
 const externalPost={...comment,author:{...comment.author,bio:'',coverUrl:''},id,commentsCount:0,repostsCount:0,repostedByMe:false,visibility:'public' as const,isBot:false,source:id.startsWith('x:')?'x' as const:'bluesky' as const};
 renderWithQuery(<MemoryRouter><CommentCard comment={comment} externalPost={externalPost} currentUserId="author" mobileFlat thread/><Location/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'コメントのメニュー'}));fireEvent.click(screen.getByRole('button',{name:'ポストアクティビティ'}));
 expect(screen.getByTestId('location')).toHaveTextContent(`/post/${encodeURIComponent(id)}/activity`);
});
