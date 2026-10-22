import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("@/components/feed/PostCard", async importOriginal => ({...await importOriginal<typeof import("@/components/feed/PostCard")>(), PostCard: ({ post, embedded }: any) => <div data-testid="parent" data-embedded={String(!!embedded)}>{post.content}</div>}));
import { fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PostWithAuthor } from '@/types';



import { ExternalReplyDetail } from "@/components/post/CommentList";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows the parent with its actions and anchors the selected reply until user interaction', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const post = { id: 'bsky:reply', content: 'reply', createdAt: new Date().toISOString(), imageUrls: [], author: { id: 'alice', username: 'alice', displayName: 'Alice', avatarUrl: null }, externalReplyParent: { id: 'bsky:parent', content: 'parent' } } as PostWithAuthor;
  const view = render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ExternalReplyDetail post={post} mobileFlat /></QueryClientProvider></MemoryRouter>);
  expect(view.getByTestId('parent').getAttribute('data-embedded')).toBe('false');
  expect(view.container.querySelector('[data-lime-selected-reply]')).toHaveTextContent('reply');
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  scroll.mockClear();
  fireEvent.wheel(window);
  fireEvent.load(view.getByTestId('parent'));
  expect(scroll).not.toHaveBeenCalled();
  view.unmount();
});
