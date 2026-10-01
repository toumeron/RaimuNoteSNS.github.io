import { createContext, useContext } from 'react';
export const PostOverlayContext = createContext<() => void>(() => {});
export const usePostOverlay = () => useContext(PostOverlayContext);
