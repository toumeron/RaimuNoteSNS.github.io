import { PostOverlay } from '@/App';
import type { PostWithAuthor } from '@/types';

// Reuse the same desktop overlay and mobile full-screen composer as a regular post.
export function QuoteModal({ post, onClose }: { post: PostWithAuthor; onClose: () => void }) {
  return <PostOverlay isOpen initialQuotedPost={post} onClose={onClose} />;
}
