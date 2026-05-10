interface SpotifyEmbedProps {
  url: string;
}

export function SpotifyEmbed({ url }: SpotifyEmbedProps) {
  // 正常動作するURL置換ロジック
  const embedUrl = url.replace(
    /open\.spotify\.com\/(?:(?!track|album|playlist)[\w-]+\/)?/,
    'open.spotify.com/embed/'
  );

  return (
    <div className="mt-3 w-full overflow-hidden rounded-xl leading-[0] shadow-sm bg-[#282828]">
      <iframe
        src={embedUrl}
        // width属性を削除し、styleで物理的な幅を強制
        className="rounded-xl border-0 h-[80px] md:h-[152px]"
        style={{ 
          border: 0,
          // iPhone Xのパディング込みの幅を計算 (親のパディングが左右計32pxと想定)
          // もしこれでもズレるなら、widthを '100%' にして、
          // 下記の display: block と tableLayout を強制する
          width: '100%',
          minWidth: '100%',
          maxWidth: '100%',
          display: 'block',
          // ブラウザのレンダリングバグを防ぐ
          margin: 0,
          padding: 0,
        }}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        title="Spotify Player"
      />
    </div>
  );
}