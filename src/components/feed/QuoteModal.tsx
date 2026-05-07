//QuoteModal.tsx
import { X } from 'lucide-react';
import { PostComposer } from './PostComposer';
import type { PostWithAuthor } from '@/types';

interface QuoteModalProps {
  post: PostWithAuthor;
  onClose: () => void;
}

export function QuoteModal({ post, onClose }: QuoteModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl animate-in fade-in zoom-in duration-200">
        <button 
          onClick={onClose}
          className="absolute -top-12 right-0 p-2 text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <X className="h-6 w-6" />
        </button>
        <PostComposer 
          initialQuotedPost={post} 
          onSuccess={onClose} 
        />
      </div>
      <div className="fixed inset-0 -z-10" onClick={onClose} />
    </div>
  );
}