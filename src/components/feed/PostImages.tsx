import { cn } from '@/lib/utils';

export function PostImages({ urls }: { urls?: string[] }) { // urlsを任意（?）にする
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
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>
      ))}
    </div>
  );
}