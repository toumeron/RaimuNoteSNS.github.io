import { History, MoreHorizontal, Share } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useNewsStory } from '@/hooks/useNewsStory';
import { toast } from 'sonner';

export function NewsHeaderActions() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: story } = useNewsStory(params.get('story'));
  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('history');
    if (story) url.searchParams.set('story', story.id);
    try {
      if (navigator.share) await navigator.share({ title: story?.title ?? 'ニュース', url: url.href });
      else { await navigator.clipboard.writeText(url.href); toast.success('リンクをコピーしました'); }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error('共有できませんでした');
    }
  };
  return <div className="ml-auto flex items-center gap-1" data-lime-news-header-actions>
    <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/40" aria-label="ニュースを共有" onClick={() => void share()}><Share className="h-5 w-5" /></Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/40" aria-label="ニュースのメニュー"><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[600]" data-lime-news-menu>
        <DropdownMenuItem className="focus:bg-muted focus:text-foreground" onSelect={() => { const next = new URLSearchParams(params); next.delete('history'); if (story) next.set('story', story.id); navigate(`/news/history?${next}`); }}><History className="mr-2 h-4 w-4" />トレンド履歴</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
