import { cn } from '@/lib/utils';

export function PostImages({ 
  urls, 
  onImageError 
}: { 
  urls?: string[], 
  onImageError?: (url: string) => void 
}) { 
  // urlsがnull、undefined、または空配列の場合は何も表示しない
  if (!urls || urls.length === 0) return null;

  const layouts: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-2',
    4: 'grid-cols-2',
  };

  return (
    <div className={cn('mt-3 grid gap-1.5 overflow-hidden rounded-2xl border border-border/60', layouts[urls.length] || 'grid-cols-2')}>
      {urls.map((src, i) => (
        <div
          key={i}
          className={cn(
            'relative aspect-square w-full overflow-hidden bg-muted',
            urls.length === 3 && i === 0 && 'row-span-2 aspect-auto',
          )}
        >
          <img 
            src={src} 
            alt="" 
            loading="lazy" 
            className="h-full w-full object-cover" 
            onError={(e) => {
              // 読み込みに失敗した場合、親コンポーネントに通知
              if (onImageError) {
                onImageError(src);
              }
              // 失敗した画像要素自体を非表示にする（枠だけ残るのを防ぐ場合）
              (e.target as HTMLImageElement).style.display = 'none';
              // 親のdiv(背景bg-muted)も非表示にする場合は親要素を操作
              const parent = (e.target as HTMLImageElement).parentElement;
              if (parent) {
                parent.style.display = 'none';
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}