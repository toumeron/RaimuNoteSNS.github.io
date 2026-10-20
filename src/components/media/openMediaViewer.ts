import type { PostVideo } from "@/lib/mediaThumbnail";
import type { ContextType } from 'react';
import type { OfflineBookmarkContext } from "@/components/stickers/Stickers";
import type { PostWithAuthor } from '@/types';

export type ViewerMedia = { src: string; type?: 'image' | 'youtube' | 'video'; youtubeId?: string };
export type MediaViewerSelection = {
  video?: { video: Pick<PostVideo,'duration'|'width'|'height'>; postId?: string; previewUrl?: string; externalVideo?: import('@/types').ExternalVideo };
  offline?: ContextType<typeof OfflineBookmarkContext>;
  url: string;
  post?: PostWithAuthor;
  postId?: string;
  media?: ViewerMedia[];
};
export const MEDIA_VIEWER_EVENT = 'lime-open-media-viewer';
/** Open the same viewer from every timeline, thread and media grid. */
export function openMediaViewer(selection: MediaViewerSelection) {
  window.dispatchEvent(new CustomEvent(MEDIA_VIEWER_EVENT, { detail: selection }));
}
