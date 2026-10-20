vi.mock("@/components/feed/PostCard", async importOriginal => ({...await importOriginal<typeof import("@/components/feed/PostCard")>(), PostCard: () => <div>original post</div>}));
vi.mock("@/hooks/useFeed", async importOriginal => {
 const actual = await importOriginal<typeof import("@/hooks/useFeed")>();
 const overrides = [
  await (async importOriginal => ({...await importOriginal<typeof import("@/hooks/useFeed")>(), usePost: () => ({ data: state.accessible ? { id: 'root' } : undefined, isLoading: false })}))(importOriginal),
  await (() => ({ useComments: () => ({ data: state.comments, isLoading: false }) }))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});
vi.mock("@/components/post/CommentForm",()=>({CommentForm:({parentCommentId,postId}:any)=><div>reply to {parentCommentId} in {postId}</div>}));
vi.mock("@/components/layout/DesktopLayoutContext", async importOriginal => ({...await importOriginal<typeof import("@/components/layout/AppLayout")>(), useDesktopLayout: () => true}));
vi.mock("@/components/post/CommentList", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/post/CommentList")>();
 const overrides = [
  await (() => ({
  CommentCard: ({ comment, detail }: { comment: { content: string }; detail: boolean }) => <div data-testid={detail ? "detail" : "ancestor"}>{comment.content}</div>,
  CommentList: ({ parentCommentId }: { parentCommentId: string }) => <div>children of {parentCommentId}</div>,
}))(),
  await (() => ({ CommentForm: ({ parentCommentId, postId }: { parentCommentId: string; postId: string }) => <div>reply to {parentCommentId} in {postId}</div> }))(),
  await (() => ({ ReplyChain: ({ children }: { children: React.ReactNode }) => <div data-lime-reply-chain>{children}</div> }))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});

vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth: () => ({ user: { id: 'viewer' } })}));
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PostWithAuthor } from '@/types';
const state = vi.hoisted(() => ({
  comments: [] as { id: string; postId: string; parentCommentId: string | null; content: string }[],
  accessible: true,
  resizes: [] as (() => void)[],
}));








import { ReplyDetail } from "@/pages/PostDetail";
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
