import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PostWithAuthor } from '@/types';
const state = vi.hoisted(() => ({
  comments: [] as { id: string; postId: string; parentCommentId: string | null; content: string }[],
  accessible: true,
  resizes: [] as (() => void)[],
}));
vi.mock('@/hooks/useComments', () => ({ useComments: () => ({ data: state.comments, isLoading: false }) }));
vi.mock('@/hooks/useFeed', () => ({ usePost: () => ({ data: state.accessible ? { id: 'root' } : undefined, isLoading: false }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
vi.mock('@/components/layout/DesktopLayoutContext', () => ({ useDesktopLayout: () => true }));
vi.mock('@/components/feed/PostCard', () => ({ PostCard: () => <div>original post</div> }));
vi.mock('@/components/post/CommentList', () => ({
  CommentCard: ({ comment, detail }: { comment: { content: string }; detail: boolean }) => <div data-testid={detail ? "detail" : "ancestor"}>{comment.content}</div>,
  CommentList: ({ parentCommentId }: { parentCommentId: string }) => <div>children of {parentCommentId}</div>,
}));
vi.mock('@/components/post/CommentForm', () => ({ CommentForm: ({ parentCommentId, postId }: { parentCommentId: string; postId: string }) => <div>reply to {parentCommentId} in {postId}</div> }));
vi.mock('@/components/post/ReplyChain', () => ({ ReplyChain: ({ children }: { children: React.ReactNode }) => <div data-lime-reply-chain>{children}</div> }));
import { ReplyDetail } from './ReplyDetail';
beforeEach(() => {
  state.accessible = true;
  Element.prototype.scrollIntoView = vi.fn();
  state.resizes = [];
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { state.resizes.push(callback); } observe() {} disconnect() {} });
  state.comments = [
    { id: 'one', postId: 'root', parentCommentId: null, content: 'first reply' },
    { id: 'two', postId: 'root', parentCommentId: 'one', content: 'second reply' },
    { id: 'three', postId: 'root', parentCommentId: 'two', content: 'selected reply' },
    { id: 'sibling', postId: 'root', parentCommentId: 'one', content: 'other branch' },
  ];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => render(<MemoryRouter initialEntries={['/post/root?reply=three']}><Routes><Route path="/post/:id" element={<ReplyDetail commentId="three" post={{ id: 'root' } as PostWithAuthor} mobileFlat />} /></Routes></MemoryRouter>);
describe('reply thread navigation', () => {
  it('shows the original and ancestor chain in order without sibling branches', () => {
    mount();
    const original = screen.getByText('original post'), first = screen.getByText('first reply'), second = screen.getByText('second reply'), selected = screen.getByText('selected reply');
    expect(original.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(second.compareDocumentPosition(selected) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('other branch')).toBeNull();
  });
  it('emphasizes only the selected reply', () => {
    mount(); expect(screen.getByTestId('detail')).toHaveTextContent('selected reply'); expect(screen.getAllByTestId('ancestor')).toHaveLength(2);
  });
  it('targets the selected reply for both the composer and child list', () => {
    mount();
    expect(screen.getByText('reply to three in root')).toBeInTheDocument();
    expect(screen.getByText('children of three')).toBeInTheDocument();
  });
  it('does not expose an unavailable reply', () => {
    state.comments = []; mount();
    expect(screen.queryByText('selected reply')).toBeNull();
    expect(screen.queryByText('reply to three in root')).toBeNull();
  });
  it('uses the surrounding post header and scrolls to the selected reply', () => {
    mount();
    expect(screen.queryByRole('heading', { name: 'ポスト' })).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  });
  it('keeps the reply in view during media resize and stops after user scrolling', () => {
    mount();
    state.resizes[0]();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('wheel'));
    state.resizes[0]();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
