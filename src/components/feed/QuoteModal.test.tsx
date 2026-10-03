import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PostWithAuthor } from '@/types';
vi.mock('@/App', () => ({ PostOverlay: ({ initialQuotedPost, isOpen, onClose }: { initialQuotedPost: PostWithAuthor; isOpen: boolean; onClose: () => void }) => (
  isOpen ? <button onClick={onClose}>引用投稿する: {initialQuotedPost.content}</button> : null
) }));
import { QuoteModal } from './QuoteModal';
describe('quote composer overlay', () => {
  it('passes the original post to the existing post overlay and forwards closing', () => {
    const close = vi.fn();
    const { unmount } = render(<QuoteModal post={{ id: 'original', content: '元の投稿' } as PostWithAuthor} onClose={close} />);
    fireEvent.click(screen.getByText('引用投稿する: 元の投稿'));
    expect(close).toHaveBeenCalledOnce();
    unmount();
  });
});
