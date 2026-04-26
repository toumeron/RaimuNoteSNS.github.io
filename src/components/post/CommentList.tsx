import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useComments } from '@/hooks/useComments';
import { formatRelative } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

export function CommentList({ postId }: { postId: string }) {
  const { data, isLoading, isError, refetch } = useComments(postId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-center text-sm">
        <p className="mb-2 text-destructive">コメントの読み込みに失敗しました</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-full">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> 再読み込み
        </Button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        まだコメントはありません。
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {data.map((c) => (
        <li key={c.id} className="flex gap-3 animate-float-up">
          <Link to={`/u/${c.author.username}`} className="shrink-0">
            <Avatar className="h-9 w-9 border border-primary/20">
              <AvatarImage src={c.author.avatarUrl} alt={c.author.displayName} />
              <AvatarFallback>{c.author.displayName.slice(0, 1)}</AvatarFallback>
            </Avatar>
          </Link>
          <div className="flex-1 rounded-2xl bg-secondary/60 px-4 py-2.5">
            <div className="flex items-baseline gap-1.5 text-xs">
              <Link to={`/u/${c.author.username}`} className="font-display font-bold text-foreground hover:underline">
                {c.author.displayName}
              </Link>
              <span className="text-muted-foreground">@{c.author.username}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{formatRelative(c.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{c.content}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
