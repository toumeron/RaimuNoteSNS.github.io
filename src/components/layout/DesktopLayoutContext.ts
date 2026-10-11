import { createContext, useContext } from "react";
import type { PostWithAuthor } from "@/types";

// Desktop uses the existing mobile presentation without changing viewport-based interactions.
export const DesktopLayoutContext = createContext(false);
export const useDesktopLayout = () => useContext(DesktopLayoutContext);

export const PostOverlayContext = createContext<(quotedPost?: PostWithAuthor) => void>(() => {});
export const usePostOverlay = () => useContext(PostOverlayContext);
