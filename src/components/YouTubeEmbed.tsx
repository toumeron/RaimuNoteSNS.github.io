interface YouTubeEmbedProps {
  videoId: string;
}

export const YouTubeEmbed = ({ videoId }: YouTubeEmbedProps) => {
  return (
    <div className="my-3 aspect-video w-full overflow-hidden rounded-xl border border-border shadow-sm">
      <iframe
        width="100%"
        height="100%"
        src={`https://www.youtube.com/embed/${videoId}`}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="block"
      ></iframe>
    </div>
  );
};