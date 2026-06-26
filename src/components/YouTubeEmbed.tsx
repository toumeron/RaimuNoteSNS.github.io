import { useEffect, useMemo, useRef } from 'react';

interface YouTubeEmbedProps {
  videoId: string;
}

declare global {
  interface Window {
    __limeBackgroundMediaActiveKey?: string | null;
  }
}

const LIME_BACKGROUND_MEDIA_PLAY_EVENT = 'lime-background-media-play';
const LIME_BACKGROUND_MEDIA_STOP_EVENT = 'lime-background-media-stop';

const getYouTubeEmbedUrl = (videoId: string) => {
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
  });

  if (typeof window !== 'undefined') {
    params.set('origin', window.location.origin);
  }

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
};

const parseYouTubeMessage = (data: unknown): any | null => {
  if (!data) return null;

  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  if (typeof data === 'object') {
    return data;
  }

  return null;
};

const sendYouTubeListeningMessage = (iframe: HTMLIFrameElement | null, id: string) => {
  if (!iframe?.contentWindow) return;

  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'listening', id }),
      'https://www.youtube.com'
    );
  } catch {
    // noop
  }
};

export const YouTubeEmbed = ({ videoId }: YouTubeEmbedProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mediaKey = useMemo(() => `youtube:${videoId}`, [videoId]);
  const embedUrl = useMemo(() => getYouTubeEmbedUrl(videoId), [videoId]);

  const notifyPlaying = () => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent(LIME_BACKGROUND_MEDIA_PLAY_EVENT, {
      detail: {
        key: mediaKey,
        kind: 'youtube',
        title: 'YouTube video player',
        element: iframeRef.current,
      },
    }));
  };

  const notifyStopped = () => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent(LIME_BACKGROUND_MEDIA_STOP_EVENT, {
      detail: { key: mediaKey },
    }));
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;

      const message = parseYouTubeMessage(event.data);
      if (!message) return;

      const state = message?.info?.playerState ?? message?.info;

      if (state === 1) {
        notifyPlaying();
        return;
      }

      if (state === 0 || state === 2) {
        notifyStopped();
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [mediaKey]);

  useEffect(() => {
    const handleWindowBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement === iframeRef.current) {
          notifyPlaying();
        }
      }, 0);
    };

    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [mediaKey]);

  const handleIframeLoad = () => {
    sendYouTubeListeningMessage(iframeRef.current, mediaKey);
    window.setTimeout(() => sendYouTubeListeningMessage(iframeRef.current, mediaKey), 500);
  };

  return (
    <div className="my-3 aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-sm">
      <iframe
        ref={iframeRef}
        width="100%"
        height="100%"
        src={embedUrl}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="block h-full w-full"
        onLoad={handleIframeLoad}
      />
    </div>
  );
};
