import { createContext, useContext } from 'react';
import type { PostWithAuthor } from '@/types';
export const PostOverlayContext = createContext<(quotedPost?: PostWithAuthor) => void>(() => {});
export const usePostOverlay = () => useContext(PostOverlayContext);
