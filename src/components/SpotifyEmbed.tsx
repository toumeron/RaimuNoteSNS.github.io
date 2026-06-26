import { useEffect, useMemo, useRef } from 'react';

interface SpotifyEmbedProps {
  url: string;
}

declare global {
  interface Window {
    __limeBackgroundMediaActiveKey?: string | null;
  }
}

const LIME_BACKGROUND_MEDIA_PLAY_EVENT = 'lime-background-media-play';

const getSpotifyEmbedUrl = (url: string) => {
  return url.replace(
    /open\.spotify\.com\/(?:(?!track|album|playlist)[\w-]+\/)?/,
    'open.spotify.com/embed/'
  );
};

export function SpotifyEmbed({ url }: SpotifyEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const embedUrl = useMemo(() => getSpotifyEmbedUrl(url), [url]);
  const mediaKey = useMemo(() => `spotify:${embedUrl}`, [embedUrl]);

  const notifyPlaying = () => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent(LIME_BACKGROUND_MEDIA_PLAY_EVENT, {
      detail: {
        key: mediaKey,
        kind: 'spotify',
        title: 'Spotify Player',
        element: iframeRef.current,
      },
    }));
  };

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

  return (
    <div className="mt-3 w-full overflow-hidden rounded-xl leading-[0] shadow-sm bg-[#282828]">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="rounded-xl border-0 h-[80px] md:h-[152px]"
        style={{
          border: 0,
          width: '100%',
          minWidth: '100%',
          maxWidth: '100%',
          display: 'block',
          margin: 0,
          padding: 0,
        }}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        title="Spotify Player"
        onFocus={notifyPlaying}
      />
    </div>
  );
}
